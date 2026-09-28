/**
 * An engine shared with other processes (semanticEngine.shareWith): each
 * exclusive task takes the lock they all take, one task at a time, and never
 * trusts that the store still holds what an earlier task loaded, since another
 * process may have loaded its own graph in between. Every engine request a
 * task makes carries the task's signal, so a task that must stop (its lock
 * lost, its job aborted) stops at once. A task called off while it waits for
 * its turn lets nobody in early.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { semanticEngine } from "../services/semanticEngine";
import { LockLost, LockUnavailable } from "../lib/namedLock";
import { untilStopped } from "./fakeLockConnection";

afterEach(() => {
  semanticEngine.shareWith(null);
  vi.restoreAllMocks();
});

/** A stand-in for syncing a workspace into the store: records it, and marks the store as holding it. */
function fakeSync() {
  return vi.spyOn(semanticEngine, "syncWorkspace").mockImplementation(async (workspaceId: number) => {
    (semanticEngine as unknown as { loadedWorkspaceId: number | null }).loadedWorkspaceId = workspaceId;
    return { classesLoaded: 0, propertiesLoaded: 0, instancesLoaded: 0, triplesLoaded: 0 };
  });
}

const live = () => new AbortController().signal;

describe("an engine shared with other processes", () => {
  it("takes the shared lock around each task, one task at a time", async () => {
    const events: string[] = [];
    semanticEngine.shareWith(async (task) => {
      events.push("lock");
      try {
        return await task(live());
      } finally {
        events.push("unlock");
      }
    });
    const a = semanticEngine.exclusive(async () => (events.push("a"), 1));
    const b = semanticEngine.exclusive(async () => (events.push("b"), 2));
    expect(await Promise.all([a, b])).toEqual([1, 2]);
    expect(events).toEqual(["lock", "a", "unlock", "lock", "b", "unlock"]);
  });

  it("syncs the workspace again in each task, where an engine of its own may skip it", async () => {
    const sync = fakeSync();
    await semanticEngine.exclusive(() => semanticEngine.ensureWorkspaceLoaded(1));
    await semanticEngine.exclusive(() => semanticEngine.ensureWorkspaceLoaded(1));
    expect(sync).toHaveBeenCalledTimes(1);

    semanticEngine.shareWith((task) => task(live()));
    await semanticEngine.exclusive(() => semanticEngine.ensureWorkspaceLoaded(1));
    await semanticEngine.exclusive(() => semanticEngine.ensureWorkspaceLoaded(1));
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("fails a task whose lock could not be had, and goes on with the next", async () => {
    let refuse = true;
    semanticEngine.shareWith(async (task) => {
      if (refuse) throw new LockUnavailable("lock l stayed held elsewhere for 180 s");
      return task(live());
    });
    const task = vi.fn(async () => "ran");
    await expect(semanticEngine.exclusive(task)).rejects.toBeInstanceOf(LockUnavailable);
    expect(task).not.toHaveBeenCalled();
    refuse = false;
    expect(await semanticEngine.exclusive(task)).toBe("ran");
  });

  it("hands the lock the caller's signal, and aborts the task's engine requests with the lock's", async () => {
    const held = new AbortController();
    let given: AbortSignal | undefined;
    semanticEngine.shareWith((task, signal) => {
      given = signal;
      return task(held.signal);
    });
    const requests: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(init!.signal!);
      held.abort(new LockLost("lost lock l: its connection closed"));
      return untilStopped(init!.signal!);
    });
    const caller = new AbortController();

    const health = await semanticEngine.exclusive(() => semanticEngine.checkHealth(), { signal: caller.signal });

    expect(given).toBe(caller.signal);
    expect(health).toMatchObject({ alive: false, error: "lost lock l: its connection closed" });
    expect(requests[0].reason).toBeInstanceOf(LockLost);
    // Outside a task, a request carries its own timeout alone.
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      requests.push(init!.signal!);
      return new Response(JSON.stringify({ status: "ok", version: "test" }));
    });
    requests.length = 0;
    expect(await semanticEngine.checkHealth()).toMatchObject({ alive: true });
    expect(requests[0].aborted).toBe(false);
  });
});

describe("an engine of this process's own", () => {
  it("aborts a task's engine requests when the caller's signal aborts", async () => {
    const caller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      caller.abort(new Error("worker stopping"));
      return untilStopped(init!.signal!);
    });
    const health = await semanticEngine.exclusive(() => semanticEngine.checkHealth(), { signal: caller.signal });
    expect(health).toMatchObject({ alive: false, error: "worker stopping" });
  });

  it("lets a task called off while it waits for its turn go, without letting the next one in early", async () => {
    const order: string[] = [];
    let finishFirst!: () => void;
    const first = semanticEngine.exclusive(
      () =>
        new Promise<void>((resolve) => {
          order.push("first in");
          finishFirst = () => {
            order.push("first out");
            resolve();
          };
        }),
    );
    const caller = new AbortController();
    const second = semanticEngine.exclusive(async () => void order.push("second in"), { signal: caller.signal });
    const third = semanticEngine.exclusive(async () => void order.push("third in"));
    await vi.waitFor(() => expect(order).toEqual(["first in"]));

    caller.abort(new Error("lease lost"));
    await expect(second).rejects.toThrow("lease lost");
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["first in"]);

    finishFirst();
    await Promise.all([first, third]);
    expect(order).toEqual(["first in", "first out", "third in"]);
  });

  it("does not start a task whose caller has already given up", async () => {
    const caller = new AbortController();
    caller.abort(new Error("worker stopping"));
    const task = vi.fn(async () => 1);
    await expect(semanticEngine.exclusive(task, { signal: caller.signal })).rejects.toThrow("worker stopping");
    expect(task).not.toHaveBeenCalled();
  });
});

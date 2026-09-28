/**
 * An engine shared with other processes (semanticEngine.shareWith): each
 * exclusive task takes the lock they all take, one task at a time, and never
 * trusts that the store still holds what an earlier task loaded, since another
 * process may have loaded its own graph in between.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { semanticEngine } from "../services/semanticEngine";
import { LockUnavailable } from "../lib/namedLock";

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

describe("an engine shared with other processes", () => {
  it("takes the shared lock around each task, one task at a time", async () => {
    const events: string[] = [];
    semanticEngine.shareWith(async (task) => {
      events.push("lock");
      try {
        return await task();
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

    semanticEngine.shareWith((task) => task());
    await semanticEngine.exclusive(() => semanticEngine.ensureWorkspaceLoaded(1));
    await semanticEngine.exclusive(() => semanticEngine.ensureWorkspaceLoaded(1));
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("fails a task whose lock could not be had, and goes on with the next", async () => {
    let refuse = true;
    semanticEngine.shareWith(async (task) => {
      if (refuse) throw new LockUnavailable("lock l stayed held elsewhere for 60 s");
      return task();
    });
    const task = vi.fn(async () => "ran");
    await expect(semanticEngine.exclusive(task)).rejects.toBeInstanceOf(LockUnavailable);
    expect(task).not.toHaveBeenCalled();
    refuse = false;
    expect(await semanticEngine.exclusive(task)).toBe("ran");
  });
});

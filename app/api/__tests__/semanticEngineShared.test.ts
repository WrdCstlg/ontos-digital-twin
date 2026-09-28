/**
 * An engine shared with other processes (semanticEngine.shareWith): each
 * exclusive task takes the lock they all take, one task at a time, and never
 * trusts that the store still holds what an earlier task loaded, since another
 * process may have loaded its own graph in between. A task that must stop
 * (its lock lost, its job aborted) sends the engine nothing more, but holds
 * the engine until what it already sent has answered: the engine goes on with
 * a request its client gives up on, and would write into the next task's
 * store. A task called off while it waits for its turn lets nobody in early.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineInterference, semanticEngine } from "../services/semanticEngine";
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

  it("hands the lock the caller's signal; a task whose lock is lost sends nothing more, but lets a request already sent answer", async () => {
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
      return Response.json({ status: "ok", version: "test" });
    });
    const caller = new AbortController();

    const [first, second] = await semanticEngine.exclusive(async () => [await semanticEngine.checkHealth(), await semanticEngine.checkHealth()], {
      signal: caller.signal,
    });

    expect(given).toBe(caller.signal);
    // The first answered, though the lock was lost on its way; the second was never sent.
    expect(first).toMatchObject({ alive: true });
    expect(second).toMatchObject({ alive: false, error: "lost lock l: its connection closed" });
    expect(requests).toHaveLength(1);
    expect(requests[0].aborted).toBe(false);
  });

  it("sends the engine nothing once its task is told to stop, whatever the task asks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(semanticEngine, "ensureEngineRunning").mockResolvedValue(true);
    const stopped = new AbortController();
    stopped.abort(new LockLost("lost lock l: its connection closed"));
    semanticEngine.shareWith((task) => task(stopped.signal));
    const asks: (() => Promise<unknown>)[] = [
      () => semanticEngine.loadTurtle("<urn:a> <urn:b> <urn:c> ."),
      () => semanticEngine.clearStore(),
      () => semanticEngine.querySparql("SELECT * WHERE { ?s ?p ?o }"),
      () => semanticEngine.updateSparql("INSERT DATA { <urn:a> <urn:b> <urn:c> }"),
      () => semanticEngine.validateShacl(""),
      () => semanticEngine.runReasoning("rdfs"),
    ];
    for (const ask of asks) {
      await expect(semanticEngine.exclusive(ask), String(ask)).rejects.toBeInstanceOf(LockLost);
    }
    expect(await semanticEngine.exclusive(() => semanticEngine.checkHealth())).toMatchObject({ alive: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a task that asks for the engine again, which would wait for itself for ever holding the lock", async () => {
    semanticEngine.shareWith((task) => task(live()));
    const inner = vi.fn(async () => 1);
    await expect(semanticEngine.exclusive(() => semanticEngine.exclusive(inner))).rejects.toThrow("exclusive() is not re-entrant");
    expect(inner).not.toHaveBeenCalled();
    expect(await semanticEngine.exclusive(async () => "the next task runs")).toBe("the next task runs");
  });
});

describe("a reasoning run told to stop", () => {
  it("fails, rather than reporting a consistent graph with nothing inferred", async () => {
    const held = new AbortController();
    semanticEngine.shareWith((task) => task(held.signal));
    vi.spyOn(semanticEngine, "ensureEngineRunning").mockResolvedValue(true);
    vi.spyOn(semanticEngine, "checkHealth").mockResolvedValue({ alive: true, url: "http://engine", version: "test" });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init!.body)) as unknown;
      if (Array.isArray(body) && (body[0] as { command?: string })?.command === "reason") {
        held.abort(new LockLost("lost lock l: its connection closed"));
        return new Response(JSON.stringify([{ command: "reason", result: { initial_triples: 1, final_triples: 1, inferred_count: 0, iterations: 1 } }]));
      }
      return untilStopped(init!.signal!);
    });

    await expect(semanticEngine.exclusive(() => semanticEngine.runReasoning())).rejects.toBeInstanceOf(LockLost);
  });
});

describe("an engine of this process's own", () => {
  it("stops a task when the caller's signal aborts: it sends nothing more, and its request in flight answers", async () => {
    const caller = new AbortController();
    const requests: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(init!.signal!);
      caller.abort(new Error("worker stopping"));
      return Response.json({ status: "ok", version: "test" });
    });
    const [first, second] = await semanticEngine.exclusive(async () => [await semanticEngine.checkHealth(), await semanticEngine.checkHealth()], {
      signal: caller.signal,
    });
    expect(first).toMatchObject({ alive: true });
    expect(second).toMatchObject({ alive: false, error: "worker stopping" });
    expect(requests).toHaveLength(1);
    expect(requests[0].aborted).toBe(false);
  });

  it("holds the engine until a request in flight has answered, even once its task is told to stop", async () => {
    vi.spyOn(semanticEngine, "ensureEngineRunning").mockResolvedValue(true);
    let answer: ((r: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    const caller = new AbortController();
    const events: string[] = [];
    const first = semanticEngine.exclusive(
      async () => {
        await semanticEngine.querySparql("SELECT * WHERE { ?s ?p ?o }");
        events.push("first answered");
      },
      { signal: caller.signal },
    );
    const second = semanticEngine.exclusive(async () => void events.push("second in"));
    await vi.waitFor(() => expect(answer).toBeDefined());

    caller.abort(new Error("worker stopping"));
    await new Promise((r) => setTimeout(r, 20));
    // The engine is still at the first task's request: the next must not clear the store under it.
    expect(events).toEqual([]);

    answer!(Response.json({ variables: [], results: [] }));
    await Promise.all([first, second]);
    expect(events).toEqual(["first answered", "second in"]);
  });

  it("holds the engine for a request the task sent and did not wait for, as when a Promise.all fails fast", async () => {
    vi.spyOn(semanticEngine, "ensureEngineRunning").mockResolvedValue(true);
    let answerSlow: ((r: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const { query } = JSON.parse(String(init!.body)) as { query: string };
      if (query.includes("fast")) return new Response("refused", { status: 400 });
      return new Promise<Response>((resolve) => (answerSlow = resolve));
    });
    const events: string[] = [];
    const first = semanticEngine
      .exclusive(() => Promise.all([semanticEngine.querySparql("SELECT * WHERE { ?slow ?p ?o }"), semanticEngine.querySparql("SELECT * WHERE { ?fast ?p ?o }")]))
      .catch(() => events.push("first failed fast"));
    const second = semanticEngine.exclusive(async () => void events.push("second in"));
    await vi.waitFor(() => expect(answerSlow).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    // The first task failed, but the engine is still at its slow request.
    expect(events).toEqual([]);

    answerSlow!(Response.json({ variables: [], results: [] }));
    await Promise.all([first, second]);
    expect(events).toEqual(["first failed fast", "second in"]);
  });

  it("does not count work a task left behind (a timer) as the task once it is over", async () => {
    let later: Promise<string> | undefined;
    await new Promise<void>((ran) => {
      void semanticEngine.exclusive(async () => {
        // Scheduled inside the task, run after it ended: it may ask for a turn of its own.
        setTimeout(() => {
          later = semanticEngine.exclusive(async () => "a turn of its own");
          ran();
        }, 20);
      });
    });
    await expect(later).resolves.toBe("a turn of its own");
  });

  it("tries again, for a bounded time, a settling query the engine did not answer", async () => {
    const sent: string[] = [];
    let settles = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      sent.push(new URL(String(url)).pathname);
      if (String(url).endsWith("/health")) return untilStopped(init!.signal!);
      // The settling query: refused twice, then answered.
      return ++settles < 3 ? new Response("busy", { status: 503 }) : Response.json({ head: {}, boolean: true });
    });
    await semanticEngine.exclusive(() => semanticEngine.checkHealth());
    expect(settles).toBe(3);
    expect(sent).toEqual(["/health", "/api/query", "/api/query", "/api/query"]);
  }, 10_000);

  describe("a check on what a task loaded", () => {
    /** An engine whose store counts `counts` in turn: after the load, then after the check. */
    function counting(counts: number[]) {
      vi.spyOn(semanticEngine, "ensureEngineRunning").mockResolvedValue(true);
      vi.spyOn(semanticEngine, "clearStore").mockResolvedValue(true);
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ variables: ["n"], results: [{ n: `"${counts.shift()}"^^xsd:integer` }] }));
    }
    const check = () =>
      semanticEngine.exclusive(() =>
        semanticEngine.checkLoaded(
          async () => 14,
          async () => "the report",
        ),
      );

    it("stands when the store held what was loaded, before and after", async () => {
      counting([14, 14]);
      await expect(check()).resolves.toBe("the report");
    });

    it("is refused when the store held more than was loaded, none of it, or changed while the check ran", async () => {
      for (const counts of [
        [19, 19],
        [0, 0],
        [14, 20],
        [14, 0],
      ]) {
        counting([...counts]);
        await expect(check(), counts.join(" then ")).rejects.toBeInstanceOf(EngineInterference);
      }
    });
  });

  it("after a request of its times out, lets the engine go only once the engine has answered one more query", async () => {
    const sent: string[] = [];
    let settled: ((r: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      sent.push(`${new URL(String(url)).pathname} ${String(init?.body ?? "")}`);
      // The health check's own timeout (2 s) runs out: the engine may still be at it.
      if (String(url).endsWith("/health")) return untilStopped(init!.signal!);
      return new Promise<Response>((resolve) => (settled = resolve));
    });
    const events: string[] = [];
    const first = semanticEngine.exclusive(async () => {
      events.push(`first: ${(await semanticEngine.checkHealth()).alive ? "alive" : "no answer"}`);
    });
    const second = semanticEngine.exclusive(async () => void events.push("second in"));

    await vi.waitFor(() => expect(settled).toBeDefined(), { timeout: 5_000 });
    expect(sent.at(-1)).toMatch(/^\/api\/query .*ASK/);
    expect(events).toEqual(["first: no answer"]);

    settled!(Response.json({ head: {}, boolean: true }));
    await Promise.all([first, second]);
    expect(events).toEqual(["first: no answer", "second in"]);
  }, 10_000);

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

  it("keeps no finished task's result: the queue settles to nothing", async () => {
    await semanticEngine.exclusive(async () => ({ report: "x".repeat(1000) }));
    await expect(semanticEngine.exclusive(async () => Promise.reject(new Error("engine answered 500")))).rejects.toThrow();
    expect(await (semanticEngine as unknown as { queue: Promise<unknown> }).queue).toBeUndefined();
  });

  it("does not start a task whose caller has already given up", async () => {
    const caller = new AbortController();
    caller.abort(new Error("worker stopping"));
    const task = vi.fn(async () => 1);
    await expect(semanticEngine.exclusive(task, { signal: caller.signal })).rejects.toThrow("worker stopping");
    expect(task).not.toHaveBeenCalled();
  });
});

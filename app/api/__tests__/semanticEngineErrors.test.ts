/**
 * How the engine client reports a request that failed. An import that must be
 * checked retries when a later try may pass (the engine away, busy, timing
 * out), and fails for good with the engine's reason when the engine answered
 * that it cannot do what was asked (EngineRequestError).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineRequestError, engineRefusal, semanticEngine } from "../services/semanticEngine";

/** An engine that is up, and answers every other request with `answer()`. */
function engineAnswering(answer: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (String(url).endsWith("/health") ? Response.json({ status: "ok", version: "test" }) : answer())),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("a failed engine request", () => {
  it("is an EngineRequestError when the engine answered that it cannot do it", async () => {
    engineAnswering(() => Response.json([{ command: "shacl", result: { error: "No such file or directory (os error 2)" } }]));
    await expect(semanticEngine.validateShacl("")).rejects.toThrow(new EngineRequestError("No such file or directory (os error 2)"));

    engineAnswering(() => new Response("bad", { status: 400, statusText: "Bad Request" }));
    await expect(semanticEngine.validateShacl("")).rejects.toBeInstanceOf(EngineRequestError);

    engineAnswering(() => Response.json({ error: "Parser error: Invalid IRI code point ' '" }));
    await expect(semanticEngine.loadTurtle("<a b> <c> <d> .")).rejects.toBeInstanceOf(EngineRequestError);
  });

  it("is not when the engine failed, was busy or timed out: a later try may pass", async () => {
    for (const status of [503, 500, 429, 408]) {
      engineAnswering(() => new Response("", { status }));
      const err = await semanticEngine.validateShacl("").catch((e: unknown) => e);
      expect(err, String(status)).toBeInstanceOf(Error);
      expect(err, String(status)).not.toBeInstanceOf(EngineRequestError);
    }
  });
});

/**
 * The engine answers some refusals with HTTP 200 and a body that says nothing
 * useful: `null` from a REST route whose error message holds a quote, and
 * `{"raw": …}` inside a batch result, holding the error it could not encode.
 * Each is a refusal, never a result.
 */
describe("a refusal the engine could not put into words", () => {
  it("fails a load, a query and an update, where it used to throw a TypeError or pass", async () => {
    engineAnswering(() => Response.json(null));
    await expect(semanticEngine.loadTurtle("<a> <b> <c> .")).rejects.toThrow(EngineRequestError);
    await expect(semanticEngine.querySparql("SELECT * WHERE { ?s ?p ?o }")).rejects.toThrow(/^SPARQL error: the engine refused/);
    await expect(semanticEngine.updateSparql("INSERT DATA { <a> <b> <c> }")).rejects.toThrow(/^SPARQL update error: the engine refused/);
  });

  it("is a refusal inside a SHACL or reasoning result, with the engine's words when they can be read", async () => {
    const raw = `{"error":"Turtle parse error at "hr:Person""}`;
    engineAnswering(() => Response.json([{ seq: 0, command: "shacl", result: { raw } }]));
    await expect(semanticEngine.validateShacl("")).rejects.toThrow(new EngineRequestError(`Turtle parse error at "hr:Person"`));

    engineAnswering(() => Response.json([{ seq: 0, command: "reason", result: { raw } }]));
    await expect(semanticEngine.runReasoning("owl-rl")).rejects.toThrow(`Turtle parse error at "hr:Person"`);
  });

  it("gives no SHACL verdict when the engine's answer has none, rather than 'does not conform'", async () => {
    engineAnswering(() => Response.json([{ seq: 0, command: "shacl", result: { focus_nodes: 3 } }]));
    const err = await semanticEngine.validateShacl("").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EngineRequestError);
    expect(String(err)).toMatch(/no verdict/);
  });

  it("stops a clear the engine refused, so nothing is loaded on top of what the store still holds", async () => {
    engineAnswering(() => Response.json([{ seq: 0, command: "clear", result: { error: "store is read-only" } }]));
    await expect(semanticEngine.clearStore()).rejects.toThrow("Failed to clear the engine store: store is read-only");

    engineAnswering(() => Response.json([]));
    await expect(semanticEngine.clearStore()).rejects.toThrow(/no result/);

    engineAnswering(() => Response.json([{ seq: 0, command: "clear", result: { ok: true, message: "Store cleared" } }]));
    await expect(semanticEngine.clearStore()).resolves.toBe(true);
  });
});

describe("engineRefusal", () => {
  it("reads the three shapes of refusal, and nothing else", () => {
    expect(engineRefusal(null)).toMatch(/could not say why/);
    expect(engineRefusal({ error: "Parser error" })).toBe("Parser error");
    expect(engineRefusal({ raw: `{"error":"a "quoted" name"}` })).toBe(`a "quoted" name`);
    expect(engineRefusal({ ok: true, triples_loaded: 3 })).toBeNull();
    expect(engineRefusal({ conforms: true, violations: [] })).toBeNull();
    expect(engineRefusal({ error: "" })).toBeNull();
  });
});

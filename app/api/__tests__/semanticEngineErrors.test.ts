/**
 * How the engine client reports a request that failed. An import that must be
 * checked retries when a later try may pass (the engine away, busy, timing
 * out), and fails for good with the engine's reason when the engine answered
 * that it cannot do what was asked (EngineRequestError).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineRequestError, semanticEngine } from "../services/semanticEngine";

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

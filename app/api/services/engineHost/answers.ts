import { engineError } from "./errors";

/**
 * How open-ontologies v1.3.0 answers. Its REST handlers answer HTTP 200 even
 * when they refuse: the body is `{"error": "…"}`. The handler builds that JSON
 * by pasting the message between quotes, so a message that holds a quote is
 * not JSON, and the body becomes `null` (main.rs, the /api/* routes). In a
 * /api/batch result the same string survives, wrapped as `{"raw": "…"}`.
 */
export type EngineAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; message: string };

export const LOST_REASON =
  "The engine refused the request, and its reason was lost: the engine answers null when its message contains a quotation mark.";

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw engineError(`The engine answered something that is not JSON: ${text.slice(0, 200)}`);
  }
}

function errorText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The body of an HTTP 200 from /api/query, /api/update or /api/load. */
export function readEngineAnswer(text: string): EngineAnswer {
  const body = parse(text);
  if (body === null) return { ok: false, message: LOST_REASON };
  if (typeof body !== "object" || Array.isArray(body)) {
    throw engineError(`The engine answered an unexpected ${Array.isArray(body) ? "array" : typeof body}.`);
  }
  const record = body as Record<string, unknown>;
  if ("error" in record && record.error !== undefined && record.error !== null) {
    return { ok: false, message: errorText(record.error) };
  }
  return { ok: true, body: record };
}

/**
 * The engine's message from a `{"raw": …}` batch result: the malformed
 * `{"error":"…"}` text it could not parse, quotes and all.
 */
export function rawErrorMessage(raw: string): string {
  const m = /^\{\s*"error"\s*:\s*"([\s\S]*)"\s*\}$/.exec(raw.trim());
  return m ? m[1] : raw;
}

/**
 * The result of the one command sent to /api/batch. The batch answers an
 * array of `{seq, command, result}`; a body it could not parse answers
 * `[{seq: 0, command: "parse", error}]`.
 */
export function readBatchAnswer(text: string): EngineAnswer {
  const body = parse(text);
  if (!Array.isArray(body) || body.length === 0 || typeof body[0] !== "object" || body[0] === null) {
    throw engineError("The engine answered a batch without a result.");
  }
  const first = body[0] as { error?: unknown; result?: unknown };
  if (first.error !== undefined && first.error !== null) return { ok: false, message: errorText(first.error) };
  const result = first.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw engineError("The engine answered a batch command without a result object.");
  }
  const record = result as Record<string, unknown>;
  if (record.error !== undefined && record.error !== null) return { ok: false, message: errorText(record.error) };
  if (typeof record.raw === "string") return { ok: false, message: rawErrorMessage(record.raw) };
  return { ok: true, body: record };
}

import type { EngineState, HostErrorBody, HostErrorCode } from "./types";

/**
 * A request the host answers with something other than success. The route
 * layer turns it into `{ error: { code, message } }` with its status; nothing
 * else about the failure (paths, engine output) leaves the host unless the
 * message says so on purpose.
 */
export class HostError extends Error {
  constructor(
    readonly status: number,
    readonly code: HostErrorCode,
    message: string,
    readonly extra: { incarnation?: string | null; state?: EngineState; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "HostError";
  }

  body(): HostErrorBody {
    const body: HostErrorBody = { error: { code: this.code, message: this.message } };
    if (this.extra.incarnation !== undefined) body.incarnation = this.extra.incarnation;
    if (this.extra.state !== undefined) body.state = this.extra.state;
    return body;
  }
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const badRequest = (msg: string) => new HostError(400, "bad_request", msg);

export const tooLarge = (msg: string) => new HostError(413, "payload_too_large", msg);

/** The engine was reached and refused: asking again will not help. */
export const refused = (msg: string) => new HostError(422, "engine_refused", msg);

/** The engine answered something the host does not understand. */
export const engineError = (msg: string) => new HostError(502, "engine_error", msg);

export const unavailable = (msg: string, extra: HostError["extra"] = {}) =>
  new HostError(503, "engine_unavailable", msg, extra);

export const engineTimeout = (ms: number) =>
  new HostError(504, "engine_timeout", `The engine did not answer within ${ms} ms. It may still be working on the request.`);

export const shuttingDown = () => new HostError(503, "shutting_down", "The engine host is shutting down.");

export const incarnationMismatch = (current: string | null) =>
  new HostError(
    409,
    "incarnation_mismatch",
    current === null
      ? "This workspace's store has no incarnation yet: reset it before writing."
      : "The store was reset since this writer read its incarnation.",
    { incarnation: current },
  );

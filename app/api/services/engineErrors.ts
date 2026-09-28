/**
 * The engine was reached, and answered that it cannot do what was asked: data
 * it cannot parse, a shapes file it cannot read, a request it refuses (4xx).
 * Asking again will not help. Anything else that fails (the engine away, a
 * timeout, a 5xx) may pass on a later try.
 *
 * Its own module so the engine host's client can extend it without importing
 * semanticEngine.ts, and with it the database.
 */
export class EngineRequestError extends Error {}

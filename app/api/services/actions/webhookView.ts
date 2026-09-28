/**
 * An action's webhook address is often its credential: a Slack or Teams
 * incoming webhook, or a URL with a token in its path or query, lets anyone
 * who has it post as the integration. Only people who may author actions (who
 * wrote the address in) see it; everyone else sees where it goes: its origin.
 * The address travels in several places, and each is redacted here: action
 * definitions (current and every version), and the results and errors of the
 * jobs that deliver to it.
 */

/** Who may define action types (actionsRouter), and so see their webhook addresses in full. */
export const ACTION_AUTHOR_ROLES = ["admin", "ontologist"];

/** Where an address goes, and nothing that could let someone post to it. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "(hidden)";
    return u.pathname === "/" && !u.search && !u.hash ? u.origin : `${u.origin}/…`;
  } catch {
    return "(hidden)";
  }
}

/** Every http(s) address in a message (a delivery error quotes its URL), redacted. */
export function redactUrlsIn(text: string): string;
export function redactUrlsIn(text: string | null | undefined): string | null;
export function redactUrlsIn(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, (m) => redactUrl(m));
}

/** An action definition (parsed or as stored) with each side effect's address redacted. */
export function redactDefinition<T>(def: T): T {
  if (!def || typeof def !== "object") return def;
  const effects = (def as { sideEffects?: unknown }).sideEffects;
  if (!Array.isArray(effects)) return def;
  return {
    ...def,
    sideEffects: effects.map((e) =>
      e && typeof e === "object" && typeof (e as { url?: unknown }).url === "string"
        ? { ...e, url: redactUrl((e as { url: string }).url) }
        : e,
    ),
  } as T;
}

/** A webhook delivery's result ({ url, status }) with its address redacted. */
export function redactDeliveryResult<T>(result: T): T {
  if (!result || typeof result !== "object") return result;
  const url = (result as { url?: unknown }).url;
  return typeof url === "string" ? ({ ...result, url: redactUrl(url) } as T) : result;
}

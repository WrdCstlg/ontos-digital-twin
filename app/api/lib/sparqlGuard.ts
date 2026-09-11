/**
 * Read-only gate for the public SPARQL HTTP endpoint.
 *
 * The semantic engine exposes separate query and update channels, and the
 * endpoint is bound to the query channel. This gate keeps the HTTP surface
 * read-only regardless of how the engine chooses to handle a given string.
 */

/** SPARQL 1.1 query forms. Everything else — including update forms — is rejected. */
const READ_ONLY_FORMS = new Set(["SELECT", "ASK", "CONSTRUCT", "DESCRIBE"]);

/**
 * Update keywords. The lookbehind skips matches preceded by `?`/`$` (a variable
 * named `?delete`) or `:` (a prefixed name like `ex:insert`).
 */
const UPDATE_KEYWORDS_RE =
  /(?<![?$:\w])(?:INSERT|DELETE|DROP|CLEAR|LOAD|CREATE|COPY|MOVE|ADD)\b/i;

/**
 * String literals and IRIs. These are blanked before keyword scanning so that a
 * `#` inside an IRI is not mistaken for a comment, and an IRI containing
 * "insert" is not mistaken for an update.
 */
const LITERALS_RE =
  /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<[^>]*>/g;

/** Maximum accepted query length, mirroring the NLQ input cap in spirit. */
export const MAX_SPARQL_LENGTH = 10_000;

/** Strips `#` comments while leaving IRIs and string literals intact. */
function stripComments(raw: string): string {
  return raw.replace(new RegExp(`${LITERALS_RE.source}|#[^\\n\\r]*`, "g"), (m) =>
    m.startsWith("#") ? " " : m,
  );
}

/**
 * Returns true only for SPARQL 1.1 query forms that carry no update keywords.
 */
export function isReadOnlySparql(raw: string): boolean {
  const withoutComments = stripComments(raw);

  // Drop the prologue so the first remaining keyword is the query form.
  const body = withoutComments
    .replace(/^(?:\s*(?:BASE\s*<[^>]*>|PREFIX\s+[^\s]*\s*<[^>]*>))*\s*/i, "")
    .trimStart();

  const form = (body.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
  if (!READ_ONLY_FORMS.has(form)) return false;

  // Defense in depth: catch an update smuggled in after a valid query form.
  return !UPDATE_KEYWORDS_RE.test(withoutComments.replace(LITERALS_RE, " "));
}

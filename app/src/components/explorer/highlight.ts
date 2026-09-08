/**
 * Lightweight syntax highlighter for generated SPARQL / Cypher.
 * Line-based tokenizer tuned for the Ontos query layer:
 * keywords iris, namespace prefixes module-colored, strings emerald,
 * variables sky, numbers amber, comments muted.
 */

export interface Tok {
  text: string;
  color?: string;
  weight?: number;
  italic?: boolean;
}

export type QueryLang = 'sparql' | 'cypher';

const PREFIX_COLORS: Record<string, string> = {
  hr: '#FB7185',
  legal: '#A78BFA',
  lgl: '#A78BFA',
  cmp: '#34D399',
  fin: '#FBBF24',
  log: '#38BDF8',
  ext: '#94A3B8',
  rdf: '#64748B',
  rdfs: '#64748B',
  xsd: '#64748B',
  ontos: '#818CF8',
};

const IRIS = '#818CF8';
const EMERALD = '#34D399';
const SKY = '#7DD3FC';
const AMBER = '#FBBF24';
const MUTED = '#64748B';
const BODY = '#94A3B8';
const PRIMARY = '#F1F5F9';

const SPARQL_KW = new Set([
  'SELECT', 'WHERE', 'FILTER', 'NOT', 'EXISTS', 'OPTIONAL', 'BOUND', 'CONTAINS',
  'LCASE', 'NOW', 'ORDER', 'BY', 'LIMIT', 'DESC', 'ASC', 'DISTINCT', 'REDUCED',
  'GROUP', 'HAVING', 'UNION', 'VALUES', 'a', 'true', 'false', 'PREFIX',
]);

const CYPHER_KW = new Set([
  'MATCH', 'OPTIONAL', 'WHERE', 'RETURN', 'WITH', 'AS', 'ORDER', 'BY', 'DESC',
  'ASC', 'LIMIT', 'AND', 'OR', 'NOT', 'EXISTS', 'CONTAINS', 'DISTINCT',
  'count', 'sum', 'max', 'min', 'avg', 'collect', 'date', 'duration', 'toLower',
]);

const TOKEN_RE =
  /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\?\w+)|(\b(?:hr|lgl|legal|cmp|fin|log|ext|rdf|rdfs|xsd|ontos):[A-Za-z_]\w*)|(:[A-Za-z_]\w*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w-]*)|(\s+|.)/g;

/** Highlight a full query string into color tokens (newlines preserved). */
export function highlightQuery(code: string, lang: QueryLang): Tok[] {
  const kw = lang === 'sparql' ? SPARQL_KW : CYPHER_KW;
  const out: Tok[] = [];
  for (const line of code.split('\n')) {
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(line)) !== null) {
      const [text, comment, str, variable, prefixed, cyLabel, num, word] = m;
      if (comment) {
        out.push({ text, color: MUTED, italic: true });
      } else if (str) {
        out.push({ text, color: EMERALD });
      } else if (variable) {
        out.push({ text, color: SKY });
      } else if (prefixed) {
        const idx = text.indexOf(':');
        const prefix = text.slice(0, idx);
        out.push({ text: `${prefix}:`, color: PREFIX_COLORS[prefix] ?? MUTED, weight: 500 });
        out.push({ text: text.slice(idx + 1), color: PRIMARY });
      } else if (cyLabel) {
        // Cypher label like :hr_Person — color by module prefix before "_"
        const pfx = text.slice(1).split('_')[0].toLowerCase();
        out.push({ text, color: PREFIX_COLORS[pfx] ?? BODY, weight: 500 });
      } else if (num) {
        out.push({ text, color: AMBER });
      } else if (word) {
        out.push(kw.has(word) ? { text, color: IRIS, weight: 600 } : { text, color: BODY });
      } else {
        out.push({ text, color: BODY });
      }
    }
    out.push({ text: '\n' });
  }
  out.pop();
  return out;
}

const WRITE_RE = /\b(INSERT|DELETE|DROP|UPDATE|CREATE|CLEAR|LOAD|COPY|MOVE|ADD)\b/i;

/** Strip comment lines the same way the backend guard does, then test for writes. */
export function findWriteOp(code: string): string | null {
  const stripped = code
    .replace(/^#[^\n]*\n?/gm, '')
    .replace(/\/\/[^\n]*/g, '');
  const m = stripped.match(WRITE_RE);
  return m ? m[1].toUpperCase() : null;
}

const LINE_EXPLANATIONS: [RegExp, string][] = [
  [/^#\s*intent:/, 'Simulator intent marker — the read-only executor only runs queries carrying a known intent.'],
  [/^#\s*bindings:/, 'Extracted entities from your question, injected as values.'],
  [/\bhr:signs\b|SIGNS/, 'People who signed a contract.'],
  [/\bcmp:governs\b|GOVERNS/, 'Compliance policies that govern the contract.'],
  [/againstPolicy|AGAINST_POLICY/, 'Audit findings raised against the policy.'],
  [/\bcmp:status\b|status\s*[=:]/, 'Filter on a status value.'],
  [/\bfin:paidTo\b|PAID_TO/, 'Payment transactions sent to a vendor.'],
  [/\bfin:bookedTo\b|BOOKED_TO/, 'Transactions booked to a cost center.'],
  [/\bhr:reportsTo\b|REPORTS_TO/, 'Org-chart reporting edges.'],
  [/\bcmp:hasEvidence\b|HAS_EVIDENCE/, 'Evidence collected for a control.'],
  [/\blgl:withParty\b|WITH_PARTY/, 'Contracts linked to a party (vendor).'],
  [/\blgl:inJurisdiction\b|IN_JURISDICTION/, 'Contracts and their governing jurisdictions.'],
  [/\blog:onRoute\b|ON_ROUTE/, 'The route a shipment is on.'],
  [/\blog:shippedBy\b|SHIPPED_BY/, 'The carrier hauling the shipment.'],
  [/FILTER\s*!\s*EXISTS|FILTER\s+NOT\s+EXISTS|WHERE\s+NOT/, 'Exclude anything where this pattern exists.'],
  [/OPTIONAL/, 'Include this when present, but don’t require it.'],
  [/rdfs:label/, 'Match on the human-readable label.'],
  [/^\s*(SELECT|RETURN)\b/, 'The columns returned in the result set.'],
  [/ORDER\s+BY/, 'Sort the results.'],
  [/LIMIT/, 'Cap the number of results.'],
];

/** Plain-English tooltip for a query line (Explain mode). */
export function explainLine(line: string): string | null {
  if (!line.trim()) return null;
  for (const [re, text] of LINE_EXPLANATIONS) {
    if (re.test(line)) return text;
  }
  return null;
}

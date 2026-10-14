/**
 * The fixtures of xfnSemanticLayer.test.ts, transcribed from section 5 of
 * docs/specs/2026-10-14-xfn-semantic-layer-cycle-1-rerun.md: the prefix block P, the envelope
 * macro ENV, BASE and the additions cases name (5.2), the refusal cases (5.4) and the
 * acceptance fixtures (5.5). Section 4.3's Cases column is here too, as CONSTRAINT_CASES: the
 * mutant campaign (T6) disables one constraint at a time and expects the cases listed
 * against it to fail.
 *
 * A refusal case is BASE with one change, applied to BASE's triples. A change that names a
 * triple BASE does not hold, or adds one BASE already holds, throws: a mistyped case must
 * never run as BASE unchanged.
 */

// ---------------------------------------------------------------------------------------------
// P and ENV (5.2)
// ---------------------------------------------------------------------------------------------

export const P = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix xfn:  <https://ontos.dev/ontology/xfn/> .
@prefix hr:   <https://ontos.dev/ontology/hr/> .
@prefix bf:   <https://ontos.dev/ontology/xfn/BusinessFunction/> .
@prefix pos:  <https://ontos.dev/ontology/xfn/Position/> .
@prefix v:    <https://ontos.dev/ontology/xfn/Variable/> .
@prefix o:    <https://ontos.dev/ontology/xfn/Outcome/> .
@prefix d:    <https://ontos.dev/ontology/xfn/Decision/> .
@prefix ec:   <https://ontos.dev/ontology/xfn/EffectClaim/> .
@prefix com:  <https://ontos.dev/ontology/xfn/Commitment/> .
@prefix td:   <https://ontos.dev/ontology/xfn/TermDeviation/> .
@prefix ev:   <https://ontos.dev/ontology/xfn/EvidenceItem/> .
@prefix md:   <https://ontos.dev/ontology/xfn/MetricDefinition/> .
@prefix mv:   <https://ontos.dev/ontology/xfn/MetricVersion/> .
@prefix vo:   <https://ontos.dev/ontology/xfn/VariableOperationalisation/> .
@prefix mb:   <https://ontos.dev/ontology/xfn/MetricBinding/> .
@prefix per:  <https://ontos.dev/ontology/hr/Person/> .
@prefix ctr:  <https://ontos.dev/ontology/lgl/Contract/> .
@prefix pty:  <https://ontos.dev/ontology/lgl/Party/> .
`;

const NS: Record<string, string> = Object.fromEntries(
  [...P.matchAll(/@prefix\s+([A-Za-z]+):\s+<([^>]+)>\s*\./g)].map((m) => [m[1], m[2]]),
);

/** Expands the envelope macro: ENV(p), ENV(p, t) and ENV(p, r, t, c, s). */
export function expandEnv(text: string): string {
  return text.replace(/ENV\(([^)]*)\)/g, (_, args: string) => {
    const a = args.split(",").map((s) => s.trim());
    const [person, recorder, time, access, status] =
      a.length === 1 ? [a[0], a[0], "2025-01-15T09:00:00Z", "open", "asserted"]
      : a.length === 2 ? [a[0], a[0], a[1], "open", "asserted"]
      : a.length === 5 ? a
      : (() => { throw new Error(`ENV takes 1, 2 or 5 arguments, not ${a.length}: ENV(${args})`); })();
    return `xfn:attributedTo per:${person} ; xfn:recordedBy per:${recorder} ; xfn:recordedAt "${time}"^^xsd:dateTime ; xfn:accessClass "${access}" ; xfn:recordStatus "${status}"`;
  });
}

/** P followed by a fixture body, with ENV expanded: the Turtle a test loads. */
export const fixture = (body: string): string => P + expandEnv(body);

// ---------------------------------------------------------------------------------------------
// The subset of Turtle the fixtures use, as triples
// ---------------------------------------------------------------------------------------------

/** A triple of N-Triples terms: `<iri>`, `"lexical"` or `"lexical"^^<datatype>`. */
export type Triple = readonly [s: string, p: string, o: string];

type Token = { kind: "term" | "a" | "punct"; text: string };

// Statements, `;` and `,` lists, `a`, IRIs, prefixed names and plain or datatyped string
// literals without escapes. Anything else throws, so the parser can never drop input silently.
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const pname = (at: number) => /^([A-Za-z][A-Za-z0-9]*):([A-Za-z0-9_][A-Za-z0-9_-]*)/.exec(text.slice(at));
  const expand = (m: RegExpExecArray) => {
    const ns = NS[m[1]];
    if (!ns) throw new Error(`unknown prefix '${m[1]}:'`);
    return `<${ns}${m[2]}>`;
  };
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "#") { const nl = text.indexOf("\n", i); i = nl < 0 ? text.length : nl; continue; }
    if (";,.".includes(ch)) { out.push({ kind: "punct", text: ch }); i++; continue; }
    if (ch === "<") {
      const end = text.indexOf(">", i);
      const iri = end < 0 ? "" : text.slice(i + 1, end);
      if (!/^[^\s<>"]+$/.test(iri)) throw new Error(`bad IRI at ${i}: ${text.slice(i, i + 40)}`);
      out.push({ kind: "term", text: `<${iri}>` });
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new Error(`unterminated literal at ${i}`);
      const lexical = text.slice(i + 1, end);
      if (lexical.includes("\\") || lexical.includes("\n")) throw new Error(`escapes and newlines are outside the fixture subset: "${lexical}"`);
      i = end + 1;
      if (text.startsWith("^^", i)) {
        const m = pname(i + 2);
        if (!m) throw new Error(`bad datatype at ${i}`);
        out.push({ kind: "term", text: `"${lexical}"^^${expand(m)}` });
        i += 2 + m[0].length;
      } else {
        if (text[i] === "@") throw new Error("language tags are outside the fixture subset");
        out.push({ kind: "term", text: `"${lexical}"` });
      }
      continue;
    }
    if (ch === "a" && /\s/.test(text[i + 1] ?? "")) { out.push({ kind: "a", text: "a" }); i++; continue; }
    const m = pname(i);
    if (m) { out.push({ kind: "term", text: expand(m) }); i += m[0].length; continue; }
    throw new Error(`unexpected input at ${i}: ${text.slice(i, i + 40)}`);
  }
  return out;
}

const RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";

/** Parses a fixture body (no prefix lines; ENV allowed) into triples, in order. */
export function parseTriples(body: string): Triple[] {
  const toks = tokenize(expandEnv(body));
  const out: Triple[] = [];
  let k = 0;
  const next = (what: string) => {
    const t = toks[k++];
    if (!t) throw new Error(`input ends where ${what} was expected`);
    return t;
  };
  const isPunct = (c: string) => toks[k]?.kind === "punct" && toks[k]?.text === c;
  const resource = (t: Token, what: string) => {
    if (t.kind !== "term" || !t.text.startsWith("<")) throw new Error(`${what} must be an IRI, not ${t.text}`);
    return t.text;
  };
  while (k < toks.length) {
    const s = resource(next("a subject"), "a subject");
    for (;;) {
      const v = next("a predicate");
      const p = v.kind === "a" ? RDF_TYPE : resource(v, "a predicate");
      for (;;) {
        const o = next("an object");
        if (o.kind !== "term") throw new Error(`an object cannot be '${o.text}'`);
        out.push([s, p, o.text]);
        if (!isPunct(",")) break;
        k++;
      }
      if (!isPunct(";")) break;
      k++;
      if (isPunct(".")) break;
    }
    const end = next("'.'");
    if (end.kind !== "punct" || end.text !== ".") throw new Error(`expected '.', found '${end.text}'`);
  }
  return out;
}

/** One term written as in a fixture: a prefixed name, `<iri>` or a literal. */
export function term(text: string): string {
  const toks = tokenize(text);
  if (toks.length !== 1 || toks[0].kind !== "term") throw new Error(`not one term: ${text}`);
  return toks[0].text;
}

/** A focus node as the engine reports it: the bare IRI. */
export const iri = (text: string): string => term(text).replace(/^<|>$/g, "");

/** P followed by the triples, one per line. */
export const serialize = (triples: readonly Triple[]): string => P + triples.map((t) => `${t.join(" ")} .`).join("\n") + "\n";

// ---------------------------------------------------------------------------------------------
// BASE and its additions (5.2)
// ---------------------------------------------------------------------------------------------

export const BASE_BODY = `
bf:Enterprise  a xfn:BusinessFunction .
bf:Procurement a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
bf:Quality     a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
pos:CPO a xfn:Position ; rdfs:label "Chief Procurement Officer" .
pos:GC  a xfn:Position ; rdfs:label "General Counsel" .
per:A a hr:Person .
per:B a hr:Person .

v:V1 a xfn:Variable ; xfn:variableDefinition "Primary supplier of component C" ; ENV(A) .
v:V2 a xfn:Variable ; xfn:variableDefinition "Incoming quality of component C" ; ENV(A) .
v:V3 a xfn:Variable ; xfn:variableDefinition "Total cost of supply of component C" ; ENV(A) .
v:V4 a xfn:Variable ; xfn:variableDefinition "Purchase spend on component C" ; ENV(A) .
v:V5 a xfn:Variable ; xfn:variableDefinition "Cost of poor quality on component C" ; ENV(A) .

d:D1 a xfn:Decision ;
  xfn:statement "Replace the primary supplier of component C" ;
  xfn:decidedBy per:A ; xfn:decidedInCapacityOf pos:CPO ;
  xfn:decidedOn "2024-11-20"^^xsd:date ; xfn:intervenesOn v:V1 ; ENV(A) .

ev:EV1 a xfn:EvidenceItem ;
  xfn:evidenceSummary "Incoming inspection results for component C, December" ;
  xfn:evidenceSourceSystem "Quality inspection log" ; ENV(B) .
ev:EV2 a xfn:EvidenceItem ;
  xfn:evidenceSummary "The email in which the volume promise was given" ;
  xfn:evidenceSourceSystem "Mail archive" ; xfn:sourceLocator "mail export M-1" ; ENV(A) .

ec:EC1 a xfn:EffectClaim ;
  xfn:statement "The supplier change lowered incoming part quality" ;
  xfn:claimedCause v:V1 ; xfn:claimedEffect v:V2 ; xfn:viaDecision d:D1 ;
  xfn:onBehalfOf bf:Quality ; xfn:citesEvidence ev:EV1 ; ENV(B) .

o:O-total a xfn:Outcome ; xfn:statedOver v:V3 ; xfn:inRemitOf bf:Enterprise ;
  xfn:compositionKind "additive" ; xfn:unitDimension "money" ;
  xfn:hasConstituent o:O-a , o:O-b ; ENV(A) .
o:O-a a xfn:Outcome ; xfn:statedOver v:V4 ; xfn:inRemitOf bf:Procurement ;
  xfn:unitDimension "money" ; ENV(A) .
o:O-b a xfn:Outcome ; xfn:statedOver v:V5 ; xfn:inRemitOf bf:Quality ;
  xfn:unitDimension "money" ; ENV(B) .

com:C1 a xfn:Commitment ;
  xfn:statement "We will buy at least 100,000 units a year for three years" ;
  xfn:commitmentDirection "given" ; xfn:promisedBy per:A ; xfn:promisedInCapacityOf pos:CPO ;
  xfn:promisedOn "2024-11-18"^^xsd:date ; xfn:commitmentCounterparty pty:P1 ;
  xfn:capturedIn "email" ; xfn:citesEvidence ev:EV2 ; ENV(A) .

td:TD1 a xfn:TermDeviation ;
  xfn:deviationInContract ctr:K1 ; xfn:termKind "indemnity" ;
  xfn:deviationDirection "absent" ; xfn:benchmarkContract ctr:K0 ;
  ENV(B, B, 2025-01-15T09:00:00Z, restricted, asserted) .

md:MD1 a xfn:MetricDefinition ; xfn:metricName "Purchase spend" ; xfn:definedByFunction bf:Procurement .
mv:MV1 a xfn:MetricVersion ; xfn:versionOf md:MD1 ;
  xfn:definitionText "Invoiced amount for component C in the period" ; ENV(A) .
vo:VO1 a xfn:VariableOperationalisation ; xfn:operationalises v:V4 ; xfn:measuredBy mv:MV1 ; ENV(A) .
mb:MB1 a xfn:MetricBinding ; xfn:holder pos:CPO ; xfn:bindsMetric md:MD1 ; xfn:boundVersion mv:MV1 ; ENV(B) .
`;

const variable = (n: number) => `v:V${n} a xfn:Variable ; xfn:variableDefinition "Unit price of component C, version ${n}" ; ENV(A) .`;

export const ADDITIONS = {
  V6: variable(6),
  V7: variable(7),
  V8: variable(8),
  D2: `d:D2 a xfn:Decision ; xfn:statement "Renew the supply agreement for component C" ; xfn:decidedBy per:A ; xfn:decidedInCapacityOf pos:CPO ; xfn:decidedOn "2024-12-01"^^xsd:date ; xfn:intervenesOn v:V1 ; ENV(A) .`,
  M2: `md:MD2 a xfn:MetricDefinition ; xfn:metricName "Purchase spend" ; xfn:definedByFunction bf:Quality .
mv:MV2 a xfn:MetricVersion ; xfn:versionOf md:MD2 ; xfn:definitionText "Purchase spend as Quality counts it" ; ENV(B) .`,
} as const;
export type Addition = keyof typeof ADDITIONS;

export const BASE: readonly Triple[] = parseTriples(BASE_BODY);

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

/** One change to BASE. Predicates without a prefix are in xfn:. */
export type Change =
  | { add: string } // Turtle, ENV allowed
  | { addition: Addition }
  | { remove: [s: string, p: string] } // every triple with subject s and predicate p
  | { removeTriple: [s: string, p: string, o: string] }
  | { replace: [s: string, p: string, from: string, to: string] };

const pred = (p: string) => term(p.includes(":") ? p : `xfn:${p}`);
const same = (a: Triple, b: Triple) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function addAll(out: Triple[], triples: Triple[], why: string): void {
  for (const t of triples) {
    if (out.some((u) => same(u, t))) throw new Error(`${why}: adds ${t.join(" ")}, which is already there`);
    out.push(t);
  }
}

function removeOne(out: Triple[], t: Triple, why: string): void {
  const at = out.findIndex((u) => same(u, t));
  if (at < 0) throw new Error(`${why}: removes ${t.join(" ")}, which is not there`);
  out.splice(at, 1);
}

/** BASE with the changes applied, in order. */
export function applyChanges(changes: readonly Change[], base: readonly Triple[] = BASE): Triple[] {
  const out = [...base];
  for (const c of changes) {
    const why = JSON.stringify(c);
    if ("add" in c) addAll(out, parseTriples(c.add), why);
    else if ("addition" in c) addAll(out, parseTriples(ADDITIONS[c.addition]), why);
    else if ("remove" in c) {
      const [s, p] = [term(c.remove[0]), pred(c.remove[1])];
      const kept = out.filter((t) => !(t[0] === s && t[1] === p));
      if (kept.length === out.length) throw new Error(`${why}: there is no such triple to remove`);
      out.splice(0, out.length, ...kept);
    } else if ("removeTriple" in c) {
      const [s, p, o] = c.removeTriple;
      removeOne(out, [term(s), pred(p), term(o)], why);
    } else {
      const [s, p, from, to] = c.replace;
      removeOne(out, [term(s), pred(p), term(from)], why);
      addAll(out, [[term(s), pred(p), term(to)]], why);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Refusal cases (5.4)
// ---------------------------------------------------------------------------------------------

/** The constraint component a result names in its `constraint` field (T2). */
export type Component = "minCount" | "maxCount" | "class" | "nodeKind" | "datatype" | "in" | "sparql";

/** One expected result: unit, focus node (as in the fixture) and the component it breaks. */
export type Expected = readonly [unit: string, focus: string, component: Component];

export type RefusalCase = { id: string; changes: Change[]; expected: Expected[] };
export type Refusal = { id: string; title: string; cases: RefusalCase[] };

const add = (ttl: string): Change => ({ add: ttl });
const addition = (...names: Addition[]): Change[] => names.map((n) => ({ addition: n }));
const remove = (s: string, ...ps: string[]): Change[] => ps.map((p) => ({ remove: [s, p] }));
const removeTriple = (s: string, p: string, o: string): Change => ({ removeTriple: [s, p, o] });
const replace = (s: string, p: string, from: string, to: string): Change => ({ replace: [s, p, from, to] });
const c = (id: string, changes: Change | Change[], ...expected: Expected[]): RefusalCase => ({
  id,
  changes: Array.isArray(changes) ? changes : [changes],
  expected,
});
const envelope = (focus: string): Expected[] => [
  ["XR-03a", focus, "minCount"],
  ["XR-03b", focus, "minCount"],
  ["XR-03c", focus, "minCount"],
];

/** The 29 names refused this cycle (4.1), in REFUSE-19's numbering. */
export const REFUSED_NAMES = [
  "ControlledTerm", "AnalyticAgent", "Deliberation", "BoundaryObject", "LegalEntity", "Perspective",
  "PerspectiveCorrespondence", "Handoff", "Transfer", "AccountabilityAssertion", "DecisionRight",
  "Answerability", "DecisionDomain", "DimensionBinding", "GrainDimension", "Claim", "ProxyClaim",
  "DivergenceClaim", "ForecastClaim", "Appraisal", "Reading", "InterventionSetting",
  "VariableCorrespondence", "BoundaryConcept", "BoundaryInstance", "BoundaryMedium", "SeatOccupancy",
  "SeatRelation", "DecisionQuestion",
] as const;

const R03_RECORDS = ["v:V1", "o:O-a", "d:D1", "ec:EC1", "com:C1", "td:TD1", "ev:EV1", "mv:MV1", "vo:VO1", "mb:MB1"];
const R2 = "<https://ontos.dev/ontology/xfn/AttributedRecord/R-2>";
const R1 = "<https://ontos.dev/ontology/xfn/AttributedRecord/R-1>";

export const REFUSALS: Refusal[] = [
  {
    id: "REFUSE-01",
    title: "Direct Variable-to-Variable triples",
    cases: [c("R01-a", add("v:V1 xfn:causes v:V2 ."), ["XR-01", "v:V1", "sparql"])],
  },
  {
    id: "REFUSE-02",
    title: "Decompositions in mixed or unstated dimensions",
    cases: [
      c("R02-a", replace("o:O-b", "unitDimension", '"money"', '"count"'), ["XR-02d", "o:O-total", "sparql"]),
      c("R02-b", remove("o:O-b", "unitDimension"), ["XR-02c", "o:O-total", "sparql"]),
      c("R02-c", remove("o:O-total", "unitDimension"), ["XR-02b", "o:O-total", "sparql"]),
      c("R02-d", remove("o:O-total", "compositionKind"), ["XR-02a", "o:O-total", "sparql"]),
      c("R02-e", replace("o:O-total", "compositionKind", '"additive"', '"multiplicative"'), ["XR-02e", "o:O-total", "in"]),
      c("R02-f", add('o:O-total xfn:unitDimension "count" .'), ["XR-02f", "o:O-total", "maxCount"], ["XR-02d", "o:O-total", "sparql"]),
    ],
  },
  {
    id: "REFUSE-03",
    title: "Unattributed records",
    cases: [
      ...R03_RECORDS.map((focus, i) =>
        c(`R03-${"abcdefghij"[i]}`, remove(focus, "attributedTo", "recordedBy", "recordedAt"), ...envelope(focus)),
      ),
      c(
        "R03-k",
        add(`${R2} a xfn:AttributedRecord .`),
        ...envelope(R2),
        ["XR-06", R2, "minCount"],
        ["XR-07", R2, "minCount"],
        ["XR-19b", R2, "sparql"],
      ),
      c("R03-l", add("v:V1 xfn:attributedTo per:B ."), ["XR-03a", "v:V1", "maxCount"]),
      c("R03-m", replace("v:V1", "attributedTo", "per:A", '"A"'), ["XR-03a", "v:V1", "nodeKind"]),
      c("R03-n", add("v:V1 xfn:recordedBy per:B ."), ["XR-03b", "v:V1", "maxCount"]),
      c("R03-o", replace("v:V1", "recordedBy", "per:A", '"A"'), ["XR-03b", "v:V1", "nodeKind"]),
      c("R03-p", add('v:V1 xfn:recordedAt "2025-01-16T09:00:00Z"^^xsd:dateTime .'), ["XR-03c", "v:V1", "maxCount"]),
      c("R03-q", replace("v:V1", "recordedAt", '"2025-01-15T09:00:00Z"^^xsd:dateTime', '"2025-01-15T09:00:00Z"'), ["XR-03c", "v:V1", "datatype"]),
    ],
  },
  {
    id: "REFUSE-04",
    title: "ExposureGap in this layer",
    cases: [
      c("R04-a", add("<https://ontos.dev/ontology/xfn/ExposureGap/EG-1> a xfn:ExposureGap ."), [
        "XR-04",
        "<https://ontos.dev/ontology/xfn/ExposureGap/EG-1>",
        "maxCount",
      ]),
    ],
  },
  {
    id: "REFUSE-05",
    title: "A privileged record with no holder",
    cases: [
      c("R05-a", replace("ec:EC1", "accessClass", '"open"', '"privileged"'), ["XR-05a", "ec:EC1", "sparql"]),
      c("R05-b", replace("d:D1", "accessClass", '"open"', '"privileged"'), ["XR-05a", "d:D1", "sparql"]),
      c(
        "R05-c",
        [replace("ec:EC1", "accessClass", '"open"', '"privileged"'), add("ec:EC1 xfn:privilegeHolder per:B .")],
        ["XR-05b", "ec:EC1", "class"],
      ),
      c("R05-d", add("ec:EC1 xfn:privilegeHolder pos:CPO , pos:GC ."), ["XR-05b", "ec:EC1", "maxCount"]),
    ],
  },
  {
    id: "REFUSE-06",
    title: "Access class missing, doubled or outside the list",
    cases: [
      c("R06-a", replace("ec:EC1", "accessClass", '"open"', '"public"'), ["XR-06", "ec:EC1", "in"]),
      c("R06-b", remove("ec:EC1", "accessClass"), ["XR-06", "ec:EC1", "minCount"]),
      c("R06-c", add('ec:EC1 xfn:accessClass "restricted" .'), ["XR-06", "ec:EC1", "maxCount"]),
    ],
  },
  {
    id: "REFUSE-07",
    title: "A verdict status",
    cases: [
      c("R07-a", replace("ec:EC1", "recordStatus", '"asserted"', '"verified"'), ["XR-07", "ec:EC1", "in"]),
      c("R07-b", remove("ec:EC1", "recordStatus"), ["XR-07", "ec:EC1", "minCount"]),
      c("R07-c", add('ec:EC1 xfn:recordStatus "draft" .'), ["XR-07", "ec:EC1", "maxCount"]),
    ],
  },
  {
    id: "REFUSE-08",
    title: "Unbounded revision",
    cases: [
      c("R08-a", [...addition("V6", "V7"), add("v:V6 xfn:revises v:V7 . v:V7 xfn:revises v:V6 .")], ["XR-08c", "v:V6", "sparql"], ["XR-08c", "v:V7", "sparql"]),
      c("R08-b", [...addition("V6", "V7", "V8"), add("v:V8 xfn:revises v:V6 , v:V7 .")], ["XR-08a", "v:V8", "maxCount"]),
      c("R08-c", [...addition("V6"), add("v:V6 xfn:revises d:D1 .")], ["XR-08b", "v:V6", "sparql"]),
      c("R08-d", [...addition("V6"), add("v:V6 xfn:revises v:V6 .")], ["XR-08c", "v:V6", "sparql"]),
    ],
  },
  {
    id: "REFUSE-09",
    title: "Effect claim without its parts",
    cases: [
      c("R09-a", remove("ec:EC1", "claimedCause"), ["XR-09a", "ec:EC1", "minCount"]),
      c("R09-b", remove("ec:EC1", "claimedEffect"), ["XR-09b", "ec:EC1", "minCount"]),
      c("R09-c", remove("ec:EC1", "viaDecision"), ["XR-09c", "ec:EC1", "minCount"]),
      c("R09-d", remove("ec:EC1", "onBehalfOf"), ["XR-09d", "ec:EC1", "minCount"]),
      c("R09-e", remove("ec:EC1", "statement"), ["XR-09e", "ec:EC1", "minCount"]),
      c("R09-f", replace("ec:EC1", "claimedEffect", "v:V2", "ev:EV1"), ["XR-09b", "ec:EC1", "class"]),
      c("R09-g", add("ec:EC1 xfn:claimedMediator ev:EV1 ."), ["XR-09f", "ec:EC1", "class"]),
      c("R09-h", add("ec:EC1 xfn:claimedEffect v:V5 ."), ["XR-09b", "ec:EC1", "maxCount"]),
      c("R09-i", replace("ec:EC1", "claimedCause", "v:V1", "ev:EV1"), ["XR-09a", "ec:EC1", "class"]),
      c("R09-j", [...addition("D2"), add("ec:EC1 xfn:viaDecision d:D2 .")], ["XR-09c", "ec:EC1", "maxCount"]),
      c("R09-k", replace("ec:EC1", "viaDecision", "d:D1", "ev:EV1"), ["XR-09c", "ec:EC1", "class"]),
      c("R09-l", add("ec:EC1 xfn:onBehalfOf bf:Procurement ."), ["XR-09d", "ec:EC1", "maxCount"]),
      c("R09-m", replace("ec:EC1", "onBehalfOf", "bf:Quality", "pos:CPO"), ["XR-09d", "ec:EC1", "class"]),
    ],
  },
  {
    id: "REFUSE-10",
    title: "A cause the decision did not set",
    cases: [c("R10-a", replace("ec:EC1", "claimedCause", "v:V1", "v:V4"), ["XR-10", "ec:EC1", "sparql"])],
  },
  {
    id: "REFUSE-11",
    title: "Cause equals effect",
    cases: [c("R11-a", replace("ec:EC1", "claimedEffect", "v:V2", "v:V1"), ["XR-11", "ec:EC1", "sparql"])],
  },
  {
    id: "REFUSE-12",
    title: "A decision without who, seat, date, lever or words",
    cases: [
      c("R12-a", remove("d:D1", "decidedBy"), ["XR-12a", "d:D1", "minCount"]),
      c("R12-b", remove("d:D1", "decidedInCapacityOf"), ["XR-12b", "d:D1", "minCount"]),
      c("R12-c", replace("d:D1", "decidedInCapacityOf", "pos:CPO", "per:A"), ["XR-12b", "d:D1", "class"]),
      c("R12-d", remove("d:D1", "decidedOn"), ["XR-12c", "d:D1", "minCount"]),
      c("R12-e", remove("d:D1", "intervenesOn"), ["XR-12d", "d:D1", "minCount"], ["XR-10", "ec:EC1", "sparql"]),
      c("R12-f", remove("d:D1", "statement"), ["XR-12e", "d:D1", "minCount"]),
      c("R12-g", add("d:D1 xfn:decidedBy per:B ."), ["XR-12a", "d:D1", "maxCount"]),
      c("R12-h", replace("d:D1", "decidedBy", "per:A", '"A"'), ["XR-12a", "d:D1", "nodeKind"]),
      c("R12-i", add("d:D1 xfn:decidedInCapacityOf pos:GC ."), ["XR-12b", "d:D1", "maxCount"]),
      c("R12-j", add('d:D1 xfn:decidedOn "2024-11-21"^^xsd:date .'), ["XR-12c", "d:D1", "maxCount"]),
      c("R12-k", replace("d:D1", "decidedOn", '"2024-11-20"^^xsd:date', '"2024-11-20"'), ["XR-12c", "d:D1", "datatype"]),
      c("R12-l", add("d:D1 xfn:intervenesOn ev:EV1 ."), ["XR-12d", "d:D1", "class"]),
    ],
  },
  {
    id: "REFUSE-13",
    title: "A commitment without promisor, office, date, party, place or individual author",
    cases: [
      c("R13-a", remove("com:C1", "commitmentDirection"), ["XR-13a", "com:C1", "minCount"]),
      c("R13-b", replace("com:C1", "commitmentDirection", '"given"', '"promised"'), ["XR-13a", "com:C1", "in"]),
      c("R13-c", remove("com:C1", "promisedBy"), ["XR-13b", "com:C1", "minCount"]),
      c("R13-d", remove("com:C1", "promisedOn"), ["XR-13c", "com:C1", "minCount"]),
      c("R13-e", remove("com:C1", "commitmentCounterparty"), ["XR-13d", "com:C1", "minCount"]),
      c("R13-f", replace("com:C1", "capturedIn", '"email"', '"fax"'), ["XR-13e", "com:C1", "in"]),
      c("R13-g", remove("com:C1", "statement"), ["XR-13f", "com:C1", "minCount"]),
      c("R13-h", remove("com:C1", "promisedInCapacityOf"), ["XR-13g", "com:C1", "sparql"]),
      c("R13-i", add("com:C1 xfn:promisedInCapacityOf pos:GC ."), ["XR-13h", "com:C1", "maxCount"]),
      c("R13-j", add('com:C1 xfn:commitmentDirection "received" .'), ["XR-13a", "com:C1", "maxCount"]),
      c("R13-k", add("com:C1 xfn:promisedBy per:B ."), ["XR-13b", "com:C1", "maxCount"]),
      c("R13-l", replace("com:C1", "promisedBy", "per:A", '"A"'), ["XR-13b", "com:C1", "nodeKind"]),
      c("R13-m", add('com:C1 xfn:promisedOn "2024-11-19"^^xsd:date .'), ["XR-13c", "com:C1", "maxCount"]),
      c("R13-n", replace("com:C1", "promisedOn", '"2024-11-18"^^xsd:date', '"2024-11-18"'), ["XR-13c", "com:C1", "datatype"]),
      c("R13-o", add("com:C1 xfn:commitmentCounterparty pty:P2 ."), ["XR-13d", "com:C1", "maxCount"]),
      c("R13-p", replace("com:C1", "commitmentCounterparty", "pty:P1", '"P1"'), ["XR-13d", "com:C1", "nodeKind"]),
      c("R13-q", remove("com:C1", "capturedIn"), ["XR-13e", "com:C1", "minCount"]),
      c("R13-r", add('com:C1 xfn:capturedIn "verbal" .'), ["XR-13e", "com:C1", "maxCount"]),
      c("R13-s", replace("com:C1", "promisedInCapacityOf", "pos:CPO", "per:A"), ["XR-13h", "com:C1", "class"]),
      c("R13-t", replace("com:C1", "attributedTo", "per:A", "<https://ontos.dev/ontology/hr/OrgUnit/Procurement>"), ["XR-13i", "com:C1", "class"]),
    ],
  },
  {
    id: "REFUSE-14",
    title: "A commitment without evidence",
    cases: [
      c("R14-a", replace("com:C1", "capturedIn", '"email"', '"contract"'), ["XR-14a", "com:C1", "sparql"]),
      c("R14-b", removeTriple("com:C1", "xfn:citesEvidence", "ev:EV2"), ["XR-14b", "com:C1", "sparql"]),
      c(
        "R14-c",
        [replace("com:C1", "capturedIn", '"email"', '"verbal"'), removeTriple("com:C1", "xfn:citesEvidence", "ev:EV2")],
        ["XR-14b", "com:C1", "sparql"],
      ),
    ],
  },
  {
    id: "REFUSE-15",
    title: "Outcome and Variable without their defining content",
    cases: [
      c("R15-a", remove("o:O-a", "statedOver"), ["XR-15a", "o:O-a", "minCount"]),
      c("R15-b", add("o:O-a xfn:statedOver v:V5 ."), ["XR-15a", "o:O-a", "maxCount"]),
      c("R15-c", replace("o:O-a", "statedOver", "v:V4", "ev:EV1"), ["XR-15a", "o:O-a", "class"]),
      c("R15-d", remove("o:O-a", "inRemitOf"), ["XR-15b", "o:O-a", "minCount"]),
      c("R15-e", replace("o:O-a", "inRemitOf", "bf:Procurement", "pos:CPO"), ["XR-15b", "o:O-a", "class"]),
      c("R15-f", add("o:O-total xfn:hasConstituent v:V4 ."), ["XR-15c", "o:O-total", "class"]),
      c("R15-g", remove("v:V1", "variableDefinition"), ["XR-15d", "v:V1", "minCount"]),
      c("R15-h", add('v:V1 xfn:variableDefinition "Supplier of record for component C" .'), ["XR-15d", "v:V1", "maxCount"]),
    ],
  },
  {
    id: "REFUSE-16",
    title: "Term deviation and evidence without their content",
    cases: [
      c("R16-a", remove("td:TD1", "deviationInContract"), ["XR-16a", "td:TD1", "minCount"]),
      c("R16-b", add("td:TD1 xfn:deviationInContract ctr:K2 ."), ["XR-16a", "td:TD1", "maxCount"]),
      c("R16-c", replace("td:TD1", "deviationInContract", "ctr:K1", '"K1"'), ["XR-16a", "td:TD1", "nodeKind"]),
      c("R16-d", replace("td:TD1", "termKind", '"indemnity"', '"goodwill"'), ["XR-16b", "td:TD1", "in"]),
      c("R16-e", remove("td:TD1", "termKind"), ["XR-16b", "td:TD1", "minCount"]),
      c("R16-f", add('td:TD1 xfn:termKind "warranty" .'), ["XR-16b", "td:TD1", "maxCount"]),
      c("R16-g", remove("td:TD1", "deviationDirection"), ["XR-16c", "td:TD1", "minCount"]),
      c("R16-h", replace("td:TD1", "deviationDirection", '"absent"', '"worse"'), ["XR-16c", "td:TD1", "in"]),
      c("R16-i", add('td:TD1 xfn:deviationDirection "less-favourable" .'), ["XR-16c", "td:TD1", "maxCount"]),
      c("R16-j", remove("ev:EV1", "evidenceSummary"), ["XR-16d", "ev:EV1", "minCount"]),
      c("R16-k", add('ev:EV1 xfn:evidenceSummary "Inspection results, January" .'), ["XR-16d", "ev:EV1", "maxCount"]),
      c("R16-l", remove("ev:EV1", "evidenceSourceSystem"), ["XR-16e", "ev:EV1", "minCount"]),
      c("R16-m", add('ev:EV1 xfn:evidenceSourceSystem "Supplier portal" .'), ["XR-16e", "ev:EV1", "maxCount"]),
      c("R16-n", replace("ec:EC1", "citesEvidence", "ev:EV1", "v:V2"), ["XR-16f", "ec:EC1", "class"]),
    ],
  },
  {
    id: "REFUSE-17",
    title: "A metric definition or version without an owner or words",
    cases: [
      c("R17-a", remove("md:MD1", "metricName"), ["XR-17a", "md:MD1", "minCount"]),
      c("R17-b", add('md:MD1 xfn:metricName "Spend" .'), ["XR-17a", "md:MD1", "maxCount"]),
      c("R17-c", remove("md:MD1", "definedByFunction"), ["XR-17b", "md:MD1", "minCount"]),
      c("R17-d", add("md:MD1 xfn:definedByFunction bf:Quality ."), ["XR-17b", "md:MD1", "maxCount"]),
      c("R17-e", replace("md:MD1", "definedByFunction", "bf:Procurement", "pos:CPO"), ["XR-17b", "md:MD1", "class"]),
      c("R17-f", remove("mv:MV1", "versionOf"), ["XR-17c", "mv:MV1", "minCount"], ["XR-18f", "mb:MB1", "sparql"]),
      c("R17-g", [...addition("M2"), add("mv:MV1 xfn:versionOf md:MD2 .")], ["XR-17c", "mv:MV1", "maxCount"]),
      c("R17-h", replace("mv:MV1", "versionOf", "md:MD1", "bf:Procurement"), ["XR-17c", "mv:MV1", "class"], ["XR-18f", "mb:MB1", "sparql"]),
      c("R17-i", remove("mv:MV1", "definitionText"), ["XR-17d", "mv:MV1", "minCount"]),
      c("R17-j", add('mv:MV1 xfn:definitionText "Paid amount for component C" .'), ["XR-17d", "mv:MV1", "maxCount"]),
    ],
  },
  {
    id: "REFUSE-18",
    title: "Operationalisation and binding",
    cases: [
      c("R18-a", remove("vo:VO1", "operationalises"), ["XR-18a", "vo:VO1", "minCount"]),
      c("R18-b", add("vo:VO1 xfn:operationalises v:V5 ."), ["XR-18a", "vo:VO1", "maxCount"]),
      c("R18-c", replace("vo:VO1", "operationalises", "v:V4", "ev:EV1"), ["XR-18a", "vo:VO1", "class"]),
      c("R18-d", remove("vo:VO1", "measuredBy"), ["XR-18b", "vo:VO1", "minCount"]),
      c("R18-e", [...addition("M2"), add("vo:VO1 xfn:measuredBy mv:MV2 .")], ["XR-18b", "vo:VO1", "maxCount"]),
      c("R18-f", replace("vo:VO1", "measuredBy", "mv:MV1", "md:MD1"), ["XR-18b", "vo:VO1", "class"]),
      c("R18-g", remove("mb:MB1", "holder"), ["XR-18c", "mb:MB1", "minCount"]),
      c("R18-h", add("mb:MB1 xfn:holder pos:GC ."), ["XR-18c", "mb:MB1", "maxCount"]),
      c("R18-i", replace("mb:MB1", "holder", "pos:CPO", "per:A"), ["XR-18c", "mb:MB1", "class"]),
      c("R18-j", remove("mb:MB1", "bindsMetric"), ["XR-18d", "mb:MB1", "minCount"]),
      c("R18-k", [...addition("M2"), add("mb:MB1 xfn:bindsMetric md:MD2 .")], ["XR-18d", "mb:MB1", "maxCount"], ["XR-18f", "mb:MB1", "sparql"]),
      c("R18-l", replace("mb:MB1", "bindsMetric", "md:MD1", "mv:MV1"), ["XR-18d", "mb:MB1", "class"]),
      c("R18-m", remove("mb:MB1", "boundVersion"), ["XR-18e", "mb:MB1", "minCount"]),
      c("R18-n", [...addition("M2"), add("mb:MB1 xfn:boundVersion mv:MV2 .")], ["XR-18e", "mb:MB1", "maxCount"], ["XR-18f", "mb:MB1", "sparql"]),
      c("R18-o", replace("mb:MB1", "boundVersion", "mv:MV1", "md:MD1"), ["XR-18e", "mb:MB1", "class"]),
      c("R18-p", [...addition("M2"), replace("mb:MB1", "boundVersion", "mv:MV1", "mv:MV2")], ["XR-18f", "mb:MB1", "sparql"]),
    ],
  },
  {
    id: "REFUSE-19",
    title: "Classes outside this cycle's vocabulary",
    cases: [
      ...REFUSED_NAMES.map((name, i) => {
        const node = `<https://ontos.dev/ontology/xfn/${name}/X-1>`;
        return c(`R19-${String(i + 1).padStart(2, "0")}`, add(`${node} a xfn:${name} ; ENV(A) .`), ["XR-19a", node, "maxCount"]);
      }),
      c("R19-30", add(`${R1} a xfn:AttributedRecord ; ENV(A) .`), ["XR-19b", R1, "sparql"]),
    ],
  },
  {
    id: "REFUSE-20",
    title: "Two statements on one record",
    cases: [c("R20-a", add('ec:EC1 xfn:statement "The supplier change did not affect part quality" .'), ["XR-20", "ec:EC1", "maxCount"])],
  },
];

// ---------------------------------------------------------------------------------------------
// Section 4.3: units, shapes, and the case listed against each constraint
// ---------------------------------------------------------------------------------------------

/** The 65 unit IDs of 4.3. */
export const UNITS = [
  "XR-01", "XR-02a", "XR-02b", "XR-02c", "XR-02d", "XR-02e", "XR-02f", "XR-03a", "XR-03b", "XR-03c", "XR-04",
  "XR-05a", "XR-05b", "XR-06", "XR-07", "XR-08a", "XR-08b", "XR-08c", "XR-09a", "XR-09b", "XR-09c", "XR-09d",
  "XR-09e", "XR-09f", "XR-10", "XR-11", "XR-12a", "XR-12b", "XR-12c", "XR-12d", "XR-12e", "XR-13a", "XR-13b",
  "XR-13c", "XR-13d", "XR-13e", "XR-13f", "XR-13g", "XR-13h", "XR-13i", "XR-14a", "XR-14b", "XR-15a", "XR-15b",
  "XR-15c", "XR-15d", "XR-16a", "XR-16b", "XR-16c", "XR-16d", "XR-16e", "XR-16f", "XR-17a", "XR-17b", "XR-17c",
  "XR-17d", "XR-18a", "XR-18b", "XR-18c", "XR-18d", "XR-18e", "XR-18f", "XR-19a", "XR-19b", "XR-20",
] as const;

/** The 12 every-record units, all in xfn:RecordShape (GUARD-02 check 3). */
export const RECORD_UNITS = ["XR-03a", "XR-03b", "XR-03c", "XR-05a", "XR-05b", "XR-06", "XR-07", "XR-08a", "XR-08b", "XR-08c", "XR-16f", "XR-20"];

/** The ten attributed concrete classes (4.1). */
export const ATTRIBUTED_CLASSES = [
  "Variable", "Outcome", "Decision", "EffectClaim", "Commitment", "TermDeviation", "EvidenceItem",
  "MetricVersion", "VariableOperationalisation", "MetricBinding",
];

/** The 15 node shapes of 4.3 and their targets, as local names in xfn:. */
export const SHAPES: Record<string, string[]> = {
  RecordShape: ["AttributedRecord", ...ATTRIBUTED_CLASSES],
  VariableShape: ["Variable"],
  OutcomeShape: ["Outcome"],
  DecisionShape: ["Decision"],
  EffectClaimShape: ["EffectClaim"],
  CommitmentShape: ["Commitment"],
  TermDeviationShape: ["TermDeviation"],
  EvidenceItemShape: ["EvidenceItem"],
  MetricDefinitionShape: ["MetricDefinition"],
  MetricVersionShape: ["MetricVersion"],
  VariableOperationalisationShape: ["VariableOperationalisation"],
  MetricBindingShape: ["MetricBinding"],
  ExposureGapShape: ["ExposureGap"],
  RefusedClassShape: [...REFUSED_NAMES],
  AbstractRecordShape: ["AttributedRecord"],
};

/**
 * One constraint of 4.3 and the cases its Cases column lists against it; `also` holds the
 * cases the column names in parentheses. A SPARQL unit is one constraint, component "sparql".
 */
export type ConstraintCases = { unit: string; component: Component; cases: string[]; also?: string[] };

const listed = (unit: string, component: Component, cases: string | string[], also?: string[]): ConstraintCases => ({
  unit,
  component,
  cases: Array.isArray(cases) ? cases : [cases],
  ...(also ? { also } : {}),
});
const R03_ALL = "abcdefghijk".split("").map((x) => `R03-${x}`);
const R19_NAMED = REFUSED_NAMES.map((_, i) => `R19-${String(i + 1).padStart(2, "0")}`);

export const CONSTRAINT_CASES: ConstraintCases[] = [
  listed("XR-01", "sparql", "R01-a"),
  listed("XR-02a", "sparql", "R02-d"),
  listed("XR-02b", "sparql", "R02-c"),
  listed("XR-02c", "sparql", "R02-b"),
  listed("XR-02d", "sparql", ["R02-a", "R02-f"]),
  listed("XR-02e", "in", "R02-e"),
  listed("XR-02f", "maxCount", "R02-f"),
  listed("XR-03a", "minCount", R03_ALL), listed("XR-03a", "maxCount", "R03-l"), listed("XR-03a", "nodeKind", "R03-m"),
  listed("XR-03b", "minCount", R03_ALL), listed("XR-03b", "maxCount", "R03-n"), listed("XR-03b", "nodeKind", "R03-o"),
  listed("XR-03c", "minCount", R03_ALL), listed("XR-03c", "maxCount", "R03-p"), listed("XR-03c", "datatype", "R03-q"),
  listed("XR-04", "maxCount", "R04-a"),
  listed("XR-05a", "sparql", ["R05-a", "R05-b"]),
  listed("XR-05b", "maxCount", "R05-d"), listed("XR-05b", "class", "R05-c"),
  listed("XR-06", "minCount", "R06-b"), listed("XR-06", "maxCount", "R06-c"), listed("XR-06", "in", "R06-a"),
  listed("XR-07", "minCount", "R07-b"), listed("XR-07", "maxCount", "R07-c"), listed("XR-07", "in", "R07-a"),
  listed("XR-08a", "maxCount", "R08-b"),
  listed("XR-08b", "sparql", "R08-c"),
  listed("XR-08c", "sparql", ["R08-a", "R08-d"]),
  listed("XR-09a", "minCount", "R09-a"), listed("XR-09a", "class", "R09-i"),
  listed("XR-09b", "minCount", "R09-b"), listed("XR-09b", "maxCount", "R09-h"), listed("XR-09b", "class", "R09-f"),
  listed("XR-09c", "minCount", "R09-c"), listed("XR-09c", "maxCount", "R09-j"), listed("XR-09c", "class", "R09-k"),
  listed("XR-09d", "minCount", "R09-d"), listed("XR-09d", "maxCount", "R09-l"), listed("XR-09d", "class", "R09-m"),
  listed("XR-09e", "minCount", "R09-e"),
  listed("XR-09f", "class", "R09-g"),
  listed("XR-10", "sparql", ["R10-a", "R12-e"]),
  listed("XR-11", "sparql", "R11-a"),
  listed("XR-12a", "minCount", "R12-a"), listed("XR-12a", "maxCount", "R12-g"), listed("XR-12a", "nodeKind", "R12-h"),
  listed("XR-12b", "minCount", "R12-b"), listed("XR-12b", "maxCount", "R12-i"), listed("XR-12b", "class", "R12-c"),
  listed("XR-12c", "minCount", "R12-d"), listed("XR-12c", "maxCount", "R12-j"), listed("XR-12c", "datatype", "R12-k"),
  listed("XR-12d", "minCount", "R12-e"), listed("XR-12d", "class", "R12-l"),
  listed("XR-12e", "minCount", "R12-f"),
  listed("XR-13a", "minCount", "R13-a"), listed("XR-13a", "maxCount", "R13-j"), listed("XR-13a", "in", "R13-b"),
  listed("XR-13b", "minCount", "R13-c"), listed("XR-13b", "maxCount", "R13-k"), listed("XR-13b", "nodeKind", "R13-l"),
  listed("XR-13c", "minCount", "R13-d"), listed("XR-13c", "maxCount", "R13-m"), listed("XR-13c", "datatype", "R13-n"),
  listed("XR-13d", "minCount", "R13-e"), listed("XR-13d", "maxCount", "R13-o"), listed("XR-13d", "nodeKind", "R13-p"),
  listed("XR-13e", "minCount", "R13-q"), listed("XR-13e", "maxCount", "R13-r"), listed("XR-13e", "in", "R13-f"),
  listed("XR-13f", "minCount", "R13-g"),
  listed("XR-13g", "sparql", "R13-h"),
  listed("XR-13h", "maxCount", "R13-i"), listed("XR-13h", "class", "R13-s"),
  listed("XR-13i", "class", "R13-t"),
  listed("XR-14a", "sparql", "R14-a"),
  listed("XR-14b", "sparql", ["R14-b", "R14-c"]),
  listed("XR-15a", "minCount", "R15-a"), listed("XR-15a", "maxCount", "R15-b"), listed("XR-15a", "class", "R15-c"),
  listed("XR-15b", "minCount", "R15-d"), listed("XR-15b", "class", "R15-e"),
  listed("XR-15c", "class", "R15-f"),
  listed("XR-15d", "minCount", "R15-g"), listed("XR-15d", "maxCount", "R15-h"),
  listed("XR-16a", "minCount", "R16-a"), listed("XR-16a", "maxCount", "R16-b"), listed("XR-16a", "nodeKind", "R16-c"),
  listed("XR-16b", "minCount", "R16-e"), listed("XR-16b", "maxCount", "R16-f"), listed("XR-16b", "in", "R16-d"),
  listed("XR-16c", "minCount", "R16-g"), listed("XR-16c", "maxCount", "R16-i"), listed("XR-16c", "in", "R16-h"),
  listed("XR-16d", "minCount", "R16-j"), listed("XR-16d", "maxCount", "R16-k"),
  listed("XR-16e", "minCount", "R16-l"), listed("XR-16e", "maxCount", "R16-m"),
  listed("XR-16f", "class", "R16-n"),
  listed("XR-17a", "minCount", "R17-a"), listed("XR-17a", "maxCount", "R17-b"),
  listed("XR-17b", "minCount", "R17-c"), listed("XR-17b", "maxCount", "R17-d"), listed("XR-17b", "class", "R17-e"),
  listed("XR-17c", "minCount", "R17-f"), listed("XR-17c", "maxCount", "R17-g"), listed("XR-17c", "class", "R17-h"),
  listed("XR-17d", "minCount", "R17-i"), listed("XR-17d", "maxCount", "R17-j"),
  listed("XR-18a", "minCount", "R18-a"), listed("XR-18a", "maxCount", "R18-b"), listed("XR-18a", "class", "R18-c"),
  listed("XR-18b", "minCount", "R18-d"), listed("XR-18b", "maxCount", "R18-e"), listed("XR-18b", "class", "R18-f"),
  listed("XR-18c", "minCount", "R18-g"), listed("XR-18c", "maxCount", "R18-h"), listed("XR-18c", "class", "R18-i"),
  listed("XR-18d", "minCount", "R18-j"), listed("XR-18d", "maxCount", "R18-k"), listed("XR-18d", "class", "R18-l"),
  listed("XR-18e", "minCount", "R18-m"), listed("XR-18e", "maxCount", "R18-n"), listed("XR-18e", "class", "R18-o"),
  listed("XR-18f", "sparql", "R18-p", ["R17-f", "R17-h", "R18-k", "R18-n"]),
  listed("XR-19a", "maxCount", R19_NAMED),
  listed("XR-19b", "sparql", "R19-30", ["R03-k"]),
  listed("XR-20", "maxCount", "R20-a"),
];

// ---------------------------------------------------------------------------------------------
// Acceptance fixtures (5.5), as bodies after P
// ---------------------------------------------------------------------------------------------

const ACCEPT_02 = `
bf:Procurement a xfn:BusinessFunction .
pos:CPO a xfn:Position .
v:V1 a xfn:Variable ; xfn:variableDefinition "Primary supplier of component C" ; ENV(CPO) .
v:V2 a xfn:Variable ; xfn:variableDefinition "Unit price paid for component C" ; ENV(CPO) .
d:D1 a xfn:Decision ;
  xfn:statement "Replace the primary supplier of component C" ;
  xfn:decidedBy per:CPO ; xfn:decidedInCapacityOf pos:CPO ;
  xfn:decidedOn "2025-01-15"^^xsd:date ; xfn:intervenesOn v:V1 ;
  ENV(CPO, 2025-01-15T10:00:00Z) .
ec:EC-0101 a xfn:EffectClaim ;
  xfn:statement "The supplier change lowers the unit price of component C" ;
  xfn:claimedCause v:V1 ; xfn:claimedEffect v:V2 ; xfn:viaDecision d:D1 ;
  xfn:onBehalfOf bf:Procurement ; ENV(CPO, 2025-01-15T10:30:00Z) .
`;

export const ACCEPTS: Array<{ id: string; title: string; body: string }> = [
  {
    id: "ACCEPT-01",
    title: "Definitional lineage through xfn:revises",
    body: `
v:V-unit-cost-v1 a xfn:Variable ;
  xfn:variableDefinition "Unit price paid for component C, before freight" ; ENV(CPO) .
v:V-unit-cost-v2 a xfn:Variable ;
  xfn:variableDefinition "Unit price paid for component C, before freight and after volume rebates" ;
  xfn:revises v:V-unit-cost-v1 ; ENV(CPO, 2025-02-01T09:00:00Z) .
`,
  },
  { id: "ACCEPT-02", title: "An attributed n-ary effect claim", body: ACCEPT_02 },
  {
    id: "ACCEPT-03",
    title: "A privileged record with its holder seat",
    body: `${ACCEPT_02}
bf:Legal a xfn:BusinessFunction .
pos:GeneralCounselSeat a xfn:Position .
v:V3 a xfn:Variable ;
  xfn:variableDefinition "Product-liability exposure on component C not covered by a supplier indemnity" ;
  ENV(GeneralCounsel) .
ec:CL-legal-indemnity a xfn:EffectClaim ;
  xfn:statement "Virtually certain that the supplier change left product liability on component C without indemnity cover" ;
  xfn:claimedCause v:V1 ; xfn:claimedEffect v:V3 ; xfn:viaDecision d:D1 ;
  xfn:onBehalfOf bf:Legal ; xfn:privilegeHolder pos:GeneralCounselSeat ;
  ENV(GeneralCounsel, GeneralCounsel, 2025-02-01T09:00:00Z, privileged, asserted) .
`,
  },
  {
    id: "ACCEPT-04",
    title: "A Variable operationalised by a metric version",
    body: `
bf:Quality a xfn:BusinessFunction .
v:V-defect-rate a xfn:Variable ; xfn:variableDefinition "Rate of field defects on product P" ; ENV(LeadAnalyst) .
md:MET-defects a xfn:MetricDefinition ; xfn:metricName "Defect rate" ; xfn:definedByFunction bf:Quality .
mv:MV-defect-monthly-v2 a xfn:MetricVersion ; xfn:versionOf md:MET-defects ;
  xfn:definitionText "Confirmed field defects per 1,000 units shipped, by calendar month" ; ENV(LeadAnalyst) .
vo:VO-01 a xfn:VariableOperationalisation ;
  xfn:operationalises v:V-defect-rate ; xfn:measuredBy mv:MV-defect-monthly-v2 ;
  ENV(LeadAnalyst, 2025-01-20T14:00:00Z) .
`,
  },
  {
    id: "ACCEPT-05",
    title: "A scorecard binding pinned to a version",
    body: `
bf:Procurement a xfn:BusinessFunction .
pos:CPO a xfn:Position .
md:MET-savings a xfn:MetricDefinition ; xfn:metricName "Savings" ; xfn:definedByFunction bf:Procurement .
mv:MV-savings-2025 a xfn:MetricVersion ; xfn:versionOf md:MET-savings ;
  xfn:definitionText "Annualised reduction in unit price against last-paid price, times forecast volume" ; ENV(CPO) .
mb:MB-cpo-2025 a xfn:MetricBinding ;
  xfn:holder pos:CPO ; xfn:bindsMetric md:MET-savings ; xfn:boundVersion mv:MV-savings-2025 ;
  ENV(CEO, HR-Analyst, 2025-01-05T09:00:00Z, restricted, asserted) .
`,
  },
  {
    id: "ACCEPT-06",
    title: "The anchor scenario from end to end",
    body: `
bf:Enterprise  a xfn:BusinessFunction .
bf:Procurement a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
bf:Quality     a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
bf:Support     a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
bf:Finance     a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
bf:Legal       a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
pos:CPOSeat a xfn:Position ; rdfs:label "Chief Procurement Officer" .
pos:GeneralCounselSeat a xfn:Position ; rdfs:label "General Counsel" .

# The decision, entered by an analyst for the CPO, who answers for it
d:PROC-2025-014 a xfn:Decision ;
  xfn:statement "Switch the primary supplier of component C from Apex to NewCo" ;
  xfn:decidedBy per:CPO ; xfn:decidedInCapacityOf pos:CPOSeat ;
  xfn:decidedOn "2024-11-20"^^xsd:date ; xfn:intervenesOn v:V-supplier ;
  ENV(CPO, Proc-Analyst, 2024-11-20T10:00:00Z, open, asserted) .

v:V-supplier a xfn:Variable ; xfn:variableDefinition "Primary supplier of component C" ; ENV(CPO, 2024-11-20T09:00:00Z) .
v:V-unit-cost a xfn:Variable ; xfn:variableDefinition "Unit price paid for component C" ; ENV(CPO, 2024-11-20T09:00:00Z) .
v:V-purchase-spend a xfn:Variable ; xfn:variableDefinition "Purchase spend on component C" ; ENV(Controller, 2025-03-08T10:00:00Z) .
v:V-part-quality a xfn:Variable ; xfn:variableDefinition "Incoming quality of component C" ; ENV(VP-Quality, 2025-03-01T13:00:00Z) .
v:V-field-tickets a xfn:Variable ; xfn:variableDefinition "Weekly field defect tickets on products using component C" ; ENV(VP-Support, 2025-03-05T09:00:00Z) .
v:V-copq a xfn:Variable ; xfn:variableDefinition "Cost of poor quality attributable to component C" ; ENV(VP-Quality, 2025-03-01T13:00:00Z) .
v:V-warranty-exp a xfn:Variable ; xfn:variableDefinition "Warranty provision expense for products using component C" ; ENV(Controller, 2025-03-08T10:00:00Z) .
v:V-uncovered-liability a xfn:Variable ; xfn:variableDefinition "Product-liability exposure on component C not covered by a supplier indemnity" ; ENV(GeneralCounsel, 2025-03-10T15:00:00Z) .
v:V-liability-cost a xfn:Variable ; xfn:variableDefinition "Product-liability cost on component C paid by Acme without indemnity recovery" ; ENV(Controller, 2025-03-08T10:00:00Z) .
v:V-tco a xfn:Variable ; xfn:variableDefinition "Total cost of supply of component C" ; ENV(Controller, 2025-03-08T10:00:00Z) .

ev:EV-01 a xfn:EvidenceItem ;
  xfn:evidenceSummary "Procurement's two-page memo booking the saving under ACME-CTR-0042, measured at unit price" ;
  xfn:evidenceSourceSystem "Procurement savings tracker" ; xfn:sourceLocator "memo PROC-SAV-2024-11" ;
  ENV(CPO, 2024-11-20T10:45:00Z) .
ev:EV-02 a xfn:EvidenceItem ;
  xfn:evidenceSummary "Quality's RMA tracker: defect teardowns of returned units since the changeover" ;
  xfn:evidenceSourceSystem "Quality RMA tracker" ; xfn:sourceLocator "RMA tracker export 2025-03-01" ;
  ENV(VP-Quality, 2025-03-01T13:30:00Z) .

# 1. Procurement: the switch lowered the unit price
ec:EC-0101 a xfn:EffectClaim ;
  xfn:statement "Moving component C to NewCo cut its unit price; $2.4 million a year is booked as savings under ACME-CTR-0042" ;
  xfn:magnitudeStatement "$2.4 million a year, measured at unit price" ;
  xfn:claimedCause v:V-supplier ; xfn:claimedEffect v:V-unit-cost ;
  xfn:viaDecision d:PROC-2025-014 ; xfn:onBehalfOf bf:Procurement ; xfn:citesEvidence ev:EV-01 ;
  ENV(CPO, 2024-11-20T11:00:00Z) .
# 2. Quality: the switch lowered incoming part quality
ec:EC-0102 a xfn:EffectClaim ;
  xfn:statement "Incoming quality of component C fell after the change to NewCo; defect teardowns are up 45% since the changeover" ;
  xfn:magnitudeStatement "teardowns up 45% since the changeover" ;
  xfn:claimedCause v:V-supplier ; xfn:claimedEffect v:V-part-quality ;
  xfn:viaDecision d:PROC-2025-014 ; xfn:onBehalfOf bf:Quality ; xfn:citesEvidence ev:EV-02 ;
  ENV(VP-Quality, 2025-03-01T14:00:00Z) .
# 2b. Quality: the switch raised the cost of poor quality, through part quality
ec:EC-0106 a xfn:EffectClaim ;
  xfn:statement "The change to NewCo raised our cost of poor quality, through lower incoming part quality" ;
  xfn:claimedCause v:V-supplier ; xfn:claimedEffect v:V-copq ; xfn:claimedMediator v:V-part-quality ;
  xfn:viaDecision d:PROC-2025-014 ; xfn:onBehalfOf bf:Quality ;
  ENV(VP-Quality, 2025-03-01T15:00:00Z) .
# 3. Support: the switch raised field defect tickets, through part quality
ec:EC-0103 a xfn:EffectClaim ;
  xfn:statement "The change to NewCo raised weekly field defect tickets, through lower part quality" ;
  xfn:claimedCause v:V-supplier ; xfn:claimedEffect v:V-field-tickets ; xfn:claimedMediator v:V-part-quality ;
  xfn:viaDecision d:PROC-2025-014 ; xfn:onBehalfOf bf:Support ;
  ENV(VP-Support, 2025-03-05T09:30:00Z) .
# 4. Finance: the switch raised the warranty provision, through part quality
ec:EC-0104 a xfn:EffectClaim ;
  xfn:statement "The change to NewCo raised the warranty provision, through lower part quality" ;
  xfn:claimedCause v:V-supplier ; xfn:claimedEffect v:V-warranty-exp ; xfn:claimedMediator v:V-part-quality ;
  xfn:viaDecision d:PROC-2025-014 ; xfn:onBehalfOf bf:Finance ;
  ENV(Controller, 2025-03-08T11:00:00Z) .
# 5. Legal's assessment (privileged)
ec:EC-0105 a xfn:EffectClaim ;
  xfn:statement "Virtually certain that the change to NewCo left product liability on component C without indemnity cover" ;
  xfn:claimedCause v:V-supplier ; xfn:claimedEffect v:V-uncovered-liability ;
  xfn:viaDecision d:PROC-2025-014 ; xfn:onBehalfOf bf:Legal ; xfn:privilegeHolder pos:GeneralCounselSeat ;
  ENV(GeneralCounsel, GeneralCounsel, 2025-03-10T16:00:00Z, privileged, asserted) .
# 6. Legal's record of what the contract says (restricted, not privileged)
td:TD-0042 a xfn:TermDeviation ;
  xfn:deviationInContract ctr:ACME-CTR-0042 ; xfn:termKind "indemnity" ;
  xfn:deviationDirection "absent" ; xfn:benchmarkContract ctr:ACME-CTR-0017 ;
  ENV(GeneralCounsel, GeneralCounsel, 2025-03-10T16:05:00Z, restricted, asserted) .

# Total cost of supply: placed by its author in the Enterprise's remit; every constituent an amount of money
o:O-tco a xfn:Outcome ; xfn:statedOver v:V-tco ; xfn:inRemitOf bf:Enterprise ;
  xfn:compositionKind "additive" ; xfn:unitDimension "money" ;
  xfn:hasConstituent o:O-purchase-cost , o:O-copq-cost , o:O-warranty-cost , o:O-liability-cost ;
  ENV(Controller, 2025-03-08T10:30:00Z) .
o:O-purchase-cost a xfn:Outcome ; xfn:statedOver v:V-purchase-spend ; xfn:inRemitOf bf:Procurement ;
  xfn:unitDimension "money" ; ENV(Controller, 2025-03-08T10:30:00Z) .
o:O-copq-cost a xfn:Outcome ; xfn:statedOver v:V-copq ; xfn:inRemitOf bf:Quality ;
  xfn:unitDimension "money" ; ENV(Controller, 2025-03-08T10:30:00Z) .
o:O-warranty-cost a xfn:Outcome ; xfn:statedOver v:V-warranty-exp ; xfn:inRemitOf bf:Finance ;
  xfn:unitDimension "money" ; ENV(Controller, 2025-03-08T10:30:00Z) .
o:O-liability-cost a xfn:Outcome ; xfn:statedOver v:V-liability-cost ; xfn:inRemitOf bf:Legal ;
  xfn:unitDimension "money" ; ENV(Controller, 2025-03-08T10:30:00Z) .

# Where each claimed effect lands: outcomes outside the total
o:O-unit-price a xfn:Outcome ; xfn:statedOver v:V-unit-cost ; xfn:inRemitOf bf:Procurement ;
  xfn:unitDimension "money per unit" ; ENV(CPO, 2024-11-20T09:30:00Z) .
o:O-part-quality a xfn:Outcome ; xfn:statedOver v:V-part-quality ; xfn:inRemitOf bf:Quality ;
  ENV(VP-Quality, 2025-03-01T13:15:00Z) .
o:O-field-tickets a xfn:Outcome ; xfn:statedOver v:V-field-tickets ; xfn:inRemitOf bf:Support ;
  xfn:unitDimension "count" ; ENV(VP-Support, 2025-03-05T09:15:00Z) .
o:O-uncovered-liability a xfn:Outcome ; xfn:statedOver v:V-uncovered-liability ; xfn:inRemitOf bf:Legal ;
  ENV(GeneralCounsel, 2025-03-10T15:30:00Z) .
`,
  },
  {
    id: "ACCEPT-07",
    title: "Rival \"Savings\" definitions side by side",
    body: `
bf:Enterprise  a xfn:BusinessFunction .
bf:Procurement a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
bf:Operations  a xfn:BusinessFunction ; xfn:subFunctionOf bf:Enterprise .
v:V-annual-purchase-cost a xfn:Variable ;
  xfn:variableDefinition "Annual cost to Acme of obtaining component C" ; ENV(COO) .
md:MET-savings-proc a xfn:MetricDefinition ; xfn:metricName "Savings" ; xfn:definedByFunction bf:Procurement .
md:MET-savings-ops  a xfn:MetricDefinition ; xfn:metricName "Savings" ; xfn:definedByFunction bf:Operations .
mv:MV-savings-proc-1 a xfn:MetricVersion ; xfn:versionOf md:MET-savings-proc ;
  xfn:definitionText "Annualised reduction in unit price paid, times forecast volume" ;
  xfn:baselineDescription "Last-paid unit price under the displaced supplier" ; ENV(CPO) .
mv:MV-savings-ops-1 a xfn:MetricVersion ; xfn:versionOf md:MET-savings-ops ;
  xfn:definitionText "Annualised reduction in landed cost per unit, including freight, duty and expedite freight, times actual volume" ;
  xfn:baselineDescription "Landed cost per unit under the displaced supplier, trailing four quarters" ; ENV(VP-Operations) .
vo:VO-savings-proc a xfn:VariableOperationalisation ;
  xfn:operationalises v:V-annual-purchase-cost ; xfn:measuredBy mv:MV-savings-proc-1 ; ENV(CPO) .
vo:VO-savings-ops a xfn:VariableOperationalisation ;
  xfn:operationalises v:V-annual-purchase-cost ; xfn:measuredBy mv:MV-savings-ops-1 ; ENV(VP-Operations) .
`,
  },
  {
    id: "ACCEPT-08",
    title: "Commitments outside an executed contract, and one inside",
    body: `
pos:CPOSeat a xfn:Position ; rdfs:label "Chief Procurement Officer" .
per:Category-Manager a hr:Person .
ev:EV-PF a xfn:EvidenceItem ;
  xfn:evidenceSummary "NewCo price file v3, tab 'Volume': a three-year minimum of 120,000 units a year" ;
  xfn:evidenceSourceSystem "Procurement shared drive" ; xfn:sourceLocator "NewCo price file v3" ;
  ENV(Category-Manager, Category-Manager, 2024-11-19T09:00:00Z, restricted, asserted) .
com:C-0042-VOL a xfn:Commitment ;
  xfn:statement "Acme will take at least 120,000 units of component C a year for three years" ;
  xfn:commitmentDirection "given" ; xfn:promisedBy per:CPO ; xfn:promisedInCapacityOf pos:CPOSeat ;
  xfn:promisedOn "2024-11-18"^^xsd:date ; xfn:commitmentCounterparty pty:NewCo ;
  xfn:capturedIn "price-file" ; xfn:citesEvidence ev:EV-PF ;
  ENV(Category-Manager, Proc-Analyst, 2025-03-12T10:00:00Z, restricted, draft) .
ev:EV-CALL a xfn:EvidenceItem ;
  xfn:evidenceSummary "The category manager's account of a call on 2024-11-19 in which NewCo's account director promised replacement of failed lots within 48 hours" ;
  xfn:evidenceSourceSystem "none: recollection" ;
  ENV(Category-Manager, Category-Manager, 2024-11-19T17:00:00Z, restricted, asserted) .
com:C-0042-RPL a xfn:Commitment ;
  xfn:statement "NewCo will replace failed lots of component C within 48 hours" ;
  xfn:commitmentDirection "received" ; xfn:promisedBy pty:NewCo-AccountDirector ;
  xfn:promisedOn "2024-11-19"^^xsd:date ; xfn:commitmentCounterparty pty:NewCo ;
  xfn:capturedIn "verbal" ; xfn:citesEvidence ev:EV-CALL ;
  ENV(Category-Manager, Category-Manager, 2024-11-19T17:05:00Z, restricted, asserted) .
com:C-0042-WAR a xfn:Commitment ;
  xfn:statement "NewCo warrants component C free of defects for 24 months from delivery" ;
  xfn:commitmentDirection "received" ; xfn:promisedBy pty:NewCo-Signatory ;
  xfn:promisedOn "2024-11-20"^^xsd:date ; xfn:commitmentCounterparty pty:NewCo ;
  xfn:capturedIn "contract" ; xfn:evidencedIn ctr:ACME-CTR-0042 ;
  ENV(Category-Manager, Category-Manager, 2024-11-21T09:00:00Z, restricted, asserted) .
`,
  },
];

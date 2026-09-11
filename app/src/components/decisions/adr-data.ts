export type AdrStatus = 'accepted' | 'proposed' | 'superseded';

export interface AdrAlternative {
  option: string;
  strengths: string;
  weaknesses: string;
  verdict: string;
}

export interface AdrCallout {
  kind: 'info' | 'warn';
  title: string;
  text: string;
}

export interface Adr {
  id: string;
  title: string;
  /** Short label used in the TOC rail */
  shortTitle: string;
  status: AdrStatus;
  date: string;
  deciders: string[];
  context: string[];
  decision: string;
  alternatives: AdrAlternative[];
  gains: string[];
  costs: string[];
  tradeoff: string;
  callout?: AdrCallout;
}

export const ADRS: Adr[] = [
  {
    id: 'ADR-001',
    title: 'Graph model: property-graph edge table primary, RDF-star export derived',
    shortTitle: 'Graph model',
    status: 'accepted',
    date: '2025-08-14',
    deciders: ['Amara Okafor', 'D. Chen'],
    context: [
      'The knowledge graph must carry edge-level provenance (which mapping produced an edge, when), soft delete, and module-scoped semantics (hr:, lgl:, cmp:, fin:, log: namespaces). At the same time, the team\'s day-to-day workloads — neighborhood expansion, anomaly rules, subgraph fetch for the explorer canvas — are property-graph shaped: nodes with labels and properties, directed typed edges.',
      'A pure RDF triple store would give us OWL/SHACL semantics natively but forces reification or RDF-star annotations for every provenance-bearing edge, and adds an operational dependency this platform does not otherwise need.',
    ],
    decision:
      'The system of record is a property-graph-style model in relational tables — kg_nodes (iri, classIri, moduleKey, propsJson, sourceMappingId, deletedAt) and kg_edges (fromNodeId, toNodeId, predicateIri, moduleKey, sourceMappingId, deletedAt) — queried through Drizzle. Compact-IRI predicates (fin:paidTo, hr:reportsTo) keep RDF naming discipline, and an RDF-star/Turtle serialization is produced as a derived export for standards interop. This is a deliberate deviation from a pure-RDF primary store, accepted for this platform.',
    alternatives: [
      {
        option: 'Pure RDF / RDF-star triple store (system of record)',
        strengths: 'Native OWL/SHACL semantics; standards-grade provenance via quoted triples; SPARQL federation.',
        weaknesses: 'Verbose queries for neighborhood expansion; provenance on every edge doubles triple count; extra datastore to operate.',
        verdict: 'Rejected as primary — kept as export target',
      },
      {
        option: 'LPG-only (no RDF naming, no export)',
        strengths: 'Simplest possible schema; ergonomic analytics queries.',
        weaknesses: 'Loses namespace discipline and standards interop; provenance model would be re-invented ad hoc.',
        verdict: 'Rejected',
      },
      {
        option: 'Dual primary: triple store + property graph kept in sync',
        strengths: 'Best of both query models.',
        weaknesses: 'Two systems of record → sync drift, dual write failures, doubled ops burden.',
        verdict: 'Rejected — sync drift risk unacceptable',
      },
    ],
    gains: [
      'Edge-level provenance and soft delete are first-class columns, not reification patterns',
      'Subgraph and neighborhood queries stay single-round-trip SQL',
      'RDF/Turtle export keeps standards interop for downstream tooling',
      'One datastore to back up, index, and reason about',
    ],
    costs: [
      'SPARQL endpoints are served from derived exports, not the primary store',
      'OWL/SHACL semantics must be enforced in the application/reasoner layer (see ADR-004)',
      'Compact IRIs require disciplined prefix registry (enforced in db/schema + module registry)',
    ],
    tradeoff: '> we keep RDF naming discipline and export fidelity, but spend our query budget on property-graph ergonomics.',
  },
  {
    id: 'ADR-002',
    title: 'Backend & store: platform-native tRPC + Drizzle + Hono on MySQL/TiDB',
    shortTitle: 'Store & abstraction',
    status: 'accepted',
    date: '2025-08-21',
    deciders: ['D. Chen', 'R. Alvarez'],
    context: [
      'The reference architecture for ontology platforms typically pairs a Python FastAPI service with a dedicated graph database (Neo4j or an RDF4J/Jena-style triple store). Ontos is built on an existing TypeScript platform where the API layer, auth, and deployment pipeline are already Hono/tRPC and the provisioned datastore is MySQL-compatible TiDB.',
      'Standing up a second language runtime and a second database for the graph workload would split the team\'s operational surface for marginal query-ergonomics gain on graph traversals that are, in practice, shallow (depth ≤ 2) and paginated.',
    ],
    decision:
      'All domain logic lives in typed tRPC routers (api/*Router.ts) served by Hono; persistence goes through a Drizzle repository layer over MySQL/TiDB with the graph model of ADR-001. The router layer is the abstraction boundary: graph read paths (stats, searchNodes, getSubgraph, getNode) are concentrated in graphRouter, so a dedicated graph store adapter can be introduced later without touching clients. Scale target of 10M+ edges is documented with batching (chunked inserts), bounded BFS (depth 1–2, limit-capped fan-out), and pagination notes.',
    alternatives: [
      {
        option: 'Python/FastAPI graph service + Neo4j',
        strengths: 'Cypher ergonomics for deep traversals; mature graph tooling.',
        weaknesses: 'Second runtime, second datastore, second deploy pipeline; team is TypeScript-native.',
        verdict: 'Rejected for this platform — revisited if depth>2 traversals become hot',
      },
      {
        option: 'RDF4J/Jena-style triple store behind repository interface',
        strengths: 'Standards-native; SPARQL out of the box.',
        weaknesses: 'JVM service to operate; overlaps awkwardly with ADR-001 primary model.',
        verdict: 'Rejected — export path retained instead',
      },
      {
        option: 'Embedded in-process store (SQLite/LMDB)',
        strengths: 'Zero ops; great for eval.',
        weaknesses: 'No horizontal scaling; single-writer limits sync workers.',
        verdict: 'Rejected — TiDB already provisioned',
      },
    ],
    gains: [
      'End-to-end type safety: AppRouter type flows from api/router.ts into the React client',
      'One runtime, one datastore, one deploy story',
      'Router concentration keeps a swap path open behind stable procedure signatures',
    ],
    costs: [
      'Deep graph traversals are bounded (depth ≤ 2) rather than arbitrary-path Cypher',
      'Recursive/path queries would need application-side iteration or a future graph-store adapter',
    ],
    tradeoff: '> platform-native beats graph-native when traversals are shallow and the team ships TypeScript.',
  },
  {
    id: 'ADR-003',
    title: 'Sync: incremental runs with immutable, snapshot-versioned materialization',
    shortTitle: 'Sync strategy',
    status: 'accepted',
    date: '2025-09-02',
    deciders: ['D. Chen', 'S. Park'],
    context: [
      'Source systems are heterogeneous: HRIS CSV exports, a contracts SQL database, ERP REST endpoints. Each needs a different change-capture strategy, but every sync must leave the graph in a coherent, replayable state so insights and audits can point at "what the graph knew at snapshot v47".',
    ],
    decision:
      'Per-source strategies (scheduled diff for CSV exports, incremental queries for SQL, webhook-triggered pulls for REST) all funnel into one materialization path: mapping (R2RML-style columnMapJson) → upsert with provenance (sourceMappingId on every node/edge) → immutable graph snapshot (graph_snapshots row with stats). Deletes are soft: rows are tombstoned with deletedAt rather than removed, so snapshots remain reproducible. Every run is recorded in sync_jobs and the hash-chained audit log.',
    alternatives: [
      {
        option: 'Full reload per sync',
        strengths: 'Simplest mental model; no diff logic.',
        weaknesses: 'Destroys provenance continuity; expensive at scale; breaks audit trails.',
        verdict: 'Rejected',
      },
      {
        option: 'CDC everywhere (Debezium-style)',
        strengths: 'Real-time; minimal source load.',
        weaknesses: 'CSV exports and ERP REST have no CDC surface; operational complexity for the sources that do.',
        verdict: 'Partially adopted — only where the source supports it',
      },
      {
        option: 'Event-sourced graph (append-only log as primary)',
        strengths: 'Perfect time travel; natural audit.',
        weaknesses: 'Every read needs materialization; overkill for current scale.',
        verdict: 'Rejected — snapshots give the same audit value cheaply',
      },
    ],
    gains: [
      'Time-travel diffs and rollback are snapshot lookups, not replays',
      'Provenance is queryable: every node/edge knows its mapping',
      'Soft deletes make "what changed since v46" a WHERE clause',
    ],
    costs: [
      'Storage growth from tombstones and snapshot stats (mitigated: nightly compaction job)',
      'Diff logic differs per source type — three strategy implementations to test',
    ],
    tradeoff: '> we trade storage for the ability to answer "what did the graph know, and when" without a replay engine.',
  },
  {
    id: 'ADR-004',
    title: 'Reasoner: native OWL-RL over Oxigraph, with a deterministic fallback when the engine is offline',
    shortTitle: 'Reasoner',
    status: 'accepted',
    date: '2026-09-10',
    deciders: ['Amara Okafor', 'R. Alvarez'],
    context: [
      'Ontos needs two kinds of inference: classification (materialize implied subclass relations when a module is published) and data validation (SHACL-style shape checks on synced instances). Both must be explainable — the UI shows inferred facts with provenance, never silent magic.',
      'A full OWL DL reasoner (HermiT-class) is complete but scales poorly; an ELK-class OWL 2 EL reasoner covers the classification profiles our modules actually use. The earlier revision of this ADR shipped a deterministic simulator because no engine was provisioned. That constraint no longer holds: open-ontologies embeds an Oxigraph triple store with a forward-chaining OWL-RL reasoner and a W3C SHACL validator behind a local HTTP API, deployable as a single binary with no JVM.',
    ],
    decision:
      'Accepted: ontology.runReasoner serializes the module and its instances to Turtle, loads them into Oxigraph, and runs native OWL-RL to a fixpoint — returning real entailments with iteration counts and triple deltas. SHACL shapes compiled from shaclJson are validated by the W3C validator in the same engine, and violations are explained through xpSHACL justification trees. When the engine is unreachable the previous deterministic subclass walker still runs, and the response names which path produced the result so the UI never presents a fallback as native entailment.',
    alternatives: [
      {
        option: 'ELK-class OWL 2 EL reasoner',
        strengths: 'Polynomial classification; covers the expressivity our modules use; proven at 100k+ class scale.',
        weaknesses: 'No full DL expressivity (no complex role chains, limited disjointness reasoning).',
        verdict: 'Proposed for classification',
      },
      {
        option: 'HermiT (complete OWL DL)',
        strengths: 'Complete reasoning; catches subtle inconsistencies.',
        weaknesses: 'Worst-case exponential; minutes-long runs at module scale.',
        verdict: 'Optional per-module toggle only',
      },
      {
        option: 'OWL-RL over Oxigraph (open-ontologies)',
        strengths: 'Forward-chaining to a fixpoint; embeds as a single binary with no JVM; brings SPARQL 1.1 and a W3C SHACL validator in the same process.',
        weaknesses: 'Partial semantics — RL does not capture everything an EL or DL reasoner would.',
        verdict: 'Adopted',
      },
    ],
    gains: [
      'Result contract (inferences, consistency, violations) is stable — swapping the engine changes internals only',
      'Real OWL-RL entailment with iteration counts and triple deltas, not a simulation',
      'SPARQL 1.1 and W3C SHACL validation come from the same engine, so shapes and queries agree',
      'Falls back to the deterministic walker when the engine is offline, and says which path ran',
    ],
    costs: [
      'RL is an incomplete profile — some axioms an EL or DL reasoner would catch are missed',
      'Adds an out-of-process dependency that must be deployed alongside the app',
      'The triple store is global and unscoped, so concurrent runs contend for it',
    ],
    tradeoff: '> real entailment from an embeddable engine, and an honest fallback — over complete reasoning that needs a JVM.',
    callout: {
      kind: 'info',
      title: 'Engine dependency',
      text: 'Reasoning, SHACL validation and SPARQL are served by the open-ontologies binary, which is not vendored in the repository — see the README. When it is unreachable, classification falls back to a deterministic subclass walker and the response names the path that produced it.',
    },
  },
  {
    id: 'ADR-005',
    title: 'NL→Query: ontology-grounded generation, mandatory validation, read-only guard',
    shortTitle: 'NL→Query safety',
    status: 'accepted',
    date: '2025-09-15',
    deciders: ['Amara Okafor', 'D. Chen', 'R. Alvarez'],
    context: [
      'Graph Explorer lets users ask questions in English. Any natural-language-to-query path is a safety surface: generated queries run against production-shaped data, so the pipeline must guarantee (a) the query means something in the ontology, and (b) it can only read, never write.',
      'The generated query is always shown and editable — the feature is a drafting assistant, not an oracle.',
    ],
    decision:
      'Translation is ontology-grounded: module schemas (classes, properties, prefixes) are the generation context. Output is parsed into an AST, validated against the ontology (every class/property IRI must resolve), and passed through a read-only guard that refuses anything unvalidatable or write-capable, with an explanation. Refusals are a feature: they are logged and shown verbatim.',
    alternatives: [
      {
        option: 'Unvalidated LLM generation, execute directly',
        strengths: 'Maximally flexible; handles arbitrary phrasing.',
        weaknesses: 'Hallucinated IRIs, write-capable output, unbounded cost rows. Unacceptable.',
        verdict: 'Rejected',
      },
      {
        option: 'Fixed question templates only',
        strengths: 'Perfectly safe; deterministic.',
        weaknesses: 'Covers only pre-anticipated questions; the UI promise is free-form asking.',
        verdict: 'Rejected as sole mechanism — retained as the seeded question space',
      },
      {
        option: 'Ontology-grounded generation + AST validation + read-only guard',
        strengths: 'Free-form input, provably read-only output, explainable refusals.',
        weaknesses: 'Two-stage pipeline to maintain; generator quality still bounds coverage.',
        verdict: 'Adopted',
      },
    ],
    gains: [
      'Every executed query is provably read-only and ontology-valid',
      'Refusals teach the ontology boundary instead of failing silently',
      'Guardrails are independent of the generator — swapping providers changes generation only',
    ],
    costs: [
      'Coverage is bounded by the question space the translator handles',
      'Validation pipeline adds latency before first results',
    ],
    tradeoff: '> we would rather refuse a question with an explanation than answer it wrong.',
    callout: {
      kind: 'info',
      title: 'Evaluation build disclosure',
      text: 'In this evaluation build the translator is a deterministic, ontology-grounded simulator covering the seeded question space — same validation pipeline, same refusal behavior, fully offline. Swapping in a live LLM provider changes generation only, not the guardrails.',
    },
  },
  {
    id: 'ADR-006',
    title: 'LLM provider model: pluggable per-tenant adapter',
    shortTitle: 'LLM provider model',
    status: 'superseded',
    date: '2025-09-30',
    deciders: ['D. Chen', 'S. Park'],
    context: [
      'Narrative features (insight summaries, weekly digests) need an LLM, but tenants have incompatible constraints: some require fully-local inference (Ollama), others have OpenAI/Anthropic/OpenRouter contracts. The original decision hard-wired a single hosted provider with a server-side key.',
    ],
    decision:
      'Supersedes the single-provider decision: an LLM adapter interface with tenant-scoped configuration (Ollama local / OpenAI / Anthropic / OpenRouter), surfaced in Admin. Narrative features degrade gracefully to template summaries when no provider is reachable — the insight engine\'s findings never depend on LLM availability. In this build the sidebar reports the local Ollama profile and narratives render from the deterministic template path.',
    alternatives: [
      {
        option: 'Single hosted provider, server-side key (original)',
        strengths: 'One integration to maintain; predictable quality.',
        weaknesses: 'Fails data-residency tenants; single point of failure; key management per environment.',
        verdict: 'Superseded by this ADR',
      },
      {
        option: 'Pluggable per-tenant adapter',
        strengths: 'Meets residency constraints; graceful degradation; tenant choice.',
        weaknesses: 'N integrations to test; quality varies per provider.',
        verdict: 'Adopted',
      },
      {
        option: 'No LLM features at all',
        strengths: 'Simplest; fully deterministic.',
        weaknesses: 'Narrative summaries are a visible product differentiator.',
        verdict: 'Rejected — degrade instead of remove',
      },
    ],
    gains: [
      'Tenants pick local or hosted inference per policy',
      'Core findings are LLM-independent — no provider outage can hide an anomaly',
    ],
    costs: [
      'Provider matrix needs conformance tests',
      'Template fallback must be maintained to the same quality bar',
    ],
    tradeoff: '> the model is a peripheral, not an organ — the platform must keep breathing when it\'s unplugged.',
    callout: {
      kind: 'warn',
      title: 'Superseded — never edited',
      text: 'This entry replaces the original single-provider decision (2025-08-14 draft). Per ADR policy the original text is retained struck-through in the collapsed view; the current, operative decision is shown here.',
    },
  },
];

export const STATUS_META: Record<AdrStatus, { label: string; color: string }> = {
  accepted: { label: 'ACCEPTED', color: '#34D399' },
  proposed: { label: 'PROPOSED', color: '#38BDF8' },
  superseded: { label: 'SUPERSEDED', color: '#94A3B8' },
};

export const ARCH_SECTIONS = [
  { id: 'arch-context', label: 'ARCH · Context' },
  { id: 'arch-containers', label: 'ARCH · Containers' },
  { id: 'arch-dataflow', label: 'ARCH · Data flow' },
  { id: 'arch-scale', label: 'ARCH · Scale & ops' },
] as const;

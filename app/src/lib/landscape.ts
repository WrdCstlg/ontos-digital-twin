/**
 * Where Ontos stands: its own architecture, and its capabilities next to
 * Palantir Foundry's Ontology, the platform it is most often measured against.
 *
 * One source for the Landscape page and the README summary. Change a row in the
 * same commit as the code that changes it, and keep claims to what the code
 * does. The Palantir column summarises Foundry's public documentation; it is a
 * reading of that documentation, not a benchmark.
 */

export const LANDSCAPE_AS_OF = "2026-09-25";

/* ── architecture ────────────────────────────────────────────── */

export type ServiceKind = "client" | "process" | "store" | "engine" | "external";

export type Service = {
  id: string;
  name: string;
  kind: ServiceKind;
  /** What it runs as. */
  runtime: string;
  responsibilities: string[];
  /** The increment that introduced it, when it is new. */
  since?: string;
};

export type Link = { from: string; to: string; label: string };

export const services: Service[] = [
  {
    id: "spa",
    name: "Web app",
    kind: "client",
    runtime: "React single-page app",
    responsibilities: ["Studio, Explorer, Mapping, Insights, Twins, Actions, Operations", "Talks to the API over tRPC"],
  },
  {
    id: "app",
    name: "API server",
    kind: "process",
    runtime: "Node · Hono + tRPC · container `app`",
    responsibilities: [
      "Authentication, workspace isolation, roles",
      "Ontology, graph, twin and insight APIs; SPARQL 1.1 endpoint",
      "Action types: checks a submission, then applies it with its record and audit entry in one transaction",
      "Queues background work instead of running it in the request",
      "Still in this process: MQTT connections, reasoning runs, insight scans",
    ],
  },
  {
    id: "worker",
    name: "Worker",
    kind: "process",
    runtime: "Node · container `worker` · any number",
    responsibilities: [
      "Runs queued jobs under leases; a crashed worker's job is reclaimed",
      "CSV imports, and the webhooks of applied actions",
    ],
    since: "Increment 1",
  },
  {
    id: "db",
    name: "MySQL",
    kind: "store",
    runtime: "MySQL 8.4 · container `db`",
    responsibilities: [
      "System of record: ontology modules, knowledge graph, twin history",
      "Job queue and worker heartbeats",
      "Action types, their versions and every submission",
      "Hash-chained audit log",
    ],
  },
  {
    id: "engine",
    name: "Semantic engine",
    kind: "engine",
    runtime: "open-ontologies over Oxigraph · one per process",
    responsibilities: ["SPARQL, OWL-RL reasoning, SHACL validation", "Holds one graph at a time"],
  },
  {
    id: "engine-worker",
    name: "Worker's engine",
    kind: "engine",
    runtime: "open-ontologies · container `engine-worker`",
    responsibilities: ["SHACL checks before imports", "Separate so the API's engine is never interrupted"],
    since: "Increment 1",
  },
  {
    id: "devices",
    name: "Devices and brokers",
    kind: "external",
    runtime: "MQTT, AWS IoT, Azure IoT, HTTP webhook",
    responsibilities: ["Telemetry for digital twins"],
  },
  {
    id: "llm",
    name: "LLM providers",
    kind: "external",
    runtime: "OpenAI, Anthropic, Ollama, OpenRouter (optional)",
    responsibilities: ["Questions to read-only SPARQL, checked before it runs"],
  },
  {
    id: "webhooks",
    name: "Webhook receivers",
    kind: "external",
    runtime: "Any HTTP endpoint an action names",
    responsibilities: ["Receive each applied action, at least once"],
    since: "Increment 2",
  },
];

export const links: Link[] = [
  { from: "spa", to: "app", label: "tRPC" },
  { from: "devices", to: "app", label: "webhook · MQTT" },
  { from: "app", to: "db", label: "reads, writes, enqueues" },
  { from: "worker", to: "db", label: "leases jobs" },
  { from: "app", to: "engine", label: "SPARQL · reasoning · SHACL" },
  { from: "worker", to: "engine-worker", label: "SHACL" },
  { from: "app", to: "llm", label: "NLQ" },
  { from: "worker", to: "webhooks", label: "action side effects" },
];

export type RoadmapStatus = "shipped" | "next" | "planned";

/** Where the architecture goes next, one increment at a time. */
export const roadmap: { increment: number; title: string; status: RoadmapStatus; summary: string }[] = [
  {
    increment: 1,
    title: "Worker service and job queue",
    status: "shipped",
    summary:
      "Long-running work leaves the web process. A durable queue in MySQL with leases, a separate worker container, an Operations page.",
  },
  {
    increment: 2,
    title: "Action types",
    status: "shipped",
    summary:
      "Named, parameterised edits with validation, role permissions and an audited record of every submission; side effects run on the worker.",
  },
  {
    increment: 3,
    title: "Ontology API and typed SDK",
    status: "next",
    summary:
      "A versioned public API described by OpenAPI and generated from the ontology, with a typed TypeScript client: the contract other systems bind to.",
  },
];

/* ── capabilities ────────────────────────────────────────────── */

export type CapabilityStatus = "has" | "partial" | "gap" | "planned" | "by-design";

export type Capability = {
  area: string;
  palantir: string;
  ontos: string;
  status: CapabilityStatus;
  /** For planned rows, the increment that closes the gap. */
  increment?: number;
};

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  has: "Comparable",
  partial: "Partial",
  gap: "Gap",
  planned: "Planned",
  "by-design": "Different by design",
};

export const capabilities: Capability[] = [
  {
    area: "Semantic model",
    palantir: "Object types with typed properties, and link types between them, managed in Ontology Manager.",
    ontos: "OWL classes with datatype and object properties in versioned modules (HR, legal, compliance, finance, logistics, twins), edited in Studio.",
    status: "has",
  },
  {
    area: "Shared contracts across types",
    palantir: "Interfaces: a shape that several object types implement.",
    ontos: "Inheritance through rdfs:subClassOf with OWL-RL reasoning. No contract that unrelated classes can implement.",
    status: "partial",
  },
  {
    area: "Governed edits",
    palantir: "Action types: parameterised edits with submission criteria, permissions, side effects and a record of every submission.",
    ontos: "Action types: typed parameters (including objects), submission criteria, declarative edits, a minimum role and module scopes, an optional SHACL check, webhook side effects on the worker, versioned definitions, and a record and audit entry for every submission. No function-backed or bulk actions.",
    status: "has",
    increment: 2,
  },
  {
    area: "Logic on the ontology",
    palantir: "Functions: code that reads and derives from objects, used by actions and applications.",
    ontos: "Twelve insight rules and the question intents are TypeScript in the server. The ontology carries no user-defined logic.",
    status: "gap",
  },
  {
    area: "Programmatic access",
    palantir: "Ontology SDK: client libraries generated from the ontology, typed per object type.",
    ontos: "A tRPC API for its own web app and a read-only SPARQL 1.1 endpoint. No public, versioned API or generated SDK yet.",
    status: "planned",
    increment: 3,
  },
  {
    area: "Query and exploration",
    palantir: "Object sets, search and Object Explorer; graph exploration in Vertex.",
    ontos: "Graph explorer and search, SPARQL 1.1, questions in plain language compiled to SPARQL, graph analytics. No saved, shareable object sets.",
    status: "partial",
  },
  {
    area: "Data integration",
    palantir: "Pipelines and connectors feed datasets that back object types, with lineage.",
    ontos: "CSV connectors with column mappings (exportable as R2RML), imported by the worker with retries. SQL and REST connectors are modelled but not imported yet.",
    status: "partial",
  },
  {
    area: "Background execution",
    palantir: "Platform services run builds, syncs and action side effects apart from the user's session.",
    ontos: "A durable job queue with leases and a separate worker, which runs imports and action side effects; a crashed worker's job is reclaimed. Reasoning runs and insight scans still run in the API process.",
    status: "partial",
  },
  {
    area: "Validation",
    palantir: "Validation rules on action submissions.",
    ontos: "W3C SHACL shapes per class with explained violations and remediation, checked before imports and, where an action asks, before its edits are applied; OWL-RL reasoning for consistency.",
    status: "has",
  },
  {
    area: "Change management",
    palantir: "Branches and proposals for reviewed ontology changes.",
    ontos: "Module versions with diffs, deprecation and an audit record. No branch-and-review workflow.",
    status: "partial",
  },
  {
    area: "Access control",
    palantir: "Granular permissions down to properties, and markings as mandatory controls.",
    ontos: "Workspace isolation and four workspace roles. Each action type has a minimum role, and module scopes limit which actions a member may submit. Nothing finer than a module.",
    status: "partial",
  },
  {
    area: "Time series and twins",
    palantir: "Time series properties on objects.",
    ontos: "Digital twins with live state, per-key telemetry history, DTDL v3 export, and IoT ingestion over MQTT and webhooks.",
    status: "has",
  },
  {
    area: "Applications",
    palantir: "App builders (Workshop, Slate) and analysis tools (Quiver, Vertex, Map) on the ontology.",
    ontos: "Fixed application pages. No app builder.",
    status: "partial",
  },
  {
    area: "AI on the ontology",
    palantir: "AIP: LLM tools that read the ontology and can call actions under its permissions.",
    ontos: "A pluggable LLM gateway that turns questions into read-only SPARQL, checked before it runs. It cannot write.",
    status: "partial",
  },
  {
    area: "Architecture and scale",
    palantir: "Distributed services for object storage, indexing, actions and functions, run at enterprise scale.",
    ontos: "An API process and any number of workers over one MySQL database, each process with its own semantic engine.",
    status: "gap",
  },
  {
    area: "Audit",
    palantir: "Audit logs of user activity and action submissions.",
    ontos: "A hash-chained, tamper-evident audit log per workspace, with an entry for every action submission, applied or rejected.",
    status: "has",
  },
  {
    area: "Open standards",
    palantir: "Its own ontology model, reached through its APIs and SDKs.",
    ontos: "W3C standards end to end: OWL and Turtle export, SHACL, SPARQL 1.1, plus DTDL v3 and R2RML.",
    status: "by-design",
  },
  {
    area: "Scope",
    palantir: "One platform from data integration to operational applications.",
    ontos: "The semantic layer only. Causal, measurement, incentive and propagation layers are separate systems that bind to it.",
    status: "by-design",
  },
];

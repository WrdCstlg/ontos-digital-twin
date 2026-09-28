# Ontos

[![CI](https://github.com/WrdCstlg/ontos-digital-twin/actions/workflows/ci.yml/badge.svg)](https://github.com/WrdCstlg/ontos-digital-twin/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![TypeScript 5.9](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Hono 4](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)

[![Docker](https://img.shields.io/badge/docker-compose%20ready-2496ED?logo=docker&logoColor=white)](compose.yaml)

An enterprise ontology management and digital twin platform. Ontos models five business
domains — HR, Legal, Compliance, Finance, Logistics — plus a DTDL-compatible Digital Twin
layer, and unifies them into a single governed knowledge graph with deterministic anomaly
detection, a hash-linked audit chain, and native RDF/OWL semantics.

It ships with a fully seeded demo workspace (Acme Corp) containing ~3,600 graph nodes and
~7,700 edges, including deliberately planted anomalies for the insight engine to surface.

---

## Capabilities

- **Ontology Studio** — browse, extend, version and diff ontology modules; Cytoscape.js
  class graph, Turtle export, SHACL shape authoring.
- **Knowledge Graph Explorer** — interactive graph traversal with cross-module edges.
- **Native semantics** — OWL-RL reasoning, W3C SHACL validation and SPARQL 1.1 over an
  Oxigraph triple store (see [Semantic engine](#semantic-engine)).
- **Explainable SHACL** — violations are returned with a justification tree, a canonical
  signature, a human-readable explanation and a remediation action.
- **Insight engine** — 12 deterministic anomaly rules over the graph (no LLM involved).
- **Digital twins** — twin registry, live telemetry time series, topology subgraphs, and
  Azure DTDL v3 JSON export.
- **Data mapping** — CSV files and PostgreSQL or MySQL tables mapped to ontology classes
  and properties, with pre-commit SHACL checks that warn or, per mapping, block, imported
  by a background worker.
- **Global search** — ⌘K / Ctrl+K searches instances, classes, properties, insights,
  action types and connectors in the current workspace.
- **Background jobs** — a durable queue in MySQL with leases and retries; any number of
  worker processes, each with its own semantic engine (see
  [Known limitations](#known-limitations)); a worker that dies mid-job has its job
  reclaimed. The Operations page shows the queue and the workers.
- **Action types** — named, parameterised edits to the knowledge graph: typed parameters
  (including objects of a class), submission criteria, declarative rules (create, change
  and delete objects; add, remove and replace links), a minimum role and module scopes,
  an optional SHACL check of the result, and webhook side effects run by the worker.
  Definitions are versioned, and every submission, applied or rejected, is recorded and
  audited. See [Action types](#action-types).
- **Natural language query** — pattern-based NL → SPARQL translation with a deterministic
  template engine; a pluggable LLM gateway (Ollama, OpenAI, Anthropic, OpenRouter) is
  available for SPARQL generation when configured. Both paths show the generated query
  and refuse write or unsafe intents.
- **RBAC + audit** — five roles, per-route authorization, SHA-256 hash-linked audit log.

---

## Architecture

```mermaid
graph TD
    User["Enterprise User / Ontologist"] <-->|HTTPS| Web["React 19 SPA<br/>(Vite 7, Cytoscape, Three.js)"]
    Web <-->|tRPC 11 / JSON| Hono["API server<br/>(Hono 4 + Node 24)"]
    Hono <-->|Drizzle ORM| MySQL[("MySQL 8.4<br/>graph, state, job queue, audit")]
    Hono <-->|SPARQL 1.1 / HTTP| Engine["open-ontologies<br/>(Oxigraph, OWL-RL, SHACL)"]
    Worker["Worker(s)<br/>(Node 24)"] <-->|leases jobs| MySQL
    Worker <-->|SHACL| EngineW["open-ontologies<br/>(the worker's own)"]
    Worker -->|action side effects| Hooks["Webhook receivers"]

    subgraph Compose ["Docker Compose stack"]
        Hono
        Worker
        MySQL
        Engine
        EngineW
    end
```

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, TypeScript 5.9, Tailwind CSS 3.4, Radix UI |
| Visualization | Cytoscape.js, Recharts, Three.js / react-three-fiber |
| API | Hono 4 (HTTP), tRPC 11 (type-safe RPC), SuperJSON |
| Database | MySQL 8, Drizzle ORM 0.45 |
| Semantics | open-ontologies — Oxigraph store, OWL-RL reasoner, SHACL validator |
| Auth | Self-contained HS256 JWT (`jose`), scrypt password hashing |
| Build | Vite (client) + esbuild (server bundle) |
| Tests | Vitest |

In development, Vite serves the SPA and mounts the Hono app at `/api/*` through
`@hono/vite-dev-server`: a single process on port 3000, which also runs a job worker of
its own. In production, `dist/boot.js` serves the API and the static client bundle, and
`dist/worker.js` runs background jobs in the `worker` container, with a health endpoint
on port 3001. `ONTOS_EMBEDDED_WORKER=true` runs jobs inside the API process instead, for
a single-container deployment.

Long-running work does not run inside an HTTP request. `mapping.runSync` records a
queued import and returns; a worker claims it with `SELECT … FOR UPDATE SKIP LOCKED`,
renews a 15-second lease while it works, and records the outcome only while it still
holds the lease. A failed attempt is retried up to three times with backoff. A worker
that stops renewing (crashed, killed, or cut off) loses the job to another worker when
the lease lapses, and a job so stranded is claimed before any queued one. A claim runs
at READ COMMITTED and reads due jobs in the order of their index, so it locks the one
job it takes and workers claiming at once pass each other rather than wait or deadlock.

An action submission is planned outside any lock, then applied in one transaction: the
objects it read are locked and checked unchanged, and the edits, the submission record,
its audit entry and its side-effect jobs commit together or not at all. A deadlock runs
the whole transaction again; objects that changed in between are planned again once.

---

## Landscape

Ontos is often measured against Palantir Foundry's Ontology. The **Landscape** page in the
app compares them capability by capability and draws Ontos's own architecture; its source
is [`app/src/lib/landscape.ts`](app/src/lib/landscape.ts). In short:

| Comparable | Partial | Gap or planned | Different by design |
|---|---|---|---|
| Semantic model, governed edits, validation, programmatic access (API and SDK), time series and twins, audit | Interfaces, exploration, data integration, background execution, change management, access control, applications, AI | Logic on the ontology, distributed scale | Open W3C standards end to end; the semantic layer only |

The architecture is changing one increment at a time:

1. **Worker service and job queue** (shipped): long-running work leaves the web process.
2. **Action types** (shipped): named, parameterised edits with validation, permissions and
   an audited record of every submission; side effects run on the worker.
3. **Ontology API and typed SDK** (shipped): a versioned public API generated from the
   ontology, and a typed client for the systems that bind to it. See
   [Ontology API](#ontology-api).

---

## Quick start

### With Docker — recommended

Needs only Docker. Brings up MySQL, the semantic engine, and the app.

```bash
cp .env.example .env      # fill in the four secrets: openssl rand -hex 32
docker compose up --build
```

Open http://localhost:3000 and sign in as `ADMIN_EMAIL` with `ADMIN_PASSWORD`.

The first boot takes about twenty seconds: a one-shot `init` service applies the SQL
migrations, seeds the Acme Corp demo workspace, and creates the admin account. Later boots
apply any new migrations and leave your data alone — the seed runs only against an empty
database. To wipe everything and start over:

```bash
docker compose down -v    # -v deletes the database volume
```

### Local development

Needs **Node.js 20+** (developed against 24.x), **MySQL 8+**, and optionally the
[semantic engine](#semantic-engine) binary.

```bash
cd app
npm install
cp .env.example .env      # APP_SECRET and DATABASE_URL are required

npm run build:db          # bundle the bootstrap and seed scripts
npm run db:bootstrap      # migrate, seed on first run, provision the admin account
npm run dev               # http://localhost:3000
```

`db:bootstrap` is the same job the Docker `init` service runs, so both paths build the
database identically.

### Signing in

In development, the login screen offers four one-click demo personas, created on first use
and enrolled in the demo workspace in their own role:

| Role | Persona | Account |
|---|---|---|
| `admin` | Elena Cortez | demo-admin@acme-ontology.com |
| `ontologist` | Dr. James Wei | demo-ontologist@acme-ontology.com |
| `editor` | Priya Sharma | demo-editor@acme-ontology.com |
| `viewer` | Alex Morgan | demo-viewer@acme-ontology.com |

Personas have **no password**. They exist only behind the persona buttons, and the
credential form refuses their addresses.

**Production disables persona login**, which is why the Docker stack provisions a real
admin account instead. To re-enable personas for a local demo, set `ALLOW_DEMO_LOGIN=true` —
but understand that anyone who can reach the server can then sign in as any role, admin
included, without a password. The server logs a warning at startup whenever it is on.
Switching it off again is a real off switch: persona sessions stop authenticating
immediately, and the bootstrap clears any password an older build left on a persona
account.

---

## Environment variables

### Docker

The root `.env` (from the root `.env.example`) feeds `compose.yaml`. The four secrets are
required; `docker compose` refuses to start without them.

| Variable | Required | Purpose |
|---|---|---|
| `APP_SECRET` | **yes** | Signs session tokens. 32+ random characters; the app refuses to start with fewer. |
| `MYSQL_PASSWORD` | **yes** | Password for the `ontos` database user. Use hex — it is embedded in a URL. |
| `MYSQL_ROOT_PASSWORD` | **yes** | MySQL root password. |
| `ADMIN_PASSWORD` | **yes** | Password for the admin account. Re-applied whenever the bootstrap runs, so change it and run `docker compose up -d` to rotate it. `docker compose restart` does not re-run the bootstrap. |
| `ADMIN_EMAIL` | no | Admin account address. Default `admin@acme-ontology.com`. |
| `ONTOS_PORT` | no | Host port for the app. Default `3000`. |
| `SECRETS_KEY` | no | Seals connector credentials in the database; 64 hex characters (`openssl rand -hex 32`). Unset, a key derived from `APP_SECRET` is used, so changing `APP_SECRET` alone makes stored credentials unreadable. Setting it later is safe: the next start re-seals under it. |
| `SECRETS_KEY_PREVIOUS` | no | When rotating `SECRETS_KEY`, the old key: the next start re-seals what it sealed under the new one. Remove it afterwards. |
| `ALLOW_DEMO_LOGIN` | no | `true` re-enables persona login. Local demos only — see [Signing in](#signing-in). |
| `ALLOWED_ORIGINS` | no | Cross-origin allowlist. The bundled client is same-origin and needs nothing here. |

### Application

`app/.env` (from `app/.env.example`) configures the server directly. Only `APP_SECRET` and
`DATABASE_URL` have no usable default.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `APP_SECRET` | **yes** | — | HS256 signing key for session JWTs. Use 32+ random chars; production refuses fewer. |
| `SECRETS_KEY` | no | derived from `APP_SECRET` | AES-256-GCM key that seals connector credentials: 32 bytes as 64 hex characters, or as base64 with its `=` padding (`openssl rand -base64 32`). A malformed key stops the server, the worker and the bootstrap at start. |
| `SECRETS_KEY_PREVIOUS` | no | — | The key `SECRETS_KEY` replaced, while `db:bootstrap` re-seals what it sealed. |
| `DATABASE_URL` | **yes** | — | MySQL connection string, e.g. `mysql://root:@localhost:3306/ontos` |
| `APP_ID` | no | `ontos` | Application identifier |
| `ADMIN_EMAIL` | no | `admin@acme-ontology.com` | This address is auto-promoted to the `admin` role |
| `ADMIN_PASSWORD` | no | — | When set, `db:bootstrap` provisions the admin account with it (12+ chars) |
| `ALLOW_DEMO_LOGIN` | no | `false` | `true` re-enables persona login in production |
| `PORT` | no | `3000` | Production HTTP port |
| `NODE_ENV` | no | — | `production` enables static serving, strict cookies, and required-secret checks |
| `ALLOWED_ORIGINS` | no | — | Comma-separated CORS/CSRF allowlist for **cross-origin** callers. Production rejects any cross-origin request not listed; same-origin use is unaffected. |
| `MIGRATIONS_DIR` | no | `./db/migrations` | Where `db:bootstrap` finds SQL migrations |
| `OPEN_ONTOLOGIES_URL` | no | `http://127.0.0.1:8085` | Semantic engine base URL |
| `OPEN_ONTOLOGIES_PORT` | no | `8085` | Port used when auto-starting the engine |
| `OPEN_ONTOLOGIES_TOKEN` | no | — | Bearer token, if the engine requires one |
| `OPEN_ONTOLOGIES_BIN` | no | — | Explicit path to the engine binary |
| `ACTION_WEBHOOK_ALLOW_PRIVATE` | no | `false` | `true` lets action webhooks reach loopback and private addresses (for receivers inside your network) |
| `VITE_APP_ID` | no | — | Application identifier exposed to the browser |

---

## Semantic engine

Reasoning, SHACL validation and SPARQL are delegated to
[open-ontologies](https://github.com/fabio-rovai/open-ontologies) (MIT), a standalone Rust
binary that runs an in-memory Oxigraph triple store behind an HTTP API. Ontos is tested
against **v1.3.0**.

**With Docker** there is nothing to install. The `engine` service runs the official image,
`ghcr.io/fabio-rovai/open-ontologies:1.3.0`, pinned by digest, as a non-root user on a
read-only filesystem. The engine reads SHACL shapes only from a file path, so the app and
engine share a small in-memory volume at `/exchange`: the app writes shapes there, the
engine reads them.

**For local development**, download the v1.3.0 binary for your platform from the
[release page](https://github.com/fabio-rovai/open-ontologies/releases/tag/v1.3.0) — Linux
x86_64, macOS (Intel and Apple Silicon) and Windows are published — and verify it against
the release's `SHASUMS.txt`. Binaries are gitignored, so place it at either:

```
bin/open-ontologies          # repo root  (bin/open-ontologies.exe on Windows)
app/bin/open-ontologies
```

or point `OPEN_ONTOLOGIES_BIN` at it. The server resolves these paths at startup and
spawns the daemon on demand, detached, so it outlives the process that started it:

```bash
open-ontologies daemon start --host 127.0.0.1 --port 8085
open-ontologies daemon status
open-ontologies daemon stop
```

Engine state is confirmed by the health endpoint:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"connected","semanticEngine":{"status":"connected","version":"1.3.0",...}}
```

**Without the engine**, the app still runs. Reasoning falls back to a deterministic
in-process subclass walker, and SHACL validation is skipped — see
[Known limitations](#known-limitations) for how that is reported.

---

## Scripts

Run from `app/`.

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server + API on port 3000 |
| `npm run build` | Production build → `dist/public` (client) and `dist/boot.js` (server) |
| `npm run build:db` | Bundle the bootstrap and seed scripts → `dist/db/` |
| `npm run db:bootstrap` | Migrate, seed an empty database, provision the admin account |
| `npm start` | Serve the production build |
| `npm run check` | TypeScript project build (`tsc -b`) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | Vitest suite |
| `npm run test:mysql` | Server tests on a real MySQL 8.4 (see [Testing](#testing)) |
| `npm run db:generate` | Generate a SQL migration into `db/migrations` after a schema change |
| `npm run db:migrate` | Apply pending migrations with drizzle-kit |
| `npm run db:push` | Push the schema straight to MySQL, bypassing migrations — prototyping only |

`npm start` is written for a POSIX shell. On Windows, run the equivalent directly:

```powershell
$env:NODE_ENV = "production"; node dist/boot.js
```

---

## Project structure

```
compose.yaml                 Full stack: db, engine, init, app
.env.example                 Secrets for the compose stack
docs/semantic-layer/         Cross-functional ontology draft (xfn): a design, not implemented
gate/                        The PRO-THESIS fault-injection gate (gate/README.md)
app/
├── Dockerfile               Two-stage build; runtime carries no node_modules
├── api/                     Hono server + tRPC routers
│   ├── auth/                Session JWTs and login services
│   ├── lib/                 env, cookies, password hashing, rate limiting
│   ├── queries/             Database access helpers
│   ├── services/            Business logic
│   │   ├── semanticEngine.ts    open-ontologies client (reasoning, SHACL, SPARQL)
│   │   ├── rdfBridge.ts         Schema/instance ⇄ Turtle serialization
│   │   ├── explainableShacl.ts  Justification trees and remediation guidance
│   │   ├── nlq.ts               Natural language → SQL translation
│   │   ├── twinModels.ts        DTDL model definitions
│   │   └── audit.ts             Hash-linked audit chain
│   ├── boot.ts              App entry: middleware, health, SPARQL, tRPC mount
│   ├── middleware.ts        Procedure builders (public/authed/ontologist/admin)
│   └── *Router.ts           ontology, graph, mapping, insights, nlq, twin, dashboard, admin
├── contracts/               Types and constants shared by client and server
├── db/
│   ├── schema.ts            Drizzle schema — 16 tables
│   ├── relations.ts         Drizzle relations
│   ├── migrations/          Versioned SQL migrations (drizzle-kit)
│   ├── bootstrap.ts         Migrate → seed if empty → provision admin
│   ├── seed.ts              Ontology + knowledge graph seed (wipes first)
│   └── seed-twins.ts        Digital twin + telemetry seed (wipes first)
└── src/                     React application
    ├── pages/               Dashboard, Library, Studio, Explorer, Mapping,
    │                        Insights, Twins, Admin, Decisions, Guide, Login
    ├── components/          Domain components + Radix UI primitives
    ├── hooks/  providers/   useAuth, tRPC client
    └── lib/modules.ts       Module registry and semantic color system
```

---

## Domain model

### Ontology modules

Six seeded modules, plus `custom` for user-defined extensions. Each has a fixed semantic
colour used consistently across every UI surface (`src/lib/modules.ts`).

`hr` · `legal` · `compliance` · `finance` · `logistics` · `twin`

### Insight rules

Twelve deterministic rules in `api/insightsRouter.ts`. All are pure graph queries — no
model inference is involved, so results are reproducible and every finding is traceable to
its evidence nodes.

| Rule | Severity |
|---|---|
| `vendor-payment-without-contract` | risk |
| `transaction-without-cost-center` | risk |
| `contract-governed-by-policy-with-open-finding` | risk |
| `twin-cold-chain-excursion` | risk |
| `unmitigated-high-risk` | risk |
| `budget-overrun` | risk |
| `control-without-evidence-90d` | warn |
| `org-island` | warn |
| `contract-expiring-without-renewal` | warn |
| `vendor-spend-concentration` | warn |
| `carrier-shipment-concentration` | warn |
| `person-without-manager` | info |

### Action types

An action type is a named, versioned edit that people submit through the **Actions** page,
or from an object in the Explorer. Its definition (`contracts/actions.ts`) has:

- **Parameters**: text, number, yes/no, date, a choice from a list, or an object of a class
  (or a subclass of it).
- **Criteria** every submission must meet: comparisons over parameters and the named
  objects' properties, such as "the contract is active" or "the new end date is after the
  current one", and "these two objects differ".
- **Rules**, applied in order: create, change or delete an object; add, remove or replace a
  link. Values are templates such as `{newEndDate}`, `{contract.endDate}`, `{actor}` or
  `{today}`.
- **Validation**: optionally, the objects it creates or changes are checked against their
  classes' SHACL shapes, and a violation refuses the submission.
- **Side effects**: webhooks the worker POSTs the applied submission to, at least once,
  with an `Idempotency-Key`. The worker refuses internal addresses unless
  `ACTION_WEBHOOK_ALLOW_PRIVATE=true`.

Each action type has a minimum workspace role. A member whose membership is scoped to
modules may submit only the actions of those modules. Admins and ontologists write
definitions; every save is a new version, and a submission records the version it ran.
Every submission is recorded with its parameters and its outcome, applied or rejected with
the reasons, and written to the audit log. An object an action created or changed shows
the submission in its provenance.

The seed defines four: **Reassign manager** and **Renew contract**, which resolve the
`person-without-manager` and `contract-expiring-without-renewal` findings; **Record
termination**, for ontologists; and **Onboard employee**, whose SHACL check refuses a work
email outside `@acme.com`.

### Roles

`viewer` → `editor` → `ontologist` → `admin`, enforced by tRPC procedure builders in
`api/middleware.ts`. A legacy `user` role remains the schema default and carries no
elevated access.

Within a workspace, a member's role there decides what they may do: a workspace admin
can make any member a viewer in their workspace, except a platform administrator. An
account's own role counts only when it is `admin`, a platform administrator, who is an
admin in every workspace. The same rule governs who may submit an action, the highest
role a new API token may have, and the role the Ontology API acts with. API tokens minted
by someone whose account role was above their membership now act at the membership's role.

- `authedQuery` / `authedMutation` — any signed-in user
- `workspaceOntologistQuery` / `workspaceOntologistMutation` — editors and above: writes to
  the workspace's data (imports, telemetry, the twin simulation, acknowledging a finding)
- `workspaceAdminQuery` / `workspaceAdminMutation` — the workspace's admins: members,
  connectors and broker credentials, retrying jobs
- `publicQuery` — unauthenticated entry points only (`ping`, `auth.login`, `auth.demoLogin`)

There are no procedures gated on the account's own role.

Ontologists and admins define action types and see webhook addresses in full. A mapping
set to block imports nothing its class's SHACL shapes reject, and only ontologists and
admins can let such rows in: switch its check back to warn, move it to another class, or
add a mapping into the same class that only warns. Anyone who may edit a mapping may make
it block.

The client never decides by role: the sidebar shows the person's role in the workspace
(`auth.membership`), and pages that offer role-dependent controls (actions, twins, IoT,
insights, mapping) ask their router's `capabilities`. Everywhere else the server refuses
what the role may not do.

### Digital twins

Twins are `kgNodes` with `moduleKey = "twin"` and a `dtwin:` class IRI. Telemetry is
appended to the `twinStateLog` time-series table. `twinRouter.ts` exports Azure DTDL v3
JSON.

Six concrete twin types sit under two abstract branches, all defined in
`api/services/twinModels.ts`:

```
DigitalTwin
├── FacilityTwin  → WarehouseTwin, ZoneTwin
└── AssetTwin     → ShipmentTwin, CarrierTwin, InventoryTwin, EquipmentTwin
```

#### IoT Brokers & Live Telemetry Ingestion

Ontos includes standard protocol adapters to ingest live telemetry directly from enterprise IoT brokers and industrial edge gateways into active digital twins:

- **Universal MQTT (3.1.1 / 5.0)**: Connects to standard brokers like Mosquitto, EMQX, HiveMQ, or RabbitMQ. Supports wildcard topic patterns (`ontos/twins/+/telemetry`).
- **AWS IoT Core**: Connects directly via MQTT over mTLS on port 8883 using X.509 device certificates and private keys.
- **Azure IoT Hub**: Connects via MQTT over TLS with device connection strings or SAS tokens.
- **HTTP Webhook Ingestion**: Ingest single or batch telemetry points via `POST /api/iot/telemetry` with API key authentication (`x-iot-api-key`). The webhook is off until `IOT_WEBHOOK_API_KEY` is set, and the key writes to exactly one workspace — `IOT_WORKSPACE_ID`, or the demo workspace by default. Only that workspace's admins can see the key in the app.
- **Device-to-Twin Resolution**: Matches incoming devices by explicit IRI (`dtwin:...`), device label, hardware serial number (`propsJson.deviceId`), or configurable custom mapping tables.
- **Automated Anomaly Detection**: Live telemetry ingestion re-runs the deterministic insight rules, so a cold-chain reading outside the 2–6 °C band raises an excursion finding.

Point Ontos only at a broker you control, over TLS, with authentication. Anyone who can
publish to a public test broker's topic can write into your twins.

#### Reading the graphs

Arrows run from subject to object, the way the triple reads: `Engineering —parentUnit→ Acme
Corp`, `Employee —is a→ Person`. Most structural predicates here point from child to
parent — `memberOf`, `reportsTo`, `parentUnit` — so in a force layout arrows converge on
the hubs. The Explorer's **Hierarchy** layout places every node below everything it points
to, so parents sit above their children and arrows point up. In the Studio, subclass edges
use the UML generalization mark — a hollow triangle at the parent, labelled "is a", dashed
when inferred — to set them apart from property arrows.

---

## API surface

The web app talks to the server over tRPC at `/api/trpc/*` — see `api/router.ts` for the
full router tree. Other systems use the [Ontology API](#ontology-api) at `/api/v1`. Three
more plain HTTP routes exist alongside them:

| Route | Auth | Description |
|---|---|---|
| `/api/v1/*` | API token; session for reads | The public Ontology API: objects by type, action submissions, OpenAPI document, TypeScript client |
| `GET /health`, `GET /api/health` | none | Liveness: database and semantic engine status |
| `POST /api/sparql` | session | Read-only SPARQL 1.1 query against the loaded graph |
| `POST /api/iot/telemetry` | `x-iot-api-key` | IoT telemetry ingestion into the key's workspace; off until a key is set |

`/api/sparql` accepts `application/sparql-query`, `application/json` (`{"query": "..."}`)
or a form body, and responds in SPARQL 1.1 JSON Results format. It requires a valid
session cookie, is limited to 30 queries per minute per user, caps queries at 10,000
characters, and accepts only the four SPARQL query forms — `SELECT`, `ASK`, `CONSTRUCT`
and `DESCRIBE`. Update forms are rejected with a 400.

Before executing, the endpoint syncs the caller's workspace into the engine so queries
always answer from current data. Pass `x-auto-sync: false` to skip that re-sync when the
engine already holds your workspace (e.g. multiple queries in one batch). If it holds
anything else, the endpoint syncs anyway: a skipped sync can return data as old as the
last sync, but never another workspace's.

### Ontology API

`/api/v1` is the contract other systems bind to. It is generated from the workspace's
ontology: every object type gets a list and a get, every active action type a preview and
a submit. Reads return objects by type; writes go only through action types, so every
change is checked, recorded and audited like one made in the app. The **Developers** page
creates tokens, shows the endpoints, and downloads the client.

| Endpoint | Scope | Description |
|---|---|---|
| `GET /ontology` | read | Modules, object types with their properties and links (inherited ones included), action types |
| `GET /openapi.json` | read | The OpenAPI 3.1 document for this ontology |
| `GET /sdk.ts` | read | A TypeScript client for this ontology: one file, no dependencies |
| `GET /objects/{prefix}/{Type}` | read | Objects of a type and its subclasses: `limit` (1–200), `cursor`, `q`, `filter[property]=value` |
| `GET /objects/{prefix}/{Type}/{id}` | read | The object `{prefix}:{Type}/{id}`, if it is of that type |
| `GET /objects?iri=…` | read | Any object by its IRI |
| `GET /actions` | read | Action types, with whether this token may submit each |
| `POST /actions/{key}/preview` | actions | Every change a submission would make, and every reason it would be refused |
| `POST /actions/{key}/submit` | actions | Applies the action, or records why not: a rejection is an answer, not an error |
| `GET /submissions/{id}` | read | One submission |

**Tokens.** Send `Authorization: Bearer ontos_…`. A token belongs to one workspace and
carries a role, scopes (`read`, `actions`), an optional module scope and an optional expiry.
It never acts above what its creator may do there now: the lower role wins, module scopes
narrow each other, and a creator who loses access takes their tokens with them. As for
members, a module scope limits which action types a token may submit; reads cover the
workspace. Only a SHA-256 hash is stored; the token itself is shown once, when it is
created. A signed-in
session may use the read endpoints, which is how the Developers page reads them; writes
need a token.

**Answers.** Every response carries `x-ontos-ontology-version`, and the client warns once
when it differs from the version the client was generated from. Errors are JSON,
`{ "error": { "code", "message", "problems"? } }`, with a status that says what to do:
400 fix the request, 401 get a valid token, 403 this token or role may not, 404 no such
thing, 409 the objects changed meanwhile (submit again), 429 slow down (`retry-after`),
503 retry shortly. A token that could not be checked, because the database is away, is
answered 503, never 401. Each token may make 300 requests a minute.

```ts
import { OntosClient } from "./ontos-client"; // from GET /api/v1/sdk.ts

const ontos = new OntosClient({ baseUrl: "https://ontos.example.com", token: process.env.ONTOS_TOKEN! });
for await (const person of ontos.iterate("hr:Person")) console.log(person.label);
const result = await ontos.actions.submit("renew-contract", { contract: "lgl:Contract/C-0042", newEndDate: "2027-06-30" });
```

---

## Security

- HS256 session JWTs with issuer pinning, a unique JTI, and a 7-day expiry.
- Session cookie is `HttpOnly` and `SameSite=Strict`. In production on a real hostname it
  uses the `__Host-` prefix, which forces `Secure` and host-only scope; on `localhost` it
  falls back to a plain name without `Secure`, so the stack works over plain HTTP locally.
- Production refuses persona login unless `ALLOW_DEMO_LOGIN=true`, and logs a warning at
  startup when it is on.
- Containers run as non-root users; the engine's filesystem is read-only. `.env` files are
  excluded from the Docker build context, so secrets never land in an image layer.
- Passwords hashed with `node:crypto` scrypt, 128-bit salts, constant-time verification.
- `secureHeaders` (HSTS, `X-Frame-Options: DENY`, `nosniff`), explicit-origin CORS, CSRF
  origin checks on mutations, and a 2 MB body limit.
- Sliding-window rate limits on auth (10 / 15 min; a sign-in the server could not decide,
  its database unreachable, does not count), NLQ (30 / min), SPARQL (30 / min) and graph
  scans (10 / min).
- Signing out needs no database: it clears the session cookie even while the session
  cannot be checked.
- NLQ input is capped at 500 characters and screened for destructive or injection intent.
- `/api/sparql` sits outside tRPC, so it performs its own session check and is gated to
  read-only query forms (`api/lib/sparqlGuard.ts`).
- User records are projected through an allowlist before leaving the server, so
  `passwordHash` is never serialized to a client.

---

## Testing

```bash
cd app
npm test
```

The suite covers password hashing, login lockout, session-token tampering and expiry,
cookie options, the SPARQL read-only gate, the client-safe user projection, NLQ
sanitization, RDF serialization, explainable SHACL, all twelve insight rules, IoT
ingestion, DTDL v3 export, workspace isolation, the semantic-engine lock, and the
client-side graph analytics. The `semanticEngine.test.ts` cases are **live integration
tests**: they start the engine daemon themselves from the local binary, so they need the
binary in place (see [Semantic engine](#semantic-engine)) but not a daemon already running.

Router tests call tRPC procedures with a mock context and a mocked or in-memory database,
and `bootRoutes.test.ts` does the same for the plain HTTP routes. They check permissions,
workspace scoping and responses. A few React components have render tests; pages do not.

CI has no `app/.env`. To run the suite as CI does, point dotenv at a missing file:
`DOTENV_CONFIG_PATH=does-not-exist.env npm test`.

### On a real MySQL

The in-memory database imitates SQL: it has no row locks, no clock of its own, and it
refuses `GROUP BY`. `npm run test:mysql` runs `api/**/*.mysql.test.ts` against a MySQL 8.4
server instead, and checks what only a real one can:

- the migrations build the database `db/schema.ts` describes (its tables, columns with their
  defaults and on-update and generated clauses, indexes, foreign keys and CHECK constraints)
  and run again as a no-op;
- workers claiming at once, on a table that holds a history of finished jobs, neither
  deadlock nor take the same job, and a claim passes over a job another transaction holds;
  leases are set and run out on the database's clock; and a worker that lost its lease
  cannot write over the one that took the job;
- the routes that group and count return only the caller's workspace's rows, and saving a
  mapping unchanged is not taken for a conflict.

`ONTOS_TEST_DATABASE_URL` names the server, without a database. Each run creates a
database of its own there, `ontos_test_<pid>_<time>`, empties it between tests and drops it
at the end, so two runs can share a server; they refuse to empty any other database. A run
killed before it ends leaves its database behind, to drop by hand. Run them against a
server whose sessions are off UTC, so a time taken from the app's clock where the
database's belongs shows: start it with `TZ=PKT-5` (five hours ahead of UTC) and set
`ONTOS_TEST_SESSION_TIME_ZONE=+05:00`, which setup checks, changing nothing on the server.
CI does both. A throwaway server will do:

```bash
docker run -d --name ontos-test-mysql -e MYSQL_ROOT_PASSWORD=test -e TZ=PKT-5 -p 127.0.0.1:33306:3306 mysql:8.4
ONTOS_TEST_DATABASE_URL=mysql://root:test@127.0.0.1:33306 ONTOS_TEST_SESSION_TIME_ZONE=+05:00 npm run test:mysql
docker rm -f ontos-test-mysql
```

CI runs them in a job of their own against the MySQL image `compose.yaml` pins. The same
job fails if `drizzle-kit generate` would write a migration, which catches a change to
`schema.ts` committed without one, and `migrationHistory.test.ts` (in `npm test`) keeps the
migration history in order and append-only: drizzle skips, on a database already migrated,
a migration dated before the last it applied, and never runs an edited one again. The Docker
job still boots the full stack and smoke-tests login, the seeded graph and an import run by
the worker.

---

## Production

The Docker stack is production-shaped: `NODE_ENV=production`, required secrets enforced,
persona login off, a healthchecked app container, and every image pinned by digest. Put it
behind a TLS-terminating proxy for anything beyond localhost — the session cookie switches
to `__Host-` with `Secure` once the host is not `localhost`, so it needs HTTPS.

To run the build without Docker:

```bash
cd app
npm run build && npm run build:db
npm run db:bootstrap
NODE_ENV=production node dist/boot.js
```

`npm run build` emits `dist/public/` (static client assets) and `dist/boot.js` (bundled
Node server), and the server serves both. Everything is bundled, so `dist/` plus
`db/migrations/` is all a deployment needs — no `node_modules`.

MySQL must keep row-based binary logging, its default (`binlog_format` `ROW`, or `MIXED`).
A worker claims jobs at READ COMMITTED, which MySQL refuses under `STATEMENT`: every claim
would fail, and the worker would log `claim failed` without end.

---

## Known limitations

These are tracked, known behaviours rather than surprises:

- **Databases created with `db:push` predate the migration history.** The schema is now
  versioned from `0000_initial_schema`, but a database built earlier with `drizzle-kit
  push` already has the tables and no record of the migration, so `db:bootstrap` will fail
  on it. Start that database fresh, or record `0000` as applied in `__drizzle_migrations`.
- **The login page shows persona buttons even when persona login is off.** Clicking one
  returns a clear error naming `ALLOW_DEMO_LOGIN`, but the buttons should be hidden.
- **SHACL validation is unavailable when the engine is offline.**
  `ontology.validateShacl` returns `conforms: null` with `engineOffline: true`
  when the semantic engine is down. An import whose mapping warns (the default) commits
  with no SHACL report, and its audit entry says why. An import whose mapping blocks is
  retried within its job's three attempts, a few seconds apart. It then fails, and can be
  run again once the engine is back. If the engine answers that it cannot check the import
  at all (data it cannot parse, shapes it cannot read), the import fails at once, with the
  engine's reason. Callers should check `engineOffline` and `conforms !== null` before
  trusting the result.
- **Pre-commit SHACL checks warn by default.** The check sees what the import will write:
  the rows, each value typed as its property's declared range, and the links the rows make.
  Results on the import's own rows are recorded in the audit entry and surfaced as a
  warning, and the import goes ahead. A mapping set to **block on SHACL violations** imports
  nothing when its rows break the class's shapes with a Violation (a Warning or Info is
  recorded, not refused). It records the refusal in the audit log and fails the sync with
  the reasons. Each attempt decides for itself: a refusal does not undo rows an earlier
  attempt wrote after passing the check, before its worker died.
- **A later import replaces what an action changed.** A CSV import writes the properties of
  the objects it maps, so an import after an action overwrites that action's edits to the
  same object. The object's provenance then shows the import, not the action.
- **An action checked against SHACL is refused while the engine is offline**, rather than
  applied unchecked.
- **Connector credentials are sealed in the database, not held in a vault.** SQL and broker
  passwords and client keys are encrypted with AES-256-GCM, each bound to its workspace,
  field and endpoint, and opened only when the server connects; they are never sent to a
  client. A sealed value copied onto another connector, or a row whose host is changed in
  the database, opens nothing. The key comes from `SECRETS_KEY`, or from `APP_SECRET` when
  that is unset, and lives with the server, so anyone who holds both the database and the
  key can read them. Setting `SECRETS_KEY` later, or rotating it with `SECRETS_KEY_PREVIOUS`,
  loses nothing: the bootstrap re-seals under the new key, and seals any credential an
  earlier build stored as plain text. A credential sealed under a key the server no longer
  has cannot be read: the server says so, a workspace admin enters a SQL connector's
  password again with **Update password**, and a broker connector is deleted and added
  again. A build from before sealing would send sealed values as passwords, so do not roll
  back past it without restoring a database backup from before the upgrade. TLS to a SQL
  source checks the server's certificate against the system's trusted authorities, so a
  server with a self-signed certificate is refused.
- **Webhook addresses are checked when the job runs.** A host whose DNS answer changes
  between that check and the request is not caught.
- **Some state still lives in the API process.** Background jobs are safe to spread
  across workers, but a second API process would hold its own login and query rate
  limits, need its own semantic engine, and open its own MQTT broker connections, so
  broker telemetry would be ingested twice. Run one API process until those move out.
- **The triple store holds one graph at a time, so engine work takes turns.** The
  Oxigraph engine is not partitioned per workspace: reasoning, SHACL validation, CSV
  import and SPARQL each clear the store and load what they need. The app runs those
  sequences one at a time under a lock, so they no longer interfere, but a slow
  reasoning run delays the next query. The lock lives in the process, so several app
  replicas must not share one engine. Replicas of the worker do share `engine-worker` in
  `compose.yaml`. An import whose SHACL report was taken on another replica's graph is
  treated as unchecked (its mapping, if set to block, retries), but the other engine work
  of concurrent imports is not yet kept apart. Run one worker per engine until it is.
- **A development bootstrap path exists for credential login.** Passwords are verified with
  constant-time scrypt against `users.passwordHash`, but outside production an account that
  has no hash yet will accept a known fixed bootstrap password and be upgraded to a real
  hash on first use. Production rejects those accounts outright. Demo personas are excluded
  entirely: they never hold a password.
- **The app port binds every network interface.** `ONTOS_PORT` publishes on all of the
  host's addresses. For a machine-local demo, change the mapping in `compose.yaml` to
  `127.0.0.1:3000:3000`.
- **Rotating `ADMIN_PASSWORD` does not revoke existing admin sessions.** Session tokens stay
  valid until they expire, up to seven days. Persona sessions, by contrast, end as soon as
  persona login is switched off.
- **Compose interpolates `$` in `.env` values.** A secret containing `$` is silently
  altered. Generate secrets as hex, as `.env.example` suggests.
- **A first-boot seed that dies partway needs a manual reset.** Once audit entries exist,
  the bootstrap refuses to reseed rather than risk wiping real data, logs why, and carries
  on. Run `docker compose down -v` to start clean.
- The largest client bundles are the vendor chunks: Three.js at ~890 kB (~240 kB gzipped)
  for the landing page's 3D graph, and Cytoscape and React at ~560 kB each.

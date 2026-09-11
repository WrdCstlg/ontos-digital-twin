# Ontos

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
- **Data mapping** — CSV → ontology class/property mapping with pre-commit SHACL checks.
- **Natural language query** — pattern-based, ontology-grounded NL → SQL translation that
  always shows the generated query and refuses write or unsafe intents.
- **RBAC + audit** — five roles, per-route authorization, SHA-256 hash-linked audit log.

---

## Architecture

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
`@hono/vite-dev-server` — a single process on port 3000. In production, `dist/boot.js`
serves both the API and the static client bundle.

---

## Prerequisites

- **Node.js 20+** (developed against 24.x)
- **MySQL 8+** reachable via `DATABASE_URL`
- **open-ontologies** binary — required for reasoning, SHACL and SPARQL. Not vendored in
  this repository; see [Semantic engine](#semantic-engine).

---

## Quick start

```bash
cd app
npm install

cp .env.example .env      # then edit — APP_SECRET and DATABASE_URL are required

npm run db:push           # create the schema in MySQL
npx tsx db/seed.ts        # seed ontology modules + knowledge graph
npx tsx db/seed-twins.ts  # seed digital twins + telemetry

npm run dev               # http://localhost:3000
```

On the login screen, pick any of the four demo personas — no password required. They are
created on first use.

| Role | Persona | Email |
|---|---|---|
| `admin` | Elena Cortez | admin@acme-ontology.com |
| `ontologist` | Dr. James Wei | ontologist@acme-ontology.com |
| `editor` | Priya Sharma | editor@acme-ontology.com |
| `viewer` | Alex Morgan | viewer@acme-ontology.com |

The account matching `ADMIN_EMAIL` is automatically promoted to `admin`.

---

## Environment variables

Copy `app/.env.example` to `app/.env`. Only `APP_SECRET` and `DATABASE_URL` have no usable
default.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `APP_SECRET` | **yes** | — | HS256 signing key for session JWTs. Use 32+ random chars. |
| `DATABASE_URL` | **yes** | — | MySQL connection string, e.g. `mysql://root:@localhost:3306/ontos` |
| `APP_ID` | no | `ontos` | Application identifier |
| `ADMIN_EMAIL` | no | — | This address is auto-promoted to the `admin` role |
| `PORT` | no | `3000` | Production HTTP port |
| `NODE_ENV` | no | — | Set to `production` to enable static serving and strict cookies |
| `ALLOWED_ORIGINS` | in prod | — | Comma-separated CORS/CSRF origin allowlist. **Production rejects every cross-origin request if unset.** Localhost is allowed automatically outside production. |
| `OPEN_ONTOLOGIES_URL` | no | `http://127.0.0.1:8085` | Semantic engine base URL |
| `OPEN_ONTOLOGIES_PORT` | no | `8085` | Port used when auto-starting the engine |
| `OPEN_ONTOLOGIES_TOKEN` | no | — | Bearer token, if the engine requires one |
| `OPEN_ONTOLOGIES_BIN` | no | — | Explicit path to the engine binary |
| `VITE_APP_ID` | no | — | Application identifier exposed to the browser |

---

## Semantic engine

Reasoning, SHACL validation and SPARQL are delegated to **open-ontologies**, a standalone
binary that runs an in-memory Oxigraph triple store behind an HTTP API.

**The binary is not committed to this repository** (`bin/` and `*.exe` are gitignored, as
it is ~38 MB). Supply it yourself and place it at either:

```
bin/open-ontologies          # repo root  (bin/open-ontologies.exe on Windows)
app/bin/open-ontologies
```

or point `OPEN_ONTOLOGIES_BIN` at it. The server resolves these paths at startup and will
spawn the daemon on demand:

```bash
open-ontologies daemon start --host 127.0.0.1 --port 8085
open-ontologies daemon status
```

Engine state is confirmed by the health endpoint:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"connected","semanticEngine":{"status":"connected","version":"1.3.0",...}}
```

**Without the engine**, the app still runs. Reasoning falls back to a deterministic
in-process subclass walker, and SHACL validation is skipped — see
[Known limitations](#known-limitations) for how that is reported. Note that the semantic
engine integration tests require a live engine and will fail without it.

---

## Scripts

Run from `app/`.

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server + API on port 3000 |
| `npm run build` | Production build → `dist/public` (client) and `dist/boot.js` (server) |
| `npm start` | Serve the production build |
| `npm run check` | TypeScript project build (`tsc -b`) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | Vitest suite |
| `npm run db:push` | Push the Drizzle schema straight to MySQL |
| `npm run db:generate` | Generate a SQL migration into `db/migrations` |
| `npm run db:migrate` | Apply pending migrations |

`npm start` is written for a POSIX shell. On Windows, run the equivalent directly:

```powershell
$env:NODE_ENV = "production"; node dist/boot.js
```

---

## Project structure

```
app/
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
│   ├── migrations/          Generated SQL migrations
│   ├── seed.ts              Ontology + knowledge graph seed
│   └── seed-twins.ts        Digital twin + telemetry seed
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

### Roles

`viewer` → `editor` → `ontologist` → `admin`, enforced by tRPC procedure builders in
`api/middleware.ts`. A legacy `user` role remains the schema default and carries no
elevated access.

- `authedQuery` / `authedMutation` — any signed-in user
- `ontologistQuery` / `ontologistMutation` — `ontologist`, `editor` or `admin`
- `adminQuery` / `adminMutation` — `admin` only
- `publicQuery` — unauthenticated entry points only (`ping`, `auth.login`, `auth.demoLogin`)

### Digital twins

Twins are `kgNodes` with `moduleKey = "twin"` and a `dtwin:` class IRI. Telemetry is
appended to the `twinStateLog` time-series table. `twinRouter.ts` exports Azure DTDL v3
JSON. Twin types: `WarehouseTwin`, `ZoneTwin`, `ShipmentTwin`, `SensorTwin`.

---

## API surface

Everything is exposed over tRPC at `/api/trpc/*` — see `api/router.ts` for the full
router tree. Three plain HTTP routes exist alongside it:

| Route | Auth | Description |
|---|---|---|
| `GET /health`, `GET /api/health` | none | Liveness: database and semantic engine status |
| `POST /api/sparql` | **none** | SPARQL 1.1 query against the loaded graph |

`/api/sparql` accepts `application/sparql-query`, `application/json` (`{"query": "..."}`)
or a form body, and responds in SPARQL 1.1 JSON Results format.

---

## Security

- HS256 session JWTs with issuer pinning, a unique JTI, and a 7-day expiry.
- Session cookie is `HttpOnly`, `SameSite=Strict` and partitioned; in production it uses
  the `__Host-` prefix, which forces `Secure` and host-only scope.
- Passwords hashed with `node:crypto` scrypt, 128-bit salts, constant-time verification.
- `secureHeaders` (HSTS, `X-Frame-Options: DENY`, `nosniff`), explicit-origin CORS, CSRF
  origin checks on mutations, and a 2 MB body limit.
- Sliding-window rate limits on auth (10 / 15 min), NLQ (30 / min) and graph scans
  (10 / min).
- NLQ input is capped at 500 characters and screened for destructive or injection intent.

---

## Testing

```bash
cd app
npm test
```

The suite covers password hashing, rate-limiter windows, token verification, cookie
options, NLQ sanitization, RDF serialization, and explainable SHACL. The
`semanticEngine.test.ts` cases are **live integration tests** — they require a running
open-ontologies daemon and will fail without one.

Router-level and frontend tests do not exist yet.

---

## Production

```bash
cd app
npm run build
NODE_ENV=production ALLOWED_ORIGINS=https://your-host node dist/boot.js
```

`npm run build` emits `dist/public/` (static client assets) and `dist/boot.js` (bundled
Node server). The server serves both.

Set `ALLOWED_ORIGINS` — production CORS and CSRF both deny anything not listed.

---

## Known limitations

These are tracked, known behaviours rather than surprises:

- **`POST /api/sparql` is unauthenticated.** It is registered ahead of the tRPC handler and
  therefore bypasses the RBAC layer that guards every other route, and it is not rate
  limited. Do not expose the server to an untrusted network until this endpoint is gated.
- **`auth.me`, `auth.login` and `auth.demoLogin` return the full user row**, including
  `passwordHash`. These responses should be projected down to safe fields.
- **No migrations have been generated.** `db/migrations/` is empty and the schema is only
  applied via `drizzle-kit push`, so there is no versioned history and no upgrade path for
  an existing database. Run `npm run db:generate` before the first real deployment.
- **SHACL validation fails open.** When the semantic engine is offline,
  `ontology.validateShacl` returns `conforms: true` with an explanatory `message`, and
  `mapping.runSync` commits with no SHACL report at all. Check `message` and the presence
  of `shaclReport`, not just `conforms`.
- **Pre-commit SHACL checks are advisory.** Violations are recorded in the audit entry and
  surfaced as a warning, but they do not block a sync.
- **The triple store is global and unscoped.** Each operation clears and reloads the shared
  Oxigraph store, so concurrent reasoning or validation runs will interfere with one
  another. It is not partitioned per workspace.
- **A development bootstrap path exists for credential login.** Passwords are verified with
  constant-time scrypt against `users.passwordHash`, but outside production an account that
  has no hash yet will accept a known fixed bootstrap password and be upgraded to a real
  hash on first use. Production rejects those accounts outright.
- The main client chunk is ~1.3 MB (~415 kB gzipped); the 3D hero graph is lazily loaded.

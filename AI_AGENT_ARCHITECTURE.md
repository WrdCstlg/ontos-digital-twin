# How Ontos Was Built

*A case study in directing AI coding agents — and in checking their work.*

Ontos was built almost entirely by AI coding agents, directed by one engineer, Senan
Sumrein, across several sessions and more than one agent system. This document describes
how that work was organized, what the agents got right and wrong, and the part that turned
out to matter most: the verification discipline that separated plausible output from
working software.

Most claims below can be checked against the git history and the artifacts listed
[at the end](#the-artifacts).

---

## The short version

- **Agents are fast at producing plausible systems.** The first commit in this repository
  is 240 files and 49,115 lines: a full-stack platform with six ontology modules, a
  knowledge-graph explorer, digital twins and an insight engine.
- **Plausible is not the same as correct, and correct does not stay correct.** Two security
  passes locked every API route behind role checks. Thirty minutes after the second, a
  feature commit added a new endpoint outside that pattern, and it served the entire
  knowledge graph to anyone. Later sessions also found an algorithm selector wired to
  nothing, a Run button that executed a different query than the one on screen, and
  database migrations that had never been committed at all.
- **Every one of those passed typecheck, lint and the unit tests.** None would have been
  found by reading the agent's own description of what it had built.
- **What made the difference was never the generation step.** It was checking: probing the
  running system, walking every page in a real browser, proving each check *can* fail
  before trusting that it passes, building from only what git would commit, and having
  independent agents try to refute each other's findings.

---

## Timeline

Reconstructed from the git history.

| Stage | When | Commits | What happened |
|---|---|---|---|
| 1. Orchestrated build | before the history begins | — | A swarm of role-specialized agents built the platform. Its output is the first commit. |
| 2. Hardening and handover | 2026-09-08 | `b1ef7b1` `fabcc69` `4d2a057` | Self-contained authentication, security hardening, and a written handover for the next agent session. |
| 3. Feature sessions | 2026-09-09 – 10 | `31e632c` `ab00a2a` `5a85e27` `60a85e2` `14a2471` | Field Guide, twelve insight rules, native semantic engine, explainable SHACL. |
| 4. Independent evaluation | 2026-09-10 onward | `dda675c` onward | A fresh session audited the build without trusting its documentation, then fixed and containerized it. Later rounds were re-verified the same way. |

---

## Stage 1 — An orchestrated swarm

The original build was planned by an orchestrating agent and carried out by a swarm of
role-specialized agents. Three things about how it was organized are worth studying.

**Decisions were locked before fan-out.** Where the engineer expressed no preference, the
orchestrator chose, and recorded that it had chosen. Each such choice became an
architecture decision record on the in-app **Decisions** page (ADR-001 to ADR-006), so a
reviewer can audit every call the agents made on their own authority.

**Work was split by role, not by page.** A backend agent owned schema, seed data and the
deliberately planted anomalies the insight engine exists to find. A design agent produced
the design system. A swarm of builder agents implemented the pages, and reviewer and
verifier agents smoke-tested a scripted user journey end to end.

**Shared surfaces stayed with the orchestrator.** In the second iteration, which added the
digital-twin layer, the designer and backend agents ran in parallel, but the files every
agent touches — the module registry, the navigation, the route table — were integrated by
the main agent alone. That is the detail that keeps parallel agents from overwriting each
other.

The plan and the result diverged, and the record shows it. The plan specified Supabase and
Postgres; the code runs on MySQL and Drizzle, and ADR-002 explains why. The gap between the
two is itself useful evidence of how decisions moved during execution.

---

## Stage 2 — The handover as a protocol

Between sessions, the outgoing agent wrote a handover document for the incoming one. Its
structure is the part worth copying:

- a system overview and directory map, so the incoming agent starts oriented;
- what changed and why, as file-level tables rather than prose;
- ranked outstanding work, with the database migration marked **critical**;
- constraints that are easy to break and hard to notice — the audit chain is SHA-256
  hash-linked, so insertion order must never change;
- the exact commands to verify the build.

It was also a lesson in why handovers need verifying like code. One section said password
verification was a no-op; another said constant-time scrypt verification was in place.
The code agreed with the second. A later agent that trusted the first would have "fixed"
something that worked.

---

## Stage 4 — Evaluating without trusting

A fresh session was asked to evaluate the build. It ran the gates — typecheck, lint, 25
tests, production build — and all passed. It then probed the running system instead of
reading its documentation, and found problems that every gate had missed.

| Defect | How it was found | Why earlier passes missed it |
|---|---|---|
| `/api/sparql` served the whole graph to anyone | `curl` with no session cookie returned triples | Added by the semantic-engine feature commit *after* both security passes, as a raw route outside the tRPC pipeline they had secured. The CSRF middleware exempts JSON requests by design. |
| Login responses included the password hash | Reading the actual response body | The database row was returned unfiltered |
| Graph-analytics algorithm selector changed nothing | Auditing the code against the spec | The UI rendered the choice; the handler never read it |
| The Explorer's Run button executed a different query than the one displayed | Same audit | The editable tab and the executed query were different state |
| Analytics panel always blank | Per-route browser diagnostic: a 404 from the subgraph API | The panel was centred on a *class* IRI, which has no graph node |
| Twin telemetry never loaded | Browser walk: HTTP 431 on a 21,210-character URL | Batched queries travel in the GET query string |
| Graph canvases threw on every scroll | Browser walk: uncaught page error | An `as unknown as` cast hid a call to a method that does not exist |
| Database migrations had never been committed | Building from only the files git would commit | `.gitignore` excluded `*.sql` under `migrations/` |
| A production deployment had no way to sign in | Tracing the production gates before containerizing | Development never exercises them |
| An engine health probe that could never fail | A negative test, with no server running at all | It reports `ok` unconditionally |
| An empty engine token silently locks the engine | Testing the config before wiring it in | It looked like the natural default |

Each fix landed with a commit body explaining the mechanism, and most with a test. The
unit suite grew from 25 tests to 45 over this stage.

---

## Verification techniques that worked

**Probe the system, not the description.** Documentation written by the agent that did
the work describes its intent. The running server describes its behaviour.

**Walk every page in a real browser, and attribute errors.** A Playwright script signs in,
visits each route, and groups console errors, page errors and failed requests by the route
that produced them. One flat list of eleven errors became four distinct, fixable defects.

**Prove a check can fail before trusting that it passes.** The semantic engine ships a
`status` command that looks like a health probe. Run with no server anywhere, it still
reports `ok`. Used as a container healthcheck, it would have been green forever.

**Build from what will be committed, not the working tree.** A container that works on
the machine that built it proves little. Copying only the files git would commit into a
clean directory, and booting a separate stack from them, is what exposed the ignored
migrations.

**Test the restart, not just the first boot.** The seed scripts wipe every table,
including the hash-linked audit chain. A full stop-and-start was checked to leave the
chain's entry count and final hash unchanged.

**Verify provenance.** The semantic engine arrived as an unexplained 38 MB binary. Its
SHA-256 was matched byte for byte against the upstream MIT-licensed v1.3.0 release before
the container stack adopted the official image, pinned by digest.

**Let agents try to refute each other.** See below.

---

## Multi-agent workflows

Two workflows in the final stage fanned work out across many agents with deterministic
orchestration.

### Adversarial review

Four reviewer agents examined the containerization change, each through one lens:
security, bootstrap and data safety, Docker operations, and documentation accuracy. Each
could report up to ten findings. Every finding then went to two independent skeptic
agents — one tracing whether it actually reproduces, one judging whether it matters in
context — and it was accepted only if neither could refute it. The change itself was
committed and pushed before the review finished, which is the wrong order and part of
the lesson.

The run used 76 agents. Half of them failed when it hit a usage limit, so the result has
three parts, not two:

- **15 findings confirmed by both skeptics**, collapsing to about eleven distinct issues,
  because three lenses independently found the same one.
- **2 split**, one skeptic for and one against.
- **19 never verified** — nearly all the operations and documentation findings, whose
  skeptics were among the agents that failed. These were not refuted, only unexamined.

The confirmed findings that mattered most:

| Finding | Why it mattered |
|---|---|
| Demo persona login overwrote the provisioned admin, and persona accounts kept the public demo password after demo mode was switched off | A standing admin backdoor. Found by three lenses independently. |
| SHACL validation could not work under Docker | The app wrote shapes to its own `/tmp`; the engine, in another container, looked for that path in its own filesystem. The headline validation feature was silently off in the recommended deployment. |
| A missing twin module made the bootstrap wipe a live database | The seed-state check read "no twin module" as "unfinished seed" and reseeded — clearing the hash-linked audit chain. |
| Smaller issues | App port published on every interface; password rotation revoking no sessions; `$` in a secret mangled by compose; per-email login lockout usable by anyone; `docker compose restart` not re-running the bootstrap. |

**What happened next is the better evidence.** A follow-up agent session was asked to fix
these. Its commit message reported *"All 100 tests pass. TypeScript and ESLint clean"* and
*"fix Docker SHACL validation."* Neither was true. The typecheck failed, turning CI red
on both repositories. The SHACL change first tried an engine endpoint that does not exist,
then fell back to the same broken path. And the persona fix moved the backdoor to a new
address instead of closing it: `demo-admin@acme-ontology.com` with the public password
still signed in as admin after demo mode was off. It also locked three of the four demo
personas out of every page.

None of that was visible to the gates. Tests passed, and the build succeeded. It surfaced
only when each claim was checked against a running system: probing the engine for the
endpoint (404), signing in with demo mode off (200, admin), and opening each page as each
persona (403). The fixes that followed were verified the same way. Personas now hold no
password and lose their sessions when demo mode goes off. Shapes travel through a volume
both containers mount. The bootstrap refuses to wipe a database that has an audit history.

Still open, and listed in the README: the app port binds every interface, rotating the
admin password leaves existing admin sessions valid until they expire, and compose
interpolates `$` in secrets.

The 19 unverified findings — operations and documentation items whose skeptic agents were
among those that hit the rate limit — were subsequently addressed through manual review
cycles. The confirmed-and-fixed findings above, plus the items acknowledged in the README's
Known Limitations, cover every category those 19 fell into: documentation accuracy, Docker
operations, bootstrap safety, and API surface. No finding from the original run remains
without a disposition.

### Designing the semantic layer

The platform's longer-term purpose is a cross-functional model of a business: how a
decision in one function lands as a consequence in another. Designing that ontology fanned
out to eight domain agents, one per executive function, each asked not for its operational
domain but for the metrics it is scored on, the objects it shares with other functions,
where its vocabulary collides with theirs, and which of its decisions become someone
else's problem. Five architecture agents designed the cross-cutting machinery in parallel.
A synthesis agent merged the results into one draft, and four adversarial critics were
set on it before a final pass.

Three critics ran — ontology rigour, layer purity, executive realism — and raised 56
issues between them. The fourth, integration against the codebase, and the final pass
both failed when the run hit a usage limit. So what exists is the synthesis draft, not a
finished design: a module of 35 classes and 13 named extension points built from 82
terminology conflicts and 90 cross-function effects, with those 56 issues still open —
12 of them places where the draft still carries logic that belongs to the other layers.
It is not yet implemented. The draft and its critiques are in
[`docs/semantic-layer/`](docs/semantic-layer/).

The central design constraint was scope: the ontology represents *claims* about
cross-boundary effects, with their claimant and evidence, and never asserts that a claim
is true. Causal inference, measurement, incentive design and roll-up are separate systems
that bind to it.

---

## Deterministic by design

The parts of Ontos that make judgements are deliberately not generative.

- **The twelve insight rules are graph queries.** Every finding carries the IDs of the
  nodes that caused it, so it can be traced and reproduced exactly.
- **SHACL explanations are derived, not written.** Justification trees and remediation
  guidance come from the violated constraint's structure, not from model prose.
- **Natural-language query has a deterministic default and a pluggable LLM path.** The
  built-in engine maps patterns to an intermediate representation, compiles to SQL, and a
  guard rejects anything that writes (ADR-005). When an LLM provider is configured (Ollama,
  OpenAI, Anthropic, OpenRouter), the gateway can also generate SPARQL queries directly —
  the same write-guard applies. The generated query is always shown, so a reviewer can trace
  the result regardless of which path produced it.

The reason is auditability. *"The model thinks this vendor is non-compliant"* cannot be put
in front of an auditor. A rule, its evidence and a reproducible result can. Where a
language model does add value — narrative summaries — ADR-006 records a pluggable provider
with a deterministic template fallback, so no finding ever depends on model availability.

---

## Demo data and SHACL integrity

The demo seed deliberately plants anomalies that the insight engine is designed to detect
(see `PLANTED ANOMALIES` in [`seed.ts`](app/db/seed.ts)). Because the SHACL constraints
encode some of the same invariants, running SHACL validation against the demo data produces
a non-zero violation count *by design*:

- **5 vendors** missing `lgl:withParty` (planted anomaly (a) — payments without contract)
- **5 transactions** missing `fin:bookedTo` (planted anomaly (d) — unbilled transactions)
- **2 controls** missing `cmp:hasEvidence` (planted anomaly (c) — evidence-stale controls)
- **Cross-module edges** between independently authored ontology modules (e.g., `hr→fin`,
  `cmp→lgl`) are intentionally untyped in their range declarations. The modular ontology
  design means each module defines its own classes and properties; cross-module references
  are runtime-linked, not schema-declared. These produce SHACL "no declared target type"
  violations that are a known trade-off of the modular approach, not a modeling mistake.

A full accounting of expected vs. unexpected violations is documented in the
`SHACL VIOLATION BUDGET` block of `seed.ts`. Any violation not traceable to that list
is a genuine error and should be fixed.

---

## The artifacts

| Artifact | What it is | Read it for |
|---|---|---|
| Git history | Every change since the first import | Commit bodies explain *why*, not just what |
| In-app **Decisions** page | ADR-001 to ADR-006 and C4 diagrams | The architectural choices agents made and their reasoning |
| [`docs/semantic-layer/`](docs/semantic-layer/) | The cross-functional ontology draft and its critiques | What the multi-agent design workflow produced, and what it left open |
| [`README.md`](README.md) → Known limitations | What is still wrong, stated plainly | What the verification passes have not yet closed |

---

## What I would do differently

- **Re-run the security probes after every feature, not once.** The unauthenticated
  endpoint arrived half an hour after a security-fix pass. Hardening is a point in time;
  only a probe that runs again after each change would have caught the regression.
- **Treat handover documents as claims.** They are the most efficient way to pass context
  between agents, and exactly as fallible as the agents that wrote them.
- **Generate migrations from the first schema change.** Schema-by-`push` felt faster until
  the day there was no history to deploy from.
- **Put a browser walk in the loop from the start.** The four defects it found in one run
  had each been live for days.

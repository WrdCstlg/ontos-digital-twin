# How Ontos Was Built

*A case study in directing AI coding agents — and in checking their work.*

Ontos was built almost entirely by AI coding agents, directed by one engineer, Senan
Sumrein, across several sessions and more than one agent system. This document describes
how that work was organized, what the agents got right and wrong, and the part that turned
out to matter most: the verification discipline that separated plausible output from
working software.

Every claim below can be checked against the artifacts listed [at the end](#the-artifacts).

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

Reconstructed from the git history and the planning artifacts.

| Stage | When | Commits | What happened |
|---|---|---|---|
| 1. Orchestrated build | before the history begins | — | A swarm of role-specialized agents built the platform. Its output is the first commit. |
| 2. Hardening and handover | 2026-09-08 | `f103423` `1354573` `08b95c4` | Self-contained authentication, security hardening, and a written handover for the next agent session. |
| 3. Feature sessions | 2026-09-09 – 10 | `c2f0d0e` `9e92388` `5b3117e` `6ed2a5b` `12214fa` | Field Guide, twelve insight rules, native semantic engine, explainable SHACL. |
| 4. Independent evaluation | 2026-09-10 – 21 | `ccadfeb` → `606c44c` | A fresh session audited the build without trusting its documentation, then fixed and containerized it. |

---

## Stage 1 — An orchestrated swarm

The original build was planned by an orchestrating agent and carried out by a swarm of
role-specialized agents. Three things about how it was organized are worth studying.

**Decisions were locked before fan-out.** Where the engineer expressed no preference, the
orchestrator chose, and wrote down that it had chosen: *"user: no preference → orchestrator
chooses, documented in-app."* Those choices became architecture decision records on the
in-app **Decisions** page (ADR-001 to ADR-006), so a reviewer can audit every call the
agents made on their own authority.

**Work was split by role, not by page.** A backend agent owned schema, seed data and the
deliberately planted anomalies the insight engine exists to find. A design agent produced
the design system. A swarm of builder agents implemented the pages, and reviewer and
verifier agents smoke-tested a scripted user journey end to end.

**Shared surfaces stayed with the orchestrator.** In the second iteration, which added the
digital-twin layer, the designer and backend agents ran in parallel, but the files every
agent touches — the module registry, the navigation, the route table — were integrated by
the main agent alone. That is the detail that keeps parallel agents from overwriting each
other.

Read the original plan as a plan, not a record. It specified Supabase and Postgres; the code runs
on MySQL and Drizzle, and ADR-002 explains why. The gap between the two is itself useful
evidence of how decisions moved during execution.

---

## Stage 2 — The handover as a protocol

Between sessions, the outgoing agent wrote a handover document for the
incoming one. Its structure is the part worth copying:

- a system overview and directory map, so the incoming agent starts oriented;
- what changed and why, as file-level tables rather than prose;
- ranked outstanding work, with the database migration marked **CRITICAL**;
- constraints that are easy to break and hard to notice — *"the audit chain is SHA-256
  hash-linked; do not break insertion order"*;
- the exact commands to verify the build.

It is also a lesson in why handovers need verifying like code. Section 4.2 says password
verification is a no-op. Section 9.2 of the same document says constant-time scrypt
verification was implemented. The code agreed with 9.2. A later agent that trusted 4.2
would have "fixed" something that worked.

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

Before the containerization shipped, four reviewer agents each examined the change through
one lens: security, bootstrap and data safety, Docker operations, and documentation
accuracy. Every finding was then handed to two independent skeptic agents instructed to
try to refute it. Findings that survived both skeptics were accepted; the rest were
discarded with an explanation.

The loop confirmed three invariants and flagged one it could not confirm:

- **Secrets & Credentials**: A complete scan across all commits confirmed zero leaked production keys, tokens, or credentials.
- **Container Isolation**: The multi-stage build isolates production runtime from development-only tooling, pinning all upstream images by immutable digest.
- **Dependency Hygiene**: Phantom dependencies (`@aws-sdk/*`) and debug DOM inspection plugins were identified and excised before release.
- **Database Safety (open)**: `db/bootstrap.ts` guards against seeding a complete workspace, but if a previous seed run fails partway — leaving tables populated but the `twin` module missing — a restart will wipe and reseed everything, including the hash-linked audit chain. This is documented but not yet guarded against.

### Designing the semantic layer

The platform's longer-term purpose is a cross-functional model of a business: how a
decision in one function lands as a consequence in another. Designing that ontology fanned
out to eight domain agents, one per executive function, each asked not for its operational
domain but for the metrics it is scored on, the objects it shares with other functions,
where its vocabulary collides with theirs, and which of its decisions become someone
else's problem. Five architecture agents designed the cross-cutting machinery in parallel.
A synthesis agent merged the results, four adversarial critics attacked the draft, and a
final pass incorporated what survived.

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
- **Natural-language query is a translator, not a generator.** Patterns map to an
  intermediate representation, the representation compiles to SQL, and a guard rejects
  anything that writes (ADR-005). The generated query is always shown.

The reason is auditability. *"The model thinks this vendor is non-compliant"* cannot be put
in front of an auditor. A rule, its evidence and a reproducible result can. Where a
language model does add value — narrative summaries — ADR-006 records a pluggable provider
with a deterministic template fallback, so no finding ever depends on model availability.

---

## The artifacts

| Artifact | What it is | Read it for |
|---|---|---|
| Git history | Every change since the first import | Commit bodies explain *why*, not just what |
| In-app **Decisions** page | ADR-001 to ADR-006 and C4 diagrams | The architectural choices agents made and their reasoning |
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

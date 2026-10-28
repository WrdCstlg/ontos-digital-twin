# Feature Spec: Governed agents, cycle 1: governed data, and changes that a different person approves

**Date:** 2026-10-28
**Revision:** r4. Four independent reviewers covered protocol and honesty, code accuracy, security design, and tests and buildability. This draft was revised four times after their review. Appendix B states each review finding in a sentence and says where this revision answers it. The earlier drafts are not part of this record.
**Status:** PROPOSED. Nothing here is approved or built until the owner approves it. The refusal and acceptance tests in section 5 are fixed here, before implementation; changing them later needs the owner's approval.
**Author:** ENGINEER, fourth turn of cycle 1 of the Adversarial Persona Loop for governed agents (D-037, D-038; Appendix A).
**Code read:** the `feat/governed-agents` worktree, cut from `9d4b036` (D-037), on 2026-10-28. Every `file:line` below refers to that tree. Only read-only git commands were run (`git log`, `git status`, `git diff --stat`). No test, build, server, engine or container was run.

> **Notice.** The procurement scenario is invented. That covers the manufacturer, its head of procurement operations, its CIO and its chief information security officer, the three team members named in Turn 2, Tamsin Ridge Castings and its two agreements, the 140 renewals and the 61 already keyed, the four percent increase, the eleven working days, the $186,000 payment and last year's audit finding. It also covers the company facts VETO states as its own in Turn 3: "our SOC 2 Type II report", "our information security policy adopts the OWASP Top 10", "inside our SOX boundary", "our open audit finding" and "our Sarbanes-Oxley Section 404 assessment". The persona turns are generated dialogue, not statements by any person.
>
> The legal, regulatory and standards references in VETO's turn, and in ENGINEER's account of it, are the VETO persona's concerns, not legal statements: Sarbanes-Oxley Section 404, the COSO 2013 framework and its Principle 10, SOC 2 CC6.3 and CC8.1, and the OWASP Top 10 for LLM Applications 2025 with LLM01 and LLM06. No rule here makes a legal or compliance determination. VETO's notes, as relayed to ENGINEER, say the SOC 2 and COSO wordings were confirmed only from secondary sources, the SOX 404 point is from memory, and the two OWASP items were read at the source. ENGINEER re-checked none of them. Marking them UNVERIFIED as quoted is ENGINEER's under-claim.
>
> ENGINEER's own technical references are not VETO's concerns: RFC 4180 (CSV), the Unicode general categories and the Unicode Script property (4.12), and ISO 8601 (4.2).

---

## 1. Persona instantiation (approved, D-038)

D-038 is in `docs/DECISIONS.md` (`:648-669`). D-037 to D-039 land in the same pull request as this spec. Its *Decided* item and its approval line, verbatim:

> - **Decided:** cycle 1 of governed agents runs with a persona set of its own, beside the one
>   D-016 approved for `xfn`:
>   - **BUILDER:** the repository owner, by role (as D-016).
>   - **USER:** the head of procurement operations at a mid-size manufacturer (invented), with
>     140 supplier contracts up for renewal this quarter and a team of three keying renewals and
>     vendor changes by hand from email, told by the CIO to use AI. The tool fails them if an
>     agent renews the wrong contract or changes a supplier's bank details, and the SOX auditor
>     finds the change unapproved.
>   - **VETO:** the chief information security officer, concerned with prompt injection and
>     excessive agency (OWASP Top 10 for LLM Applications), logical access and change management
>     (SOC 2), and segregation of duties and change management among SOX IT general controls.
>     Legal authorities and standards named in the cycle are the persona's concerns, not legal
>     statements.
>   - **ENGINEER:** the full-stack ontologist and systems architect who owns the spec (as D-016).
>
> - **APPROVED BY:** the owner, choosing "New USER, CISO as VETO (Recommended)".

**ENGINEER's notes (not part of D-038).** BUILDER states the system's invariant in Turn 1, as "the one /api/v1 was built on": every change an outside caller makes to the knowledge graph goes through an action type, and is checked, permitted by role and module scope, recorded and audited. BUILDER's proposed feature was an agent-facing server speaking the Model Context Protocol in front of `/api/v1`, with a new verb, *propose*.

---

## 2. Cycle 1 transcript (generated persona dialogue; see the Notice above)

Each persona spoke once, in the protocol's order. The three turns are reproduced verbatim.

### Turn 1: BUILDER (the repository owner, by role)

> I own Ontos, and today its AI can look but cannot touch. The gateway turns a question into SPARQL and throws away anything that is not a read-only query; my own comparison table rates that partial. The Ontology API already has what an agent needs: a token bound to one workspace, with a role, read and actions scopes and a module scope, never acting above what its creator may do there now; writes that exist only as action types, each with a minimum role; a preview that lists every change a submission would make and every reason it would be refused; and a submission record and hash-chained audit entry when a submission is applied or rejected. What agents lack is a way in that stops short of applying. A submission that passes its checks is applied on the spot, and I do not let a passed criterion stand in for a model's judgement.
>
> An agent-facing server speaking the Model Context Protocol sits in front of /api/v1 and nothing else. It holds no database handle; it calls the same routes with the agent's token. Its tools are the reads, the action list with what this token may submit, preview, and one new verb: propose. A proposal is a previewed submission held, not applied. A person opens it, sees the change set and the criteria, and approves or declines. On approval the action is prepared again against the objects as they stand then, checked under the agent's token and under the approver's own role and module scope, and applied only if it passes both. The record and its audit entry name the agent as proposer and the person as approver; today a token's audit entry names only the token, by prefix and whatever name its creator typed.
>
> The invariant is the one /api/v1 was built on: every change an outside caller makes to the knowledge graph goes through an action type, and is checked, permitted by role and module scope, recorded and audited. Imports and telemetry write the graph without an action type, and an agent gets neither path. This feature preserves that invariant and adds three. An agent never acts above the person it acts for, so an agent's token must name that person, and a token row with no creator, which today acts on its own role alone, is refused to an agent. Nothing an agent proposes is applied unless a person who could have submitted it approves it. And an agent's refused attempts are recorded: today a refusal for role or module scope leaves no submission row, and an agent reaching past its scope is what I most want on the record.

### Turn 2: USER (head of procurement operations at a mid-size manufacturer; invented)

> It's twenty to five on a Tuesday, eleven working days to quarter-end. I have the renewal tracker on one screen and the shared procurement inbox on the other. Sixty-one of the hundred and forty renewals are keyed. Priya, Marcus and Dana keyed them by hand from email, and the CIO's note at the top of my inbox says "use AI for this." Right under it is a message from Tamsin Ridge Castings. It renews at four percent up, and two paragraphs down it says "please note our remit-to banking details have changed effective immediately," with a new account number and a PDF on letterhead.
>
> That second paragraph is why I'm careful. Last year one of those got keyed into the vendor master from an email. Nobody rang the supplier back on the number we already had, and a $186,000 payment sat in a stranger's account for nine days before the bank clawed most of it back. The auditor wrote it up as a SOX control failure: change to vendor master, no independent verification, no second approver. That finding has my name on the remediation plan. I am not going through that again because a machine read an email faster than Marcus does.
>
> Here is what I hoped for when I opened this. Read the inbox, find the renewal, match it to the right contract and the right PO, and lay it next to what we have today: old price, new price, term, the auto-renew clause, and whether it lands above the line where my approval matrix says a director signs. Then stop and wait for one of us. Tamsin Ridge has two agreements with us, one for castings and one for tooling, and their email just says "our agreement." If the tool guesses, I'd rather it didn't exist. If it isn't sure, it hands it back.
>
> Bank details I don't want it doing at all. Not drafting, not queuing, not tidying up. What I'd actually use is something that spots a remit-to change buried in an otherwise routine email, pulls it out, and puts it in front of whoever runs the callback, with the phone number we had on file before the email arrived.
>
> I close the tab and don't come back in three cases. The first is if the person approving can't see exactly what they approved at the moment they approved it. The second is if whoever asked for a change can also approve it. The third is if the auditor walks in and I can't hand over one list of every change, who started it, who signed off and when. And if my team ends up clicking "approve" on a hundred and forty items without reading them, that isn't a control, and the auditor will say so before I do.

### Turn 3: VETO (chief information security officer)

> I have read this product's security documentation and its token model, and I am stopping this on three grounds.
>
> The first is segregation of duties. Anyone who could have submitted an action may approve the agent's proposal, and an agent's token must name the person it acts for. Nothing in that rule stops the named person from approving. One employee can mint an agent token, let the agent propose a contract renewal, and approve it, and the record will show a proposer and an approver where one human initiated and authorised the change. Contract and vendor data sit inside our SOX boundary, and our open audit finding is a vendor master change with no second approver. Our Sarbanes-Oxley Section 404 assessment is made against COSO's 2013 framework, which lists segregation of incompatible duties as a point of focus under Principle 10, and our SOC 2 Type II report commits us to CC6.3, under which access to functions is granted with least privilege and segregation of duties considered. This design puts incompatible duties in one person's hands.
>
> The second is excessive agency over untrusted input. The agent's tools include every action type its token may submit, and the narrowest grant this product can express is a module: no token can be limited to one action type. The use in front of me is an agent reading a supplier inbox, text anyone outside the company can write. Our information security policy adopts the OWASP Top 10 for LLM Applications, 2025 edition, for every LLM integration; OWASP is not law, and it binds us only because our policy adopts it. LLM01:2025 treats input an LLM accepts from external sources as a channel for indirect prompt injection, and LLM06:2025 gives, as an instance of excessive agency, an agent with access to functions not needed for the intended operation of the system. Approval does not narrow what the agent can propose.
>
> The third is approval evidence. On approval the action is prepared again against the objects as they then stand, and checked under the agent's token and the approver's role and module scope. Neither check is against the change set the approver was shown. Action rules draw values from templates such as today's date, the actor and the named objects' current properties, so the two can differ. CC8.1 commits us to approving the changes to data that we implement, and approval of one change set followed by application of another is not that.
>
> Two conditions I am not resting this on would each be a veto of their own. If an action type that changes payment or remit-to details sits in any module an agent's token can reach, I stop it on the same Principle 10 ground. And if this graph becomes the record of contract terms, a later import overwrites an approved change and its provenance then shows the import, not the approval, which breaks the trail our auditor reads.
>
> As proposed, this does not ship.

### Turn 4: ENGINEER

ENGINEER's spec is sections 3 to 8.

---

## 3. ENGINEER's decision

**Status: PROPOSED.** See the Notice at the top.

**Decision: (b), a smaller feature.** In this revision, governance attaches to the data, not to an action type.

### 3.0 The decision, and what review changed

Two earlier designs each failed review because they bound something other than the data.

1. **Declared agent tokens.** The first design put its controls on tokens that declared themselves agents. Ontos cannot tell an agent from a script, so an ordinary token wired into an LLM agent bypassed every control.
2. **Action types.** The second design put governance on action types. Workspace admins and ontologists author action types (F33), and `createType` can create one that is active at once (`app/api/actionsRouter.ts:156-168`). So an ontologist could write a *second* action type that changes the same data, with no governance on it. An ordinary token could then submit that action and apply the change at once.

This revision binds the data itself. It rests on two principles.

**1. Governance attaches to classes, and every plan inherits it from the classes it actually touches.** A workspace admin marks a class with one or both settings:
- *approval required*: a change to its objects needs a second person's approval;
- *people only*: no API token may change its objects.

Subclasses inherit the setting. Each plan is governed by the strictest setting over every class it touches, whatever action type produced the plan and whoever submits it.
- **"Touches" means:**
  - objects the plan creates, revives (judged by the class they had before), changes or deletes;
  - the *from* object of every link it adds or removes, because a link is stored on its *from* object;
  - the *from* object of every incoming link a delete removes.
- **A link's target is not touched.** Data modelled as links *into* a governed object from another class (for example a bank account linked to a vendor) is governed only if that other class is governed too (4.3; 3.3 row 20).
- **Class strings are compared the way the database compares them,** which is the way the typed reads compare them (4.3). A class string the database treats as equal to a governed class, such as a variant in letter case or accents, is governed. New action definitions and mappings may not use such a variant.
- **When the check runs:** at preview, submit, propose, adoption and approval, and again under a per-workspace governance lock inside the transaction that applies the plan.

A new or edited action type gains nothing, because the data it reaches carries the governance. REFUSE-02 and REFUSE-16 show the sibling-action attack refused, including through a class-string variant.

**2. A token's proposal is a draft, and people decide.**
- A token can draft a change to any action it may use.
- Only the person who created the token, signed in to their own session, can turn the draft into a change or into a proposal. That person becomes the *maker*.
- When the data needs approval, a person other than the maker must approve the exact change set they were shown.

**What this cycle would build** if the owner approves: three pull requests (4.15).
- **PR 1:**
  - class governance, with a per-workspace governance lock;
  - variant class strings refused in new action definitions and mappings;
  - approval of changes to governed data by a person other than the maker, bound to a hashed change set;
  - re-checks under lock when the plan is applied;
  - one exported list of every change made through action types.
- **PR 2:** token controls:
  - grants to listed action types;
  - draft-only tokens;
  - people-only data refused to every token;
  - drafts that only the creator can adopt;
  - records of tokens' refused attempts.
- **PR 3:** the approvals and drafts interface, with untrusted text shown inert and visible, and the browser test.

**Not built this cycle:**
- the agent-facing MCP server;
- refusal records for signed-in people (moved to section 7 under rule 1, 3.6);
- governance of individual properties;
- governance of imports.

### 3.1 What exists today (read in the worktree; nothing run)

| # | Fact | Where |
|---|---|---|
| F1 | The LLM gateway throws away any SPARQL that is not read-only. The capability table rates "AI on the ontology" partial and says "It cannot write." | `app/api/services/llm/gateway.ts:165-168`; `app/src/lib/landscape.ts:263-268` |
| F2 | `/api/v1` changes data only through action types. `preview` returns problems, criteria and changes. `submit` applies the change at once when the checks pass. | `app/api/publicApiRoutes.ts:259-287`; `app/api/services/actions/service.ts:577-598` |
| F3 | A token has a workspace, a role, the scopes `read` and `actions`, an optional module scope and an optional expiry. It cannot be limited to particular action types. | `app/db/schema.ts:386-414`; `app/api/services/publicApi/tokens.ts:15,48-54`; `app/api/services/actions/engine.ts:107-118` |
| F4 | A token whose creator is on record acts at the lower of its own role and the creator's current role, with module scopes narrowed. A token with no creator on record acts on its own role, and an existing test pins this. Such rows arise only from direct SQL, or from calling `createToken` with a null `userId`. | `app/api/services/publicApi/principal.ts:79-96,119-120`, null creator at `:80`; `app/api/__tests__/publicApiPrincipal.test.ts:120-123`; `tokens.ts:46` |
| F5 | The API passes a token to `checkSubmitter` as `userRole: "api"`, so the platform-administrator shortcut never applies to a token. | `publicApiRoutes.ts:101-104`; `engine.ts:108` |
| F6 | A token's actor label is `API token '<name>' (<prefix>…)`. The audit entry of its submission carries that label, and the submission row carries the creator's user id. | `principal.ts:122-123`; `service.ts:425-439,504-514` |
| F7 | A refusal for role, module scope or an inactive action leaves no record. Other rejections are recorded. | `service.ts:572-576,585-587`; `service.ts:532-570,588-590` |
| F8 | Templates read `{actor}` (the submitter's name), `{today}` (the UTC date of `now`), `{now}` (a millisecond ISO timestamp) and the named objects' properties. The seeded *Renew contract* writes `renewedBy: "{actor}"` and `renewedOn: "{today}"`. | `app/contracts/actions.ts:12-17,29`; `engine.ts:272-290`, `{today}` at `:276`, `{now}` at `:277`; `app/db/seed.ts:341-369`, rule at `:363` |
| F9 | `prepareSubmission` takes `now`, checks the submitter it is given, and uses `submitter.name` as `{actor}`. It evaluates criteria in the context that `planEdits` returns, whose `now` is the `now` it was given. | `service.ts:289-357`, at `:294,311,323,327`; `engine.ts:396-397,578` |
| F10 | The preview's change list (`summarisePlan`) drops the properties of created objects and keeps only the names of removed properties, losing their old values. The README says the preview lists "every change a submission would make". | `service.ts:377-385`, at `:379-380`; `README.md:732` |
| F11 | Applying a plan locks the objects it read, checks their fingerprints (class, label, properties, deleted, outgoing link ids), and writes the edits, the submission, the audit entry and the side-effect jobs in one transaction. On a conflict it plans once more. | `service.ts:361-367,397-530`, lock at `:401-418`; `service.ts:583-596` |
| F12 | Every edit to a definition, display name, description or minimum role makes a new version. A status change does not. | `app/api/services/actions/definitions.ts:157-165,182-207` |
| F13 | An import upserts nodes by IRI. On a duplicate IRI it replaces the stored properties wholesale, keeps the existing class, and clears `sourceSubmissionId`. It links only to targets that already exist. | `app/api/services/mappingSync.ts:530-536,571-579`; `README.md:971-973` |
| F14 | The seeded demo imports contracts and people through active mappings. | `seed.ts:1125-1163` |
| F15 | The audit log is a hash chain over canonical JSON with sorted keys. | `app/api/services/audit.ts:26-34,60-71,98-132,135-157` |
| F16 | Only `/api/v1` authenticates bearer API tokens. tRPC reads only the session cookie. | `publicApiRoutes.ts:145-151`; `principal.ts:165-168`; `app/api/context.ts:25`; `app/api/auth/service.ts:60-75` |
| F17 | The repository has a hand-written MCP client, on protocol `2025-06-18`. A search of `app/package.json` finds no MCP library. | `app/api/services/engineHost/mcp.ts:1-15`; `app/package.json` |
| F18 | A test that reaches the semantic engine without a private one may spawn a daemon on 8085. | `app/api/services/semanticEngine.ts:194-197,444-479`; `app/api/__tests__/privateEngine.ts:37-75` |
| F19 | Persona sign-in is on outside production, and in production when `ALLOW_DEMO_LOGIN=true`. Persona accounts store names such as "Priya Sharma (Editor)". CI's browser stack turns persona sign-in on. | `app/api/auth-router.ts:23-37`; `README.md:906-908`; `app/api/boot.ts:379-384`; `auth/service.ts:277-278,302`; `.github/workflows/ci.yml:256` |
| F20 | The IoT webhook takes its own key, from `x-iot-api-key` or from `Authorization: Bearer`. | `boot.ts:305-314` |
| F21 | Telemetry ingestion and the twin simulation write `kg_nodes.propsJson` outside action types. | `app/api/services/iot/iotIngestion.ts:283`; `app/api/twinRouter.ts:364` |
| F22 | Every audit append, in any workspace, first takes the one row of `audit_chain_lock`. | `audit.ts:81-103`; `schema.ts:541-543` |
| F23 | An action's webhooks are enqueued in the apply transaction. Non-authors see each address only as a masked target. | `service.ts:491-502`; `app/api/services/actions/webhookView.ts:32-41,76-88` |
| F24 | Deleting an object soft-deletes its outgoing and incoming links, selected by node id. The plan lists neither. `loadObjects` loads outgoing links only, at most 5,000 across all named objects in one query, with no order. | `service.ts:470-476`; `service.ts:95-128`, limit at `:101-105` |
| F25 | A create whose IRI names a soft-deleted node revives that node. It overwrites the node's class, module, label and properties and clears `sourceMappingId`. | `service.ts:419-460` |
| F26 | The client batches tRPC calls. | `app/src/providers/trpc.tsx:119` |
| F27 | `getDb` holds one connection pool and sets no isolation level. | `app/api/queries/connection.ts:14-31` |
| F28 | Token expiry is compared on the app's clock. | `tokens.ts:153` |
| F29 | The ontology model holds no action rules or side effects. Its version is a hash of its body, and the model is cached for 5 seconds. | `app/api/services/publicApi/model.ts:55-64,206-212`; `publicApiRoutes.ts:46-52` |
| F30 | The mapping editor checks that a mapping's class belongs to its module. It does not check the subject template. A mapping reaches its workspace through its connector. | `app/api/mappingRouter.ts:193-197,226-244`; `schema.ts:188-212` |
| F31 | An import's audit entry records counts, not prior values. An applied action's audit entry records each changed value's old and new state. | `mappingSync.ts:621-632`; `service.ts:380,511` |
| F32 | The app deletes neither action types nor tokens. Re-seeding deletes both, with their workspaces. | `seed.ts:458-477`; `schema.ts:392-394` |
| F33 | Workspace admins and ontologists author action types. `createType` takes a status, so it can create an active action. `updateType` replaces a definition. | `webhookView.ts:13`; `actionsRouter.ts:39,156-184` |
| F34 | `createClass` sets a class's parent when it creates the class. The only other write to a class is deprecation. No app path changes a class's parent or IRI. Both procedures are open to editors and above. | `app/api/ontologyRouter.ts:212-310,415-447`; `app/api/middleware.ts:140-144` |
| F35 | Editors and above run imports. | `README.md:589`; `middleware.ts:140-144` |
| F36 | `kg_edges.fromNodeId` and `toNodeId` are foreign keys to `kg_nodes.id`. The index `kg_edges_ws_to` covers (`workspaceId`, `toNodeId`). | `schema.ts:461-466,480` |
| F37 | A request with no session cookie is refused before any database read. | `auth/service.ts:69-82` |
| F38 | An action definition's class IRIs are not checked against the ontology. A mapping's class must be a class of its module. | `definitions.ts:36-54`; `contracts/actions.ts:174-259`; `mappingRouter.ts:237-244` |
| F39 | The server's TypeScript library is ES2022. | `app/tsconfig.server.json:4-5` |
| F40 | `buildPrefixMap` and `expandIri` turn prefixed IRIs into full ones. | `app/api/services/rdfBridge.ts:53,109` |
| F41 | Existing tests pin several things: the tRPC submit's arguments; that a person's permission refusal leaves no record; the creator object passed to `createToken`; route tests that mock `getDb` with selects only; and `listTypes` tested with only the definitions and the service mocked. | `actionsRouter.test.ts:22-35,138-147,161-166,169-176`; `developerRouter.test.ts:81`; `publicApiRoutes.test.ts:35-53` |
| F42 | Typed reads choose objects by class in SQL: `listObjects` uses `inArray(kgNodes.classIri, classWithDescendants(...))`. No collation is set in `app/db`. The stack runs `mysql:8.4`, whose default collation `utf8mb4_0900_ai_ci` ignores case and accents; the collation of any given deployment is UNVERIFIED. The create rule's class pattern admits any local name. | `app/api/services/publicApi/objects.ts:105`; `definitions.ts:259-278`; `compose.yaml:50`; `contracts/actions.ts:43-47` |
| F43 | `audit_log.workspaceId` is a foreign key to `workspaces.id`. An audit append takes `audit_chain_lock` and then inserts into `audit_log`. No app path updates or locks a `workspaces` row (one test does). | `schema.ts:518-520`; `audit.ts:100-127`; `app/api/__tests__/mysql/leases.mysql.test.ts:127` |
| F44 | A test pins every file that writes the graph's tables and its number of writes, with `services/actions/service.ts` at 7, and requires each such file to record its change. | `app/api/__tests__/graphChangeWriters.test.ts:15-25,42-48` |
| F45 | Telemetry resolves its target in the twin module by IRI and writes the properties it receives. The twin simulation's tick is open to editors. An action's create rule can place an object in any module. | `iotIngestion.ts:61-75,207,277-283`; `twinRouter.ts:311-329`; `contracts/actions.ts:114-115` |
| F46 | Editors create and edit mappings and run imports. The mapping editor checks the class with SQL equality, which folds case and accents under the default collation. | `mappingRouter.ts:185,237-241,409` |
| F47 | The worktree's lockfile resolves drizzle-kit 0.31.10, which accepts `--name`. | `app/package-lock.json:5792-5793` |

### 3.2 How ENGINEER reads rule 4

USER describes two things.

**(1) The renewal agent.** USER opens with "Here is what I hoped for when I opened this": read the inbox, match the renewal, lay it beside what is on file, "then stop and wait for one of us", and hand it back if unsure. Reading and matching happen outside Ontos. What Ontos does is hold a prepared change until a person decides. That is BUILDER's feature seen from USER's desk.

**(2) The remit-to detector.** USER's strongest cue that they want something else comes next: "What I'd actually use is something that spots a remit-to change buried in an otherwise routine email, pulls it out, and puts it in front of whoever runs the callback, with the phone number we had on file before the email arrived." USER says this inside the paragraph that begins "Bank details I don't want it doing at all". ENGINEER reads it as USER's answer for bank details, not as a replacement for (1).

**Rule 1 against rule 4.** Rule 4 is written for a USER who describes *a* different feature. This USER describes BUILDER's feature and a second one. Rule 1 allows one feature per cycle, so the cycle keeps (1) and logs (2). For the second feature that **reverses rule 4's direction**: rule 4 would log BUILDER's feature, and here USER's is logged. ENGINEER does this for three reasons:
- every kill condition USER names concerns approval of changes;
- the core of (2), reading email and extracting a change, is outside the semantic layer;
- the parts of (2) Ontos could own do not exist. Those are a read of a value as it stood before a given time, and a task routed to a person.

On that history, applied action edits do keep their old and new values in the audit log (F31). `twin_state_log` is append-only telemetry (`schema.ts:625`). What is missing is history for **imported** values (F13, F31).

If the owner reads rule 4 the other way, the cycle pivots to the detector, and ENGINEER's decision on it is **(c)** (6, Q1).

### 3.3 Why (b) holds, residual by residual, and why not (a) or (c)

**The protocol's terms.**
- **(b)** is "a smaller feature that delivers partial value while unblocking VETO".
- **Loop Termination:** if the personas have not converged on a buildable feature, the cycle ends without code.
- VETO speaks once per cycle, and ENGINEER does not clear VETO.

A (b) spec is ENGINEER's claim, which the owner accepts or rejects, of two things:
- a smaller buildable feature exists;
- VETO's stated objection does not reach it.

ENGINEER reads "unblocking VETO" this way: building the smaller feature does not override any of VETO's grounds, and VETO's next turn judges the controls before any LLM-facing integration exists.

**What r3 adds and does not add.**

- **Write reach.** A token with the `actions` scope can already apply any action in its module scope immediately (F2, F3). r3's new verb `propose` produces a draft or a held proposal, which is less than `submit`. Every other addition narrows access or records it.
- **Read reach.** A token sees, through its drafts, only the summary that `preview` returns today. The change set, with its revived nodes, mapping ids and webhook targets, is shown to people in the app only (4.7, REFUSE-22). There is one exception: **one bit about deleted nodes** (row 21).
- **One new read for tokens: governance settings.** `GET /actions` now tells a token which action types need approval or are people-only. That reveals which classes are governed. It is metadata, not object data.
- **Surface.** r3 builds no LLM-facing integration: no MCP server. It does build an HTTP verb (`propose`) and SDK methods meant for agents and scripts to draft with. It also adds an "AI agent" token preset, landscape text and a README diagram that describe that use (4.12, 4.16). These are part of what VETO will judge.

**Every residual that remains inside VETO's grounds and conditions, and how r3 relates to each:**

| # | Residual | Ground | Compared with today | Argument |
|---|---|---|---|---|
| 1 | Persona sign-in lets one person act as several users | 1 | Today there is no second person at all. r3 flags persona acts on the sheet and in the record. | Production refuses persona sign-in by default (`README.md:772-773`). |
| 2 | **One human with two accounts** | 1 | **r3 creates a record that names two accounts where one human acted.** That is close to VETO's own sentence. | Ontos's identity is the account. One account per person is the identity provider's control. Today the same human applies the change alone, with no second name in any record. r3's record is accurate about accounts, not about humans. **This is the residual most likely to keep ground 1 open.** |
| 3 | Shared accounts, such as a bot account used by several people | 1 | Same as 2. | Same as 2. |
| 4 | Collusion between two people | 1 | Unchanged. | No segregation-of-duties control prevents collusion. |
| 5 | A token's creator adopts a draft that someone else drove with the creator's token | 1 | Today the token applies directly. r3 makes the creator act in session and records them as maker. | The record is true about who acted in session. It hides credential sharing. |
| 6 | One admin switches governance off, submits, then switches it back on | 1 | Today there is no governance to switch off. | The switch is admin-only. Both changes are audited from → to with their times, and the submission made in between records `governance_at_apply = none`. Switching off deletes the class's row, so the audit log, not the row, ties the submission to the gap (6, Q17). |
| 7 | The approver needs only the action's minimum role; there is no approval matrix | 1 | Unchanged. | Section 7. |
| 8 | **Editors create and edit mappings and run imports into governed classes with no second person** (F13, F35, F46) | 1, import condition | Unchanged. | r3 governs the action-type path, which is the only path by which tokens write (GUARD-04). Imports are a separate path for people (6, Q21). |
| 9 | Tokens with no grants and not draft-only keep today's reach on ungoverned data | 2 | Unchanged unless an admin governs the data or the creator narrows the token. | Ontos cannot tell an agent from a script. |
| 10 | Reads are not narrowed | 2 | Unchanged. | Section 7. |
| 11 | Indirect prompt injection is contained, not prevented | 2 | Today nothing contains it. | A person decides every governed change, and every draft. |
| 12 | Approved strings become data that the gateway and other agents read (stored injection) | 2 | Unchanged in kind. | Section 7. |
| 13 | An ungoverned action's webhook can send values it reads to an external system | 2 | Unchanged. | Ontos does not govern external systems (section 7). |
| 14 | The server proves what it sent to the approver, not what they read | 3 | Today nothing is proven. | Section 7. |
| 15 | Direct submissions on ungoverned data are not hash-bound | 3 | Unchanged. | Section 7. |
| 16 | Confusable characters within a single script | 3 | Today there are no markers at all. | Mixed scripts are flagged (4.12). |
| 17 | A script holding a signed-in session acts as that person | 1, 3 | Unchanged. | Bounded by the decision limits (4.1). |
| 18 | Ontos cannot recognise payment data, and governance is per class, not per property | condition 1 | Today nothing can be governed. | An admin must govern the class (6, Q20). |
| 19 | Imports and telemetry overwrite approved changes; a future mapping's IRIs are not detected; subject templates are unrestricted | condition 2 | Unchanged, except that approvers are now warned. | Section 7. |
| 20 | **Links *into* a governed object from an ungoverned class are not governed.** For example, an ungoverned action can create a `fin:BankAccount` and link it to a governed `fin:Vendor`. | 1, condition 1 | Today nothing is governed. | A link is stored on its *from* object, so only that object's class is touched (4.3). Governing every link into a governed object would govern every invoice that links to a vendor. Link-modelled data needs its own governed class. |
| 21 | A token learns **one bit**: whether a soft-deleted node of a governed class exists at an IRI that the token's create would take. The governance refusal of the revive tells it. | 2 | New, and caused by r3. Today a token's create there revives the node without saying so. | The token cannot read the node, only learn that it exists and is governed. Avoiding this would mean refusing every revive by a token, which changes existing behaviour (6, Q22). |
| 22 | **Telemetry writes any property of an object in the twin module,** including a governed-class object that an approved action placed there (F45) | 1, condition 2 | Unchanged in kind. | The IoT key is not an API token (F20). Telemetry is a separate path that r3 does not govern (section 7). |

**The (b) claim, exactly.**
- **Write reach:** r3 adds none for any caller.
- **Object read reach:** r3 adds none for any caller, except the one bit of row 21.
- **Controls:** it adds controls that bind the data. Under 4.3's comparison rule, which is the one the typed reads use, every plan touching a governed class is judged as governed, through any action type.
  - Data written under a class string that names no ontology class is ungoverned, and no typed read lists it under a governed class.
  - `createClass` refuses to give such data a class under a governed ancestor, because that would adopt it into the governed class without approval (4.3, REFUSE-02l).
- **Records:** it adds one new kind of record, the maker and approver pair. That record means two people only if each person holds one account (rows 2 and 3).

Every other residual exists today with less control or is unchanged; row 21 is the only one r3 causes. If the owner judges that rows 2, 3 or 8 mean VETO's ground 1 still reaches what r3 builds, the honest choice is **(c)**: nothing is built, and this spec stands as the design for VETO's next turn (6, Q2). Whether to merge before VETO's next turn is a separate question (6, Q13).

**Precedent, argued rather than relied on.** In `xfn` cycle 1 the owner approved a (b) spec built before VETO cleared (D-021, D-022). Its argument, "nothing VETO named is within reach of what is built" (`docs/specs/2026-10-14-xfn-semantic-layer-cycle-1-rerun.md:108`), rested on no real record being loadable. r3 does reach real data, through action types that already reach it. So the argument above rests on reach not growing and on controls being added, not on keeping data out of reach. The precedent shows that the owner has accepted a (b) before VETO rules. It does not show that this one is right.

**Not (a).** Option (a) needs everything in r3 plus the MCP server, with its process, transport and tests. That is more than a short series of pull requests. It would also ship an LLM-facing integration before VETO has judged the controls.

**Not (c).** Declining leaves today's exposure in place: any token with `actions` applies changes at once, with no second person and no record of what it was refused. r3 reduces that exposure, wherever an admin governs data or a creator narrows a token. (c) stays open to the owner.

### 3.4 VETO's grounds: exactly what r3 does

ENGINEER does not clear VETO. **Only VETO, in a later cycle, can clear these grounds.** The "Residual" column of 3.3 is the complete list of what stays open. Each claim of "any action type" below holds for plans as 4.3 computes them: touched classes compared as the database compares them, and a link touching only its *from* object.

**Ground 1: segregation of duties.**
- *Addressed:*
  - **No direct apply of governed data.** No caller can apply, through any action type, a plan that touches a class governed *approval required* (REFUSE-02). This covers:
    - action types created or edited after the governance was set;
    - action definitions stored with a class-string variant before this cycle (REFUSE-02h); new ones are refused at write (REFUSE-02g);
    - plans re-checked under the governance lock when they are applied (REFUSE-07d, 07e).
  - **The maker is always a person in session.** A token's proposal is a draft that only its creator can adopt, in their own session (REFUSE-18).
  - **No maker approves their own proposal.** This holds for platform administrators too (REFUSE-03). The approver must be able to submit the action (REFUSE-04), and the maker must still be permitted (REFUSE-05). These are re-checked under lock (REFUSE-07b, c).
  - **No token approves anything.** One call decides one proposal, and decisions are rate-limited (REFUSE-10).
  - **The record names three parties separately.** The drafting token, the maker and the approver each appear by id and label (4.11).
- *Not addressed:* rows 1 to 8, 20 and 22 of 3.3.

**Ground 2: excessive agency over untrusted input.**
- *Addressed:*
  - **Narrow grants.** Any token can be limited to 1 to 20 listed action types, pinned to their versions (REFUSE-17). This is narrower than a module.
  - **Draft-only tokens.** Any token can be made draft-only (REFUSE-18d).
  - **People-only data.** An admin can make a class's data people-only.
    - Every token is then refused, through any action type, class-string variants included (REFUSE-16).
    - A token-drafted proposal is also refused at approval if its class has since become people-only (REFUSE-16f).
    - Records that a token writes under an unknown class string cannot later be adopted into the people-only class by creating that class under it (REFUSE-02l).
  - **Drafts never apply on their own.**
  - **Tokens' refused attempts are recorded.** Each refusal is itemised up to 20 times per hour for each combination of token, action and code; beyond that it is counted against that same combination, so the action and the code are never lost (REFUSE-20).
- *Not addressed:* rows 9 to 13, and 21, of 3.3.

**Ground 3: approval evidence.**
- *Addressed:* the approver is shown a hashed change set (4.5). The approval applies only if a fresh change set has the hash the approver opened (REFUSE-06). Templates render at a frozen effective time, which is bounded and shown (4.4). The change set covers:
  - the action, its version and the maker;
  - the effective time;
  - the parameters;
  - the named objects as they stand;
  - every edit, with old and new values;
  - the incoming links a delete removes;
  - any revived node, with its prior state and provenance;
  - the webhook targets, as masked hosts;
  - import warnings;
  - the governance that applies.

  The applied change set and its hash are stored on the proposal and in the audit entry. The submission row stores the hash and the governance it applied under.
- *Not addressed:* rows 14 to 17 of 3.3.

**VETO's first stated condition: payment or remit-to details within a token's reach.**
- *Addressed:* an admin can make the class holding those details people-only, so that every token is refused through any action type (REFUSE-16). The admin must also govern every class that holds linked banking data (row 20). The admin can require approval for people's changes to those classes as well.
- *Not addressed:* rows 18 and 20 of 3.3. **This condition recurs.**

**VETO's second stated condition: imports overwriting approved changes.**
- *Addressed in part:* the change set warns when an import last wrote a touched object, or when a mapping targets its class. The warning is part of the hash (REFUSE-06e).
- *Not addressed:* rows 8, 19 and 22 of 3.3. **This condition recurs.**

### 3.5 USER's needs: met, partly met, not met

| USER's need (Turn 2) | r3 | How, or why not |
|---|---|---|
| Read the inbox; match the right contract and PO | Not Ontos's part | Ontos cannot verify the match. |
| Lay it next to what we have today | Met for what the graph holds | Every named object is shown with all its properties, beside every change as old → new (4.12). |
| Above the director's line | **Not met** | No approval matrix (section 7). |
| Stop and wait for one of us | Met when the token is draft-only or the data needs approval | A token's proposal is a draft until its creator adopts it. A draft-only token cannot apply. A token that is not draft-only can still apply ungoverned changes directly (3.3 row 9). |
| If unsure, hand it back | Partly | Ontos cannot detect a guess. The rationale is shown as unverified text, and a decline returns its reason to the token. |
| Bank details: "Not drafting, not queuing" | Met when an admin makes people-only the vendor class and every class that holds linked banking data | Every token is refused, through any action type, class-string variants included. A token-drafted proposal is refused even after a person adopted it (REFUSE-16). Records written under an unknown class cannot later be made vendors by creating that class under the vendor class (REFUSE-02l). Ontos cannot recognise payment data itself, and data linked *into* a vendor from an ungoverned class is not governed (3.3 row 20). |
| Remit-to detector | Not this cycle | 3.2, and section 8. |
| Kill condition 1: the approver sees exactly what they approved | Met on the server; render-tested | REFUSE-06, ACCEPT-02, ACCEPT-17. |
| Kill condition 2: whoever asked can also approve | Met for governed data, with one account per person | No maker approves their own proposal (REFUSE-03). The maker is always a person in session (REFUSE-18). Ungoverned data needs no second person by design. The gaps are 3.3 rows 1 to 6, row 8 (mappings and imports by editors), and rows 20 and 22. |
| Kill condition 3: one list of every change, who started it, who signed off, and when | Met for changes made through action types | Every row names the responsible person. For a token's change that is the token's creator. A row shows a sign-off only when a second person approved it, and it records whether approval was required when it applied (ACCEPT-04). Imports appear in the audit log, not in this list. |
| 140 approvals clicked unread | Partly | A proposal must be opened before it can be approved. There is no bulk approval, and decisions are rate-limited. Opening and deciding times are exported. Ontos cannot make anyone read. |

### 3.6 Rule 1: why this is one feature, and what moved out

The feature is **"changes to governed data need a second person, whoever starts them; agents and scripts reach it only as drafters."** Each part kept serves that one feature:

- **Governance of people's own changes** (PR 1). Ontos cannot tell an agent from a script, and a signed-in session can be scripted too (3.3 row 17). VETO's ground 1 example is one person both starting and authorising a change. If governance bound only tokens, a person or a script with a session cookie would sidestep it. So binding the data for every caller is required, not added.
- **Token grants, draft-only and people-only** (PR 2). These are how agents and scripts reach the feature with the least reach. They answer VETO's ground 2 and USER's "not drafting, not queuing".
- **The token name rule and the cap on live tokens.** These apply to every new token, because the server cannot tell which token an agent holds. The name rule protects the approval sheet, which shows token names (ground 3). The cap bounds how many drafts one person's tokens can create.
- **Unicode markers.** These protect what the approver perceives, which is part of the approval evidence.
- **The export.** USER's "one list" must include direct changes, or it is not one list.
- **No variant class strings in new action definitions and mappings** (PR 1, in `definitions.ts` and `mappingRouter.ts`). Use-time resolution (4.3) already governs a variant. The write-time refusal stops new variants being written at all, so the data and the ontology agree. It is part of governing the data, not a separate cleanup.

**Moved to section 7 under rule 1:**
- Recording permission refusals for **signed-in people**. That was deferred once before as a separate feature, and an existing test pins "refuses without a record" for sessions (`actionsRouter.test.ts:169-176`).
- Property-level governance.
- Import governance.

If the owner judges that the token controls or the export are a second feature, the split is in 6, Q18.

### 3.7 Where r3 departs from BUILDER's proposal (rule 5: ENGINEER's spec wins)

1. **Governance is on classes and inherited by every action type that reaches them.** It is not a per-agent or per-action setting.
2. **A token's proposal is a draft.** Its creator adopts it in session.
3. **The approver must be a person other than the maker.**
4. **Approval applies exactly the change set shown.** BUILDER's "prepared again ... applied only if it passes both" stays as a check and is not enough on its own.
5. **Grants and draft-only are available for any token.** There is no agent token kind.
6. **No MCP server this cycle.**
7. **Proposed, open as 6 Q3:** `{actor}` names the maker, from the label stored when they submitted.
8. **Proposed, open as 6 Q4:** templates render at the maker's effective time.
9. **Authoring of action types stays with ontologists and admins** (F33). Governance follows the data at every check, so a new or edited action type cannot sidestep it (REFUSE-02). Restricting authoring further is offered as defence in depth (6, Q19).

### 3.8 Trade-offs: what is given up, and by whom

1. **USER.**
   - No agent-facing server, no approval matrix and no remit-to detector.
   - Every change to governed data needs two people. For a token's change those are the token's creator, who adopts the draft, and a different approver.
   - Decisions are limited: 30 approvals per 10 minutes, and 60 other decisions per 10 minutes, per person.
   - A proposal is opened again if anything it shows changes.
   - Governance is per class. Making the vendor class people-only takes every vendor field out of every token's reach, not only bank details.
2. **BUILDER.**
   - The adapter waits.
   - Nothing changes until an admin governs a class or a creator narrows a token.
   - A token's record shows its prefix, name and creator, never "agent".
3. **Token creators.** They adopt their tokens' drafts in their own session, at most 24 hours after opening them, and become accountable for them. They cannot approve their own proposals.
4. **Approvers.** They must open each proposal, and must reopen it when it goes stale. An approval can be refused for reasons outside their control.
5. **Workspace admins.** They decide which classes are governed. One admin can change a class's governance alone, and the change is audited.
6. **Ontologists.** They keep authoring action types. Any edit to a definition makes a new version (F12), which lapses grants and blocks pending proposals made under the old version.
7. **Every caller.** Every plan's touched classes are checked against governance. Every apply transaction takes a shared lock on its workspace's governance-lock row (4.3). A delete removes only the incoming links that were read when the plan was prepared (4.5). If no class is governed, nothing is refused.
8. **Existing API clients and the app.** Their behaviour is unchanged until an admin governs a class or a creator narrows a token. These changes apply to every caller even before then (4.7, 4.8):
   - additive fields in `GET /actions` and in the action listings;
   - new paths in `/openapi.json` and `/sdk.ts`;
   - a name rule for new tokens;
   - a cap on live tokens;
   - new action definitions and mappings may not name a variant of an ontology class, such as a case, accent or expanded spelling.
9. **Persona sign-in users.** Persona acts are flagged.
10. **VETO.** The controls exist and are opt-in per class or per token. Reads are not narrowed, and injection is contained, not prevented.
11. **The implementer and reviewer.**
    - Two migrations and three pull requests.
    - 24 refusal tests, each run against its named break. One case may not fail if MySQL accepts the input; that is recorded as a finding (REFUSE-20c).
    - 18 acceptance tests and 4 guards.
    - The list of normative rules not tested (4.14).
    - Fixture-only additions to three existing test files (5.6).
    - No CI workflow change and no seed change.

### 3.9 Novelty and adjacency

**Novelty.** This is applied engineering. Maker-checker approval, approval bound to a content hash, class-level access policy and least-privilege grants are established practice. Nothing here is research.

**Adjacency.** It keeps Ontos within the semantic layer: it governs changes to the knowledge graph through action types. It adds no causal estimates, metric values, incentive design or roll-up.

---

## 4. Normative specification

### 4.0 Conventions

- **Everything in section 4 is PROPOSED.** Anything that exists today is cited with `file:line`.
- **Roles in this spec:**
  - **Maker:** the person who submits a change for approval in their own session, or who adopts a token's draft.
  - **Approver (Q):** a person who opens, approves or declines a proposal.
  - **Creator (P):** a token's `createdByUserId`.
- **Terms:**
  - `canonicalize` is `audit.ts:26-34`.
  - `sha256` is hex SHA-256 of UTF-8 bytes.
  - Code-unit order compares strings with `<` on UTF-16 code units.
  - `isWellFormedText(s)` is a new helper. It is true when `s` contains no unpaired surrogate. It uses a regular expression, because `String.prototype.isWellFormed` is outside the ES2022 library this server compiles against (F39).
  - `sanitiseText(s, max)` replaces unpaired surrogates with U+FFFD and cuts to `max` characters.
- **Error formats:**
  - Errors on `/api/v1` keep `{ error: { code, message, problems? } }` (`publicApiRoutes.ts:64-66`).
  - A tRPC refusal that is "an answer, not an error" returns `{ ok: false, code, message, problems? }`.

### 4.1 Configuration, defaults and bounds

| Setting | Value | Notes |
|---|---|---|
| `PROPOSAL_TTL_DAYS` | Default 7, bounds 1–30 | **Validated at startup in every environment.** A value out of range throws, naming the variable. `appSecret()` validates only in production (`app/api/lib/env.ts:16-23`). |
| Approval calls | 30 per 10 minutes per person | `RateLimiter("approvals", …)` (`app/api/lib/rateLimit.ts:225-248`). Every call counts, refused or not. |
| Other decisions: adopt, discard, decline | 60 per 10 minutes per person | `RateLimiter("decisions", …)` |
| Token proposals | 60 a minute per token | `RateLimiter("token-propose", …)`. Existing endpoints keep 300 a minute (`publicApiRoutes.ts:44`). |
| Drafts per token | 50 | |
| Drafts per creator, across tokens | 200 | |
| Pending proposals per maker | 200 | Drafts do not count against it. |
| Live tokens per creator per workspace | 25 | Not revoked, and not expired by the database clock. |
| Grants per token | 1–20 distinct keys | |
| A draft view's age at adoption | at most 24 hours | |
| `rationale` | 1–2,000 characters, well-formed | |
| `sourceRef` | at most 512 characters, well-formed | |
| `declineReason` | 1–500 characters, well-formed | |
| Parameter strings in any proposal | well-formed | |
| Change set (canonical JSON) | at most 512 KiB | |
| Outgoing links across the named objects | below 5,000 in total | `loadObjects`'s single-query limit (`service.ts:101-105`) |
| Incoming links of each deleted object | below 5,000 | |
| Token refusal records: itemised | 20 per hour for each (token, action, code) | |
| Token refusal records: `not_found` | 100 per hour per token, itemised | |
| Token refusal records: overflow | counted with the action and the code | |
| Stored refusal parameters | well-formed and at most 4 KiB as canonical JSON | Otherwise only the digest is stored. |
| Stored problem messages | sanitised, at most 300 characters each | |
| Proposal lists | 50 by default, 1–200 | |
| `exportSubmissions` | range at most 366 days; at most 10,000 rows | |
| Re-plan on conflict | once | |

`env.ts` gains `proposalTtlDays`. `compose.yaml`'s `x-app-env` (`compose.yaml:21-36`) passes `PROPOSAL_TTL_DAYS: ${PROPOSAL_TTL_DAYS:-7}`. Both the root `.env.example` (compose) and `app/.env.example` (local development) document it.

### 4.2 Data model and migrations

**How the migrations are generated.**

```
npm --prefix app run db:generate -- --name <name>
```

Run it with `DATABASE_URL` set to a dummy URL. CI uses `mysql://unused@127.0.0.1:1/unused` (`ci.yml:115`).
- The worktree's lockfile resolves drizzle-kit 0.31.10 (F47), the version a reviewer found accepts `--name`.
- 0009 and 0012 have no snapshot; the newest snapshot is 0011's.
- Whether generation diffs cleanly against it is UNVERIFIED. 0010's snapshot names a predecessor that is not in the repository. CI's drift check (`ci.yml:112-124`) is the evidence.
- `0014` is generated after `0013` merges, to keep the journal in date order (`app/api/__tests__/migrationHistory.test.ts:45-50`).
- Each migration adds its RELEASED line (`migrationHistory.test.ts:28-42`).

**`0013_governance_and_proposals` (PR 1)**

- New **`class_governance`**: one row per governed class.

  | Column | Type |
  |---|---|
  | `id` | AI PK |
  | `workspaceId` | FK, ON DELETE cascade |
  | `classIri` | varchar(512), stored as the ontology spells it |
  | `approval` | enum('none','required') NOT NULL DEFAULT 'none' |
  | `tokenAccess` | enum('allowed','people_only') NOT NULL DEFAULT 'allowed'. Settable from PR 2. |
  | `setBy` | varchar(255) |
  | `setByUserId` | bigint NULL |
  | `updatedAt` | timestamp |

  UNIQUE (`workspaceId`, `classIri`).
- New **`governance_locks`**: one row per workspace.
  - `workspaceId` bigint unsigned PRIMARY KEY.
  - **No foreign key**, in either direction. Nothing references the row, and the row references nothing. So no foreign-key check ever takes a lock on it, and taking it never locks a `workspaces` row.
  - The migration adds one row for every existing workspace: `INSERT INTO governance_locks (workspaceId) SELECT id FROM workspaces`, hand-added as 0008 hand-added its row (`app/db/migrations/0008_audit_chain_lock.sql`).
  - A workspace created later gets its row on first use (4.3).
  - A workspace deleted by re-seeding leaves its row behind, which is harmless.
- New **`action_proposals`**.

  | Column | Type and notes |
  |---|---|
  | `id` | AI PK |
  | `workspaceId` | FK cascade |
  | `actionTypeId` | FK `action_types.id` cascade, as `action_submissions` (`schema.ts:357-359`) |
  | `actionKey` | varchar(64) |
  | `actionVersion` | int |
  | `status` | enum('draft','pending','applied','declined','discarded','withdrawn','expired') |
  | `origin` | enum('session','token') |
  | `forUserId` | bigint NOT NULL. The session maker, or the token's creator. |
  | `tokenId` | bigint NULL, no FK (F32) |
  | `draftedBy` | varchar(255) NULL |
  | `draftChangeSetJson`, `draftHash` | NULL |
  | `makerUserId`, `makerLabel`, `makerIsPersona`, `submittedAt` | NULL until the proposal becomes pending |
  | `effectiveAt` | char(24) NULL. An ISO 8601 UTC string with milliseconds: the exact `now` the templates were rendered with. MySQL `timestamp` keeps whole seconds and converts by session time zone. |
  | `makerChangeSetJson`, `makerHash` | NULL |
  | `rationale` | text NOT NULL |
  | `sourceRef` | varchar(512) NULL |
  | `paramsJson` | json NOT NULL |
  | `paramsDigest` | char(64) |
  | `expiresAt` | timestamp NOT NULL |
  | `decidedByUserId`, `decidedBy`, `decidedAt`, `decidedIsPersona` | NULL |
  | `declineReason` | varchar(500) NULL |
  | `appliedHash`, `appliedChangeSetJson`, `submissionId` | NULL |
  | `createdAt` | timestamp |

  Indexes: (`workspaceId`, `status`, `id`), (`forUserId`, `status`, `id`), (`tokenId`, `status`, `id`).
- New **`action_proposal_views`**:
  - `proposalId` FK cascade;
  - `userId`;
  - `hash` char(64);
  - `renderedAt` char(24);
  - `viewedAt` timestamp;
  - PK (`proposalId`, `userId`, `hash`).
- **`action_submissions`** (`schema.ts:348-377`) gains:
  - `proposalId`, `approvedBy`, `approvedByUserId`, all NULL;
  - `changeSetHash` char(64) NULL, set only for submissions applied from proposals;
  - `governanceJson` json NULL, the governance the plan was applied under. It is set on every applied submission from PR 1 on. Earlier rows read as "unknown".

**`0014_token_controls` (PR 2)**

- **`api_tokens`** gains:
  - `actionGrantsJson` json NULL: `[{ key, version }]` sorted in code-unit order, or NULL for no grants;
  - `proposeOnly` boolean NOT NULL DEFAULT false.
- New **`action_refusals`** (tokens only):

  | Column | Notes |
  |---|---|
  | `id`, `workspaceId` | FK cascade |
  | `tokenId` | NOT NULL |
  | `userId` | The creator; NULL when the token has none |
  | `endpoint` | enum('preview','propose','submit') |
  | `stage` | enum('scope','checks') |
  | `actionKey` | varchar(64). Only keys that pass `actionKeySchema` (`contracts/actions.ts:32-35`). |
  | `actionTypeId`, `actionVersion` | NULL |
  | `code` | varchar(64) |
  | `problemsJson` | json. Sanitised. |
  | `paramsJson` | json NULL |
  | `paramsUnstorable` | boolean |
  | `paramsDigest` | char(64) NOT NULL |
  | `createdAt` | timestamp |

  Index (`tokenId`, `actionKey`, `code`, `createdAt`).
- New **`action_refusal_overflow`**:
  - `tokenId`;
  - `hourStart` datetime, on the database clock;
  - `actionKey` varchar(64), with `'*'` for `not_found`;
  - `code`;
  - `workspaceId`;
  - `suppressed` int;
  - PK (`tokenId`, `hourStart`, `actionKey`, `code`).

### 4.3 Class governance

**Setting.**
- `governance.setClass({ classIri, approval?, tokenAccess? })` is open to **workspace admins only** (`workspaceAdminMutation`, `middleware.ts:150`). `tokenAccess` is accepted from PR 2.
- The class must be exactly, with JS `===`, an ontology class `iri` of the workspace; otherwise NOT_FOUND. A variant the database would fold is refused.
- One transaction does all of this:
  1. take the workspace's **governance lock** exclusively, with `SELECT … FROM governance_locks WHERE workspaceId = ? FOR UPDATE`. The row already exists (below);
  2. upsert the `class_governance` row; a row with both defaults is deleted;
  3. write the audit entry `{ classIri, approval: { from, to }, tokenAccess: { from, to } }`.
- **It never locks a `workspaces` row.** The previous revision locked that row FOR UPDATE, and that could deadlock with audit writes (lock order below).
- **It is not wrapped in `withDeadlockRetry`.** A deadlock would reach the admin as an error, and a test can see it (REFUSE-07e).
- Governance is not versioned.

**The governance lock, and the order in which locks are taken.**
- **The lock row is ensured outside any transaction.** Before `setClass`, `createClass` (below) or an apply opens its transaction, it runs `INSERT IGNORE INTO governance_locks (workspaceId) VALUES (?)` as its own autocommit statement.
  - The process remembers each workspace it has ensured, so the statement runs once per workspace per process.
  - The statement commits at once and holds no lock afterwards.
  - Workspaces are created only by the seed, so after a re-seed no row exists until this first use.
  - **Inside a transaction the row is therefore always present.** No transaction ever takes a gap lock on a missing row, or inserts the row while holding another lock. The previous revision did both, and two concurrent first applies could deadlock on it (REFUSE-07f).
- **An apply transaction** takes the workspace's governance lock shared, before anything else: `SELECT … FROM governance_locks WHERE workspaceId = ? FOR SHARE`.
- **If the row is missing inside a transaction,** the process's memory of ensured rows is stale, for example after a re-seed. The transaction then rolls back at once, which releases every lock it took, including any gap lock. The process forgets that workspace, runs the autocommit `INSERT IGNORE`, and starts the transaction again, once. It never inserts the row inside a transaction.
- **The orders, written out.** Lock names: G = `governance_locks` row; CG = `class_governance` rows; OC = `ontology_classes`; AT = `action_types` row; U/M = `users` and `workspace_members` rows; P = proposal row; N = named and deleted `kg_nodes` rows; E = incoming `kg_edges` rows; MAP = `mappings` rows; A = `audit_chain_lock`; FK-W = the shared lock a foreign-key check takes on the `workspaces` row.

  | Path | Order |
  |---|---|
  | Before any of the paths below | autocommit `INSERT IGNORE` of G's row; it holds nothing afterwards |
  | `setClass` | G (X) → CG write, which takes FK-W (S) → A (X) → `audit_log` insert, which takes FK-W (S) → commit |
  | `createClass` (4.3, "Adopting existing data") | G (X) → OC insert → graph-change record → A (X) → `audit_log` insert, FK-W (S) → commit |
  | Apply: direct submit, adoption apply, approval | G (S) → CG (S, locking read) → [approval: AT (S) → U/M (S) → P (X)] or [adoption: AT (S) → token (S) → U/M (S) → draft (X)] → N (X) → E (X) → MAP (S, proposals only) → writes, each taking FK-W (S) → A (X) → `audit_log` insert, FK-W (S) → commit |
  | Standalone audit append (for example a membership change, `adminRouter.ts:62-70`) | A (X) → `audit_log` insert, FK-W (S) |
  | `revokeToken` | token (X) → drafts (X) → A (X) → `audit_log` |
  | `updateActionType` | AT (X) → version insert → A (X) → `audit_log` |

- **Why these orders cannot deadlock.**
  - **No app path takes a `workspaces` row exclusively** (F43). So the FK-W shared locks never wait.
  - **G is taken first by `setClass`, `createClass` and applies,** and the row always exists when it is taken. Anything that holds A while also holding G holds it shared, because it is an apply. So `setClass` or `createClass`, which need G exclusive, cannot be holding G while such a transaction holds A.
  - So when either holds G and waits for A, A's holder is either a standalone append, which waits on nothing they hold, or a transaction that does not hold G.
  - **Tokens and drafts:** `revokeToken` and adoption both take the token before the draft.
  - **Action types:** `updateActionType` takes AT exclusive and nothing that an apply holds before AT.
- **The previous revision's deadlock**, for the record: `setClass` held the `workspaces` row exclusive and waited for A, while an audit append held A and waited for FK-W. REFUSE-07e reproduces that order deterministically and requires it to complete.

**Reading.**
- `governance.list()` (any member) returns the governed classes.
- `governance.capabilities()` returns `{ canSetGovernance, personaLoginOn }`, where `personaLoginOn = !env.isProduction || env.allowDemoLogin` (`auth-router.ts:30`).
- `actions.capabilities` is unchanged (F41).

**Comparing classes: one rule, the database's.** A touched class string is **resolved** to the ontology classes it names, as follows.
1. **Gather the candidates.** Take the string as written. If it begins with a module namespace from `buildPrefixMap` (F40), also take its prefixed (compacted) form.
2. **Let the database compare.** One query returns the workspace's ontology classes whose `iri` the database treats as equal to any candidate: `ontology_classes.iri IN (…candidates)`, joined through `ontology_modules.workspaceId`. The comparison is made under the column's collation.
3. **That is the same comparison the typed reads make.** They choose a class's objects with `kgNodes.classIri IN (…ontology IRIs)` (F42). So a node that the API and the app list as a vendor resolves to the vendor class, and is governed as one.
4. **Under the default `utf8mb4_0900_ai_ci`** (F42), `fin:VENDOR` and `fin:Véndor` resolve to `fin:Vendor`. Under a binary collation they resolve to nothing, and the typed reads do not list such nodes as vendors either.
5. **The rule depends on one precondition, which is checked:** `ontology_classes.iri`, `kg_nodes.classIri`, `class_governance.classIri` and `mappings.classIri` share one collation.
   - The migrations set none, so all four take the database default, but a deployment could alter one.
   - Once per process, before its first class resolution on a path that enforces governance, `governance.ts` reads the four columns' `COLLATION_NAME` from `information_schema.COLUMNS` for the current schema. Listings do not run the check (see "Shape of governance reads" below).
   - **If they differ,** class resolution throws `GovernanceUnavailable`, and the column names and collations are logged once. Every preview, submit, propose, adoption and approval then fails closed with 503 `governance_unavailable`, and nothing is applied ungoverned.
   - The check is lazy rather than at startup, because the server starts and reports health while the database may still be unreachable (`publicApiRoutes.ts:68-76`).
   - REFUSE-02m tests it.

A string that resolves to no ontology class is ungoverned. Admins can govern only ontology classes, and the typed reads list no objects under such a string.

**No variant class strings in new definitions and mappings.** A class string *resolves* to an ontology class when the rule above matches it. A variant is a string that resolves to an ontology class but is not exactly, by JS `===`, that class's `iri`.
- **Action types.** `createActionType` and `updateActionType` (`definitions.ts:74-180`) refuse a definition whose create `classIri`, or whose object parameter `classIri`, is a variant. The refusal is `DefinitionInvalid` with `class_variant` at that path, which the router maps to BAD_REQUEST (`actionsRouter.ts:70`). A class string that resolves to **no** ontology class, such as a `dtwin:` twin class, is still allowed, as today. It is ungoverned, and the typed reads list nothing under it.
- **Mappings.** `upsertMapping` selects the matched class's `iri` too (`mappingRouter.ts:237-241`). It refuses with BAD_REQUEST `class_variant` unless that `iri` `===` the input, because its SQL equality alone folds case and accents (F46). An unknown class is already refused (`mappingRouter.ts:242-244`).
- **Stored definitions and imported nodes** from before this rule keep working, and are governed through the resolution above.

**Adopting existing data: `createClass` (`ontologyRouter.ts:212-310`).** An unknown class string is allowed in definitions, so data can exist under it before any ontology class has that name. Editors may create classes (F34; `middleware.ts:135-144`). Each new class takes the IRI `<module prefix>:<label>` (`ontologyRouter.ts:244`), and its conflict check looks only at ontology classes (`:246-262`). Typed reads include descendants (F42). So creating that class under a governed parent would make the existing records appear as governed objects, though no one approved them. This is the laundering route.

To close it, `createClass` gains a check inside its transaction:
1. Ensure the governance-lock row (above), then take G exclusively. This makes concurrent applies, which re-resolve classes under G shared, take turns with the class's creation.
2. Compute the new class's governance from its parent's chain, which is fixed at creation (F34).
3. **If any ancestor is governed,** refuse with CONFLICT `class_would_adopt_data` when **any** of these already uses a class string that resolves to the new IRI:
   - **live nodes:** `kg_nodes.classIri IN (new IRI, its expanded form)`, compared under the column's collation, as the typed reads compare;
   - **current action definitions:** a create or object-parameter class string equal to the new IRI after expansion, Unicode NFD decomposition, removal of combining marks and case folding. That is a conservative superset of `utf8mb4_0900_ai_ci`'s folding, because a refusal may over-match but must not under-match.

   Mappings need no check: a mapping can name only an existing ontology class (`mappingRouter.ts:237-244`).
4. A class under an ungoverned parent, or with no parent, is created as today. If governance is set on an ancestor later, it governs the existing data from then on, which is the ordinary meaning of setting governance.

REFUSE-02l tests this. A workspace admin who wants to bring such records under a governed class must first deal with the records, for example by deleting them through an action. Ontos does not adopt them silently.

**Shape of governance reads.** Every query `governance.ts` makes for action listings (`listTypes`, `getType`, `GET /actions`) and for class resolution uses only:
- `col = ?`, `col = col`, `col IN (…)` and `col IS [NOT] NULL`;
- inner joins on an equality.

These are exactly what the test stand-in `memoryDb` evaluates (`app/api/__tests__/memoryDb.ts:1-18`). So existing tests that list action types on `memoryDb`, with no governance rows, read "no governance" (5.6 item 12).

The collation check (point 5) runs only on the paths that **enforce** governance: preview, submit, propose, adoption, approval and `createClass`. It does not run on listings, which only display governance. So listing tests never reach `information_schema`, and production code carries no test-only branch.

**Inheritance.** A class's governance is the strictest over the class and all its ancestors in the workspace ontology, through `ontology_classes.parentId`, as `classAncestors` walks it (`service.ts:131-150`).
- "Required" is stricter than "none", and "people only" is stricter than "allowed".
- No app path removes a class from under its parent (F34).
- A touched string's governance is the strictest over every ontology class it resolves to, and their ancestors.

**What a plan touches.** `planGovernance` is authoritative. It is computed inside `prepareSubmission` and stored as `Prepared.governance`. The touched classes are:
- the class of each created object;
- the **prior** class of each node a create would revive;
- the class of each modified or deleted object, taken from its snapshot;
- the class of the *from* object of each added or removed link;
- the class of the *from* object of each incoming link that a delete removes.

**A link's target is not touched.** A link is stored on its *from* object (`service.ts:483-489`), so adding or removing it changes only that object's statements. Data modelled as links *into* a governed object from another class (for example `fin:BankAccount —fin:accountOf→ fin:Vendor`) is governed only when the linking class is governed too. Admins govern such classes explicitly. The README says so (4.16), and 3.3 row 20 lists the residual.

The result has the form `{ approval, tokenAccess, classes: [{ classIri, approval, tokenAccess, via }] }`, where `via` is the governed class the setting comes from.

**What an action can reach.** `actionGovernance(definition)` is advisory. It takes the declared classes the rules can write:
- a create's class;
- the declared class of the object parameter, or of the created alias, that a modify, a delete or a link's *from* names.

Each is taken with its ancestors and its descendants. The result is used for four things only:
- `GET /actions` and the action listings;
- the token gate before `prepare` runs;
- grant refusal;
- the run panel's label.

It can over-state a plan (a descendant is governed, but the bound object is not) or under-state it (incoming links, revivals). **The plan's governance decides.**

**Where governance is enforced.**

| Path | Rule |
|---|---|
| **submit** (tRPC and `/api/v1`, inside `submitAction`) | If the caller is a token and the plan is people-only: refuse with `people_only`. This is checked first, so a token always learns `people_only` rather than `approval_required`. Otherwise, if the plan's approval is `required`: refuse with `approval_required`. Either way, no submission is written. The caller is a token when `SubmitterInfo.callerKind === 'token'`, which only `/api/v1`'s `submitterOf` sets (`publicApiRoutes.ts:101-104`). The session submitter object is unchanged (F41). |
| **Token preview and propose** | First the action's people-only reach is checked; then the plan's. |
| **propose** (session or token) | Any active action may be proposed. |
| **Adoption** | Governance read under the lock decides whether the change becomes pending or is applied. Approval becoming required during adoption makes it pending rather than refused (ACCEPT-12b). A people-only plan is refused. |
| **Approval** | Approval satisfies *approval required*. A **token-originated** proposal whose plan is now people-only is refused `people_only`, even though a person adopted it (REFUSE-16f). USER's "not queuing" covers queued drafts too. The governance is recorded. |

**Re-check inside the apply transaction.** This is specified here once. It is the first thing `applyInTx` does (4.5), for every transaction that applies a plan: direct submits, adoption applies and approvals.
1. Take the governance lock shared (above).
2. Read `class_governance` for the touched classes, as resolved, and their ancestors, with a locking read (FOR SHARE), so the latest committed rows are seen.
3. Recompute the governance.
4. **Direct submit or adoption apply:** if approval has become required, or the plan has become people-only for a token-originated change, raise `GovernanceChanged`. Nothing is applied, and the answer is `approval_required` or `people_only`. For an adoption, approval becoming required makes the draft pending instead (above).
5. **Approval of a token-originated proposal:** a plan that has become people-only raises `GovernanceChanged` with `people_only`.
6. Store the result as the submission's `governanceJson`.

`setClass` holds the governance lock exclusively for its whole transaction, so a governance change and an apply take turns whatever the isolation level (REFUSE-07d, 07e).

### 4.4 Proposals: lifecycle

| Status | Meaning | Who acts next |
|---|---|---|
| `draft` | A token proposed it | The token's creator: adopt or discard |
| `pending` | A person (the maker) submitted it | A person other than the maker: approve or decline. The maker: withdraw (recorded as a decline). |
| `applied`, `declined`, `discarded`, `withdrawn`, `expired` | Final | — |

**Session proposal (`actions.propose({ key, params, rationale })`).**
1. Strings must be well-formed, and the rationale 1–2,000 characters. Otherwise BAD_REQUEST.
2. Prepare with the session user at the request time (F9). A permission problem throws FORBIDDEN or BAD_REQUEST. Any other problem returns `{ ok: false, code, problems }`. **Neither is recorded** (3.6).
3. Check the bounds: `too_many_links`, `change_set_too_large`, `too_many_pending` (200, counted on the maker) and `duplicate_pending` (the same maker with the same `paramsDigest`).
4. Insert the proposal as `pending`, with:
   - `origin = session` and `forUserId = makerUserId` = the user;
   - `makerLabel` stored;
   - `effectiveAt` = the request time;
   - `makerChangeSetJson` and `makerHash`;
   - `expiresAt = now() + TTL`.
5. Write the audit entry.

**Token draft.** See 4.7. The draft records `forUserId` = the creator, and `draftedBy` and `draftChangeSetJson`, rendered at the request time with the token's label. Creating a draft writes **no audit-chain entry**: the proposals table is the record. Drafts are visible only to their creator.

**Adoption (`actions.adoptDraft({ id, shownHash })`, creator only).** The checks, in order:

| # | Check | Refusal |
|---|---|---|
| 1 | Decision limit | `rate_limited`, not audited |
| 2 | The draft exists and `forUserId` = the caller | NOT_FOUND |
| 3 | Status is `draft` | `already_decided` |
| 4 | Not expired | `expired`, and the status changes |
| 5 | The token is live by the **database clock** | `token_inactive` |
| 6 | The action is active, and at the draft's version | `action_inactive` / `action_changed`. A grant cannot fail here: grants are immutable and pinned to versions, so a version match implies the grant still holds. |
| 7 | The action's reach is not people-only | `people_only` |
| 8 | A view `(id, caller, shownHash)` exists | `not_opened` |
| 9 | The view's age, measured as the service's `now` minus `renderedAt`, is at most 24 hours | `view_stale` |
| 10 | Prepare with the creator as submitter, at `renderedAt`, with `{actor}` = the creator's label | `forbidden_role`, `forbidden_scope`, other problems |
| 11 | The plan is not people-only | `people_only` |
| 12 | Criteria evaluated again with `criteriaContext`, **with `now` replaced by the real `now`** | `criterion_failed` |
| 13 | A fresh change set has a hash equal to `shownHash` | `changed_since_opened` |
| 14 | When the plan needs approval, the creator is under the pending cap | `too_many_pending` |
| 15 | One transaction under `withDeadlockRetry` (`app/api/lib/mysqlErrors.ts:34`); steps below | as noted |

Check 15's transaction:
1. Take the governance lock shared and read governance with a locking read (4.3). People-only → `people_only`. The approval setting read here **decides** what happens in step 7: if approval became required since check 10, the draft becomes pending.
2. Lock `action_types` FOR SHARE: active, same version.
3. Lock `api_tokens` FOR SHARE: live by the database clock.
4. Lock the creator's `users` and `workspace_members` rows FOR SHARE: still permitted.
5. Lock the draft FOR UPDATE: still `draft`.
6. Check that `imports` is unchanged (4.5).
7. If approval is required: set status `pending`, with `makerUserId` = the creator, the stored `makerLabel`, `effectiveAt = renderedAt`, `makerChangeSetJson` and `makerHash`, `submittedAt`, and `expiresAt = now() + TTL`. Audit "Submitted for approval". Otherwise: `applyInTx` with origin `{ proposalId }`, and `submittedBy` = the creator; status `applied`; audit the application.

A `SubmissionConflict` returns to check 10 once.

**Bound on backdating.** An `effectiveAt` is at most 24 hours older than the moment the creator adopted the draft, and a pending proposal is decided within the TTL. So the `{today}` and `{now}` written into data predate the application by at most TTL + 1 day. The sheet shows `effectiveAt` and its age (4.12).

**Discard (`actions.discardDraft({ id })`).** Creator only. Subject to the decision limit. The status becomes `discarded`, with an audit entry.

**Revocation** (`tokens.ts:117-133`). Inside the revocation transaction, after locking the token row, every `draft` of that token becomes `withdrawn`, and the audit payload lists their ids. Revoking the token is the bulk discard. A pending proposal is not withdrawn, because it is its maker's.

### 4.5 The change set and its hash

`buildChangeSet(prep, { actor, effectiveAt }, imports)` (new, `app/api/services/proposals/changeSet.ts`) is a pure function. It returns plain JSON, as `auditRecord` does (`audit.ts:60-71`):

```
{
  action:   { key, version, displayName },
  context:  { actor, effectiveAt },
  params,
  governance: { approval, tokenAccess, classes: [ { classIri, approval, tokenAccess, via } ] },
  objects:  [ { iri, classIri, label, deleted, props, links: [ { predicate, toIri } ] } ],
  plan: {
    creates:     [ { iri, classIri, moduleKey, label, props,
                     revives: null | { classIri, moduleKey, label, props, sourceMappingId, sourceSubmissionId } } ],
    modifies:    [ { iri, label?: { from, to }, set: { k: { from, to } }, unset: { k: oldValue } } ],
    deletes:     [ { iri, label, incomingLinksRemoved: [ { fromIri, fromClassIri, predicate } ] } ],
    linkAdds:    [ { fromIri, predicate, toIri } ],
    linkRemoves: [ { fromIri, predicate, toIri } ]
  },
  sideEffects: [ { kind: "webhook", target } ],
  imports:     [ { iri, lastImportedByMappingId, classMappingIds: [ id ] } ]
}
```

**Where the data comes from.** `prepareSubmission` (`service.ts:289-357`) gains these reads, and `Prepared` gains the matching fields:
- `incomingRemoved`: live incoming links of each object the plan deletes, through `kg_edges_ws_to` (F36), with their ids and the *from* node's IRI and class.
- `revives`: soft-deleted nodes whose IRI a create would take, as `service.ts:419-423`, with their prior state.
- `linkCount`: the total live outgoing links of the named objects.
- `governance`: from 4.3.
- `criteriaContext`: the context `planEdits` returns (F9).

The proposals service loads `imports` only for change sets: each touched node's `sourceMappingId` (`schema.ts:431-434`), and mappings whose class matches a touched class, joined through `connectors.workspaceId` (`mappingRouter.ts:228-232`). The webhook `target` is `redactUrl(url)` from the pinned version's definition (`webhookView.ts:32-41`).

**Mapping names are not hashed.** The `imports` part holds mapping **ids** only. The sheet reads the names separately, so renaming a mapping does not invalidate open approvals.

**Order.** Every array except `sideEffects` is sorted in code-unit order:
- `objects`, `creates`, `modifies`, `deletes` and `imports` by `iri`;
- `links` and `incomingLinksRemoved` by `predicate`, then the other IRI;
- `linkAdds` and `linkRemoves` by `fromIri`, then `predicate`, then `toIri`;
- `classes` and `classMappingIds` by value.

Internal row ids are dropped. `sideEffects` keeps the definition's order.

**Hash.** `changeSetHash(cs) = sha256(canonicalize(cs))`, over the JSON that is stored.

**Refused change sets.**
- `too_many_links`: `linkCount` ≥ 5,000, or a deleted object has ≥ 5,000 incoming links.
- `change_set_too_large`: more than 512 KiB.

**Not hashed.** Criterion results and the SHACL report must pass but are not hashed.

**Rendering.**
- `{actor}` renders the maker's stored `makerLabel`. For a draft's informational change set, it renders the token's label.
- `{now}` and `{today}` render from `effectiveAt`.

**Differences.** `diffPaths(a, b)` returns at most 100 JSON paths whose values differ.

**`applyInTx`.** This is `applyPrepared`'s body (`service.ts:397-530`), extracted so it can run inside a caller's transaction. It stays in `service.ts`.

**For every caller,** direct submits included, it does the following in order:
1. the governance re-check (4.3);
2. locks the named objects FOR UPDATE, as today (`service.ts:404`), deleted ones included;
3. **then** reads the incoming links of deleted objects FOR UPDATE, and raises `SubmissionConflict` if their link ids differ from `Prepared.incomingRemoved`;
4. checks that the set of nodes it would revive equals `Prepared.revives`, and raises `SubmissionConflict` otherwise;
5. soft-deletes **only those incoming link ids**.

So a link from a governed object inserted after the plan was prepared is never removed unseen. The conflict re-plans once (F11), and the new plan's governance includes that object.

**For proposal applies** (`origin` present), it also:
- re-reads `imports` with locking reads (FOR SHARE), and raises `SubmissionConflict` if they differ;
- writes `proposalId`, `approvedBy*` and `changeSetHash` on the submission.

**No new write site on the graph's tables.** The id-only deletion changes the `where` clause of the existing incoming-and-outgoing link update (`service.ts:472-475`). It becomes `fromNodeId = d.id OR id IN (shown incoming ids)`, or `fromNodeId = d.id` alone when there are none. `service.ts` keeps exactly its 7 writes to the graph's tables. No new file writes them (`proposals/*.ts`, `governance.ts`, `class_governance` and `governance_locks` are not graph tables). `graphChangeWriters.test.ts` (F44) therefore passes unchanged.

`kg_edges.toNodeId` is a foreign key to the deleted node, which is locked (F36). InnoDB's foreign-key check therefore holds a new incoming link back until commit. That is documented InnoDB behaviour, UNVERIFIED in this repository. Deleting only the ids that were read makes the outcome safe either way.

### 4.6 Session paths for approval (tRPC)

Procedures live on `actionsRouter`, with service functions in `app/api/services/proposals/proposals.ts`. Service functions take an optional `now` for tests. The tRPC procedures do not expose it.

**`listProposals({ scope, status?, limit, cursor? })`.** `scope` is one of:
- `approvals`: pending proposals of others;
- `mine`: proposals the caller made;
- `drafts`: the caller's drafts.

Rows carry the action, `status` (with `expired` derived), `origin`, `draftedBy`, `makerLabel`, the rationale cut to 200 characters, `createdAt`, `expiresAt`, persona flags and the governing classes.

**`openProposal({ id })`.**
- NOT_FOUND for another workspace's proposal, or for someone else's draft.
- A proposal past `expiresAt` moves to `expired`, with an audit entry.
- **Pending:** prepare with the maker at `effectiveAt`, using `{actor}` = `makerLabel`. Build the change set and its hash. Insert the view `(id, caller, hash, renderedAt = effectiveAt)` when there are no problems. Return the change set with `maker: { changeSet, hash }`, `differences`, criteria, problems, persona flags, `effectiveAt` and its age, and `canApprove` with `cannotApproveBecause`. Those last two come from approval checks 3–12, including 10a, run with no side effects.
- **A draft, opened by its creator:** prepare with the creator at the request time. Build the change set. Insert the view with `renderedAt` = that time. Return it with `draft: { changeSet, hash }`, `differences` and `canAdopt`.

**`approveProposal({ id: number, shownHash })`.** One proposal per call. It returns `{ ok: true, submission, changeSetHash }` or `{ ok: false, code, … }`, and throws only NOT_FOUND. The checks, in order:

| # | Check | Refusal |
|---|---|---|
| 1 | The approvals limit | `rate_limited`, not audited. 503 if the limit cannot be checked. |
| 2 | The proposal exists in Q's workspace | NOT_FOUND |
| 3 | Status | `not_submitted` for a draft; `already_decided` otherwise |
| 4 | `expiresAt > now()` | `expired` |
| 5 | Q ≠ maker, checked before any role logic | `same_person` |
| 6 | A view `(id, Q, shownHash)` exists | `not_opened` |
| 7 | The action is active, at the proposal's version | `action_inactive` / `action_changed` |
| 8 | The maker's current membership and account role pass `checkSubmitter` | `maker_no_longer_permitted` |
| 9 | Q passes `checkSubmitter` | `forbidden_role` / `forbidden_scope` |
| 10 | Prepare with the maker at `effectiveAt` | the first problem's code; `too_many_links`; `change_set_too_large` |
| 10a | For a token-originated proposal, the plan is not people-only | `people_only` |
| 11 | Criteria evaluated with `criteriaContext`, **with `now` replaced by the real `now`** | `criterion_failed` |
| 12 | Hash equals `shownHash` | `changed_since_opened` |
| 13 | One transaction under `withDeadlockRetry`; steps below | as noted |

Check 13's transaction is a single call of `applyInTx` (4.5) with origin `{ proposalId, approvedBy: Q's label, approvedByUserId: Q.id, changeSetHash }`. It first makes the governance re-check, specified once in 4.3, which re-checks check 10a and records `governanceJson`. Between that re-check and its object locks, it takes:
1. `action_types` FOR SHARE (check 7);
2. the `users` and `workspace_members` rows of the maker and of Q, FOR SHARE (checks 8 and 9);
3. the proposal FOR UPDATE (checks 3 and 4).

It then applies the plan, with the submission's `submittedBy` and `userId` set to the maker's, updates the proposal, and writes the audit entry.

A `SubmissionConflict` returns to check 10 once (ACCEPT-09). Every refusal from checks 3–13 is audited as "Approval of proposal N refused: code". The approvals limit bounds how many a person can write.

**`declineProposal({ id, reason })`.**
- The decisions limit applies first: `rate_limited`, not audited.
- NOT_FOUND for another workspace's proposal.
- Q may decline when Q passes `checkSubmitter` for the action, or Q is the maker, which counts as a withdrawal. Otherwise `cannot_decline`, audited.
- One transaction: lock the proposal FOR UPDATE; it must be `pending`, or the answer is `already_decided`; set `declined`; write the audit entry.

**`exportSubmissions({ from, to })`.**
- Any member may call it, as with `listSubmissions` (`actionsRouter.ts:215-225`).
- `from` and `to` are UTC instants, half-open, at most 366 days apart.
- At most 10,000 rows, with `truncated` set when there were more.

| Column | Value |
|---|---|
| `submission_id`, `at`, `action_key`, `action_version`, `status` | From the submission row |
| `responsible_person` | The person in session (`submittedBy`) for a person's submission; for a token's submission, the token's creator, read from `users` through `action_submissions.userId` (F6); empty when the token has no creator |
| `started_by` | `submittedBy` as stored: a person, or a token label |
| `drafted_by_token_id`, `drafted_by_token_prefix`, `drafted_by_token_name` | Separate columns |
| `signed_off_by`, `signed_off_at` | **Empty unless a second person approved it** (`approvedBy`, and the proposal's `decidedAt`) |
| `opened_at` | The approver's earliest view with that hash |
| `governance_at_apply` | From `governanceJson`: `approval required`, `none`, or `unknown` for rows from before this cycle |
| `maker_persona`, `approver_persona` | Persona flags |
| `proposal_id`, `change_set_hash`, `rationale`, `source_ref` | |

Every string cell is written through `toCsv` (4.12).

### 4.7 Token paths (`/api/v1`)

**For every caller, additive changes only:**
- `GET /actions` items gain `approval`, `tokenAccess` and `canPropose`, from `actionGovernance`. This is loaded through `app/api/services/proposals/governance.ts`, not added to the ontology model, so the model's version hash is unchanged (F29).
- `/openapi.json` and `/sdk.ts` describe the new paths.

Every other existing response is unchanged until an admin governs a class or a creator narrows a token.

**`GET /actions`:**
- With grants, only granted action types are listed.
- `canSubmit` is false, with a reason, when the token is draft-only, the action's reach is people-only, its approval is required, or it is not granted.

**`POST /actions/{key}/preview`.** After `readAction` (`:124-141`), for a token:
1. If the action's reach is people-only, answer 403 `people_only`.
2. If the key is not granted, answer 403 `not_granted`, or `grant_outdated` when granted at another version.
3. Run prepare. If the plan is people-only, answer 403 `people_only`.
4. Otherwise the response is today's.

Permission problems keep today's answer, 200 with problems, and are recorded (4.10).

**`POST /actions/{key}/submit`.** After `readAction`, for a token:
1. Static `people_only`.
2. `propose_only`.
3. Grants.
4. `submitAction` with `callerKind: 'token'`, which applies the plan's governance (4.3).

Every refusal is recorded (4.10).

**`POST /actions/{key}/propose`** (new; a token with the `actions` scope; a session gets today's 401 `token_required`, `publicApiRoutes.ts:78-84`). The steps:
1. Token propose limit: 429 `rate_limited`.
2. `readAction`: 404 for a malformed key, 400 `invalid_json` (`:131`), 400 `invalid_body` (`:133-136`).
3. Body: every string is `isWellFormedText`, the rationale 1–2,000 characters, the source reference at most 512 characters. Otherwise 400 `invalid_body`.
4. `creator_required` (403).
5. `not_found` (404, for a well-formed key).
6. Static `people_only`.
7. Grants.
8. Prepare with the token principal. A permission problem → 403. The plan's `people_only` → 403. Any other problem → **200** `{ proposal: null, refusal: { id, problems } }`.
9. `too_many_links`, `change_set_too_large` (400).
10. `too_many_drafts` (429): 50 per token, 200 per creator.
11. `duplicate_pending` (409): one of the creator's drafts or pending proposals has the same `paramsDigest`.
12. Insert the draft. Answer **201** `{ proposal: ProposalView }`.

**`GET /proposals`** and **`GET /proposals/{id}`** (new, tokens only). They show the calling token's own proposals. Another token's proposal, or another workspace's, answers 404.

**`ProposalView`** is `{ id, actionKey, actionVersion, status, params, rationale, sourceRef, changes, createdAt, expiresAt, decidedAt, declineReason, submissionId }`.
- `changes` is `summarisePlan(plan)`, exactly what `preview` returns today (`service.ts:377-385`).
- **It carries no change set, no hash, no `revives`, no `imports`, no `objects`, no `sideEffects`, and no maker or approver identity** (REFUSE-22). A token learns nothing that `preview` does not already tell it.
- `GET /submissions/{id}` keeps its view (`publicApiRoutes.ts:106-118`), which has no `approvedBy`.

**No route** on `/api/v1` adopts, discards, approves or declines. Such calls fall through to the catch-all 404 (`:302`).

**OpenAPI and SDK.** `buildOpenApi` adds `/actions/{key}/propose` per active action type (`openapi.ts:254-258`), `/proposals` and `/proposals/{id}`. The SDK adds `actions.propose`, `proposals.list` and `proposals.get`.

### 4.8 Token options, the principal, and creation

**Creation** (`createToken`, `tokens.ts:57-107`; `developer.createToken`, `developerRouter.ts:45-66`).
- New optional inputs: `actionGrants: string[] | null` and `proposeOnly: boolean`. The form sends them only when they are set.
- `TokenCreator` is **unchanged** (F41).
- The checks run **after** the existing role and scope checks (`tokens.ts:64-71`), so the existing refusals still come before any database access (`developerRouter.test.ts:91-95`):

| Order | Check | Code |
|---|---|---|
| a | The name is one line of printable characters (Unicode categories L, N, P, S and Zs only) | `invalid_name` |
| b | The creator has fewer than 25 live tokens in the workspace. Revoked and expired tokens do not count. | `too_many_tokens` |
| c | When `actionGrants` is given: the list is not empty | `no_grants` |
| d | At most 20 distinct keys | `too_many_grants` |
| e | Each key names an action | `grant_unknown` |
| f | The action is active | `grant_inactive` |
| g | The action's reach is not people-only | `grant_people_only` |
| h | `createToken` reads the creator's membership itself (role and module scope), and the creator, as well as the token's role and scope, passes `checkSubmitter` | `grant_forbidden` |

  Grants are stored deduplicated, sorted and pinned to the current versions. The audit payload adds `actionGrants` and `proposeOnly`.
- **Principal** (`principal.ts:27-40`) gains an optional `token?: { id, creatorUserId, grants, proposeOnly }`. A row whose `actionGrantsJson` is malformed is refused 401 `invalid_token`.

### 4.9 What is refused

| Code | Where | Answer | Recorded (4.10) | In the audit chain |
|---|---|---|---|---|
| `approval_required` | submit, any caller | 403 / FORBIDDEN | tokens: yes | no |
| `people_only` | token preview, propose, submit; adoption; approval of a token-originated proposal | 403; `ok:false` | tokens: yes | adoption and approval: yes |
| `class_variant` | `createType` and `updateType`, for a class string that resolves to an ontology class but is not exactly it; `upsertMapping`, likewise | BAD_REQUEST | no | no |
| `class_would_adopt_data` | `createClass` under a governed ancestor, when live nodes or current action definitions already use the new class's IRI | CONFLICT | no | no |
| `governance_unavailable` | every path that enforces governance, when the class columns' collations differ | 503 | no | no |
| `propose_only`; `not_granted`; `grant_outdated` | token preview, propose, submit | 403 | yes | no |
| `forbidden_role`, `forbidden_scope`, `action_inactive` | token write paths; session submit and propose; approval; adoption | 403/400/200 (preview); FORBIDDEN; `ok:false` | tokens: yes | approval and adoption: yes |
| `not_found` (well-formed key) | token preview, propose, submit | 404 | yes | no |
| `creator_required`, `too_many_drafts`, `duplicate_pending`, `too_many_links`, `change_set_too_large` | token propose | 403/429/409/400 | yes | no |
| check problems | token propose | 200 with `refusal` | yes (stage `checks`) | no |
| `rate_limited`, `invalid_json`, `invalid_body`, a malformed key, authentication failures | | 429/400/404/401/503 | no | no |
| `not_submitted`, `already_decided`, `expired`, `same_person`, `not_opened`, `view_stale`, `maker_no_longer_permitted`, `action_changed`, `criterion_failed`, `changed_since_opened`, `token_inactive`, `cannot_decline`, `too_many_pending` | approve, adopt, decline (people) | `ok:false` | no | yes |
| token creation codes (4.8) | token creation | FORBIDDEN | no | no |

### 4.10 Token refusal records

**Scope: tokens only.** A refusal on a token write path (`preview`, `propose`, `submit`) is recorded for the codes in 4.9. Exactly these are **not** recorded:
- authentication failures;
- `rate_limited`;
- `invalid_json`, `invalid_body` and malformed keys;
- check problems found by `preview`;
- every refusal of a **signed-in person** (section 7).

**Never silent.**
- The refusal is answered only after its record is written. If the write fails, the answer is 503.
- Parameters are stored only if every string is well-formed and the canonical JSON is at most 4 KiB. Otherwise `paramsJson` is NULL and `paramsUnstorable` is true.
- The digest, `sha256(canonicalize(params))`, is always computable.
- Problem messages can echo caller input (`engine.ts:143,219,221`), so each is passed through `sanitiseText(message, 300)` before it is stored.

**Bounded without hiding a probe.**
- For each (`tokenId`, `actionKey`, `code`), the first 20 refusals in an hour (database clock) are itemised. After that, `action_refusal_overflow.suppressed` for that same `actionKey` and `code` is incremented.
- For codes other than `not_found`, `actionKey` names an existing action type, so the number of combinations is bounded. Junk keys cannot hide a probe of a people-only or ungranted action: that probe keeps its own itemised budget, and its overflow keeps the action and the code.
- `not_found` has its own budget: 100 itemised per token per hour, with the keys recorded, then counted under `('*', 'not_found')`.

**No audit-chain entry** (F22). Refusal records carry no tamper evidence (6, Q16).

### 4.11 Audit and observability

`writeAudit` (`audit.ts:98-132`) does not cut long action strings, and existing callers can exceed 255 characters (`actionsRouter.ts:160`, `service.ts:508`, `definitions.ts:170`; `schema.ts:522`). Whether MySQL rejects them depends on `sql_mode`, which this repository does not set (UNVERIFIED). **New action strings are cut to 255 characters**, and every string in new audit payloads passes through `sanitiseText`.

| Event | Actor | `entityType` | Payload adds |
|---|---|---|---|
| Class governance set | admin | `class_governance` / classIri | `{ classIri, approval, tokenAccess }`, each as from → to |
| Token created or revoked | existing | `api_token` | `actionGrants`, `proposeOnly`; `withdrawnDraftIds` |
| Session proposal; draft submitted for approval | maker | `action_proposal` | `{ origin, tokenId, actionKey, version, params, changeSetHash, governance, rationaleDigest, makerIsPersona }`. **The rationale text is not in the chain.** |
| Draft discarded | creator | `action_proposal` | `{ tokenId }` |
| Applied from a proposal | approver, or the creator for an ungoverned adoption | `action_submission` | `service.ts:511`, plus `{ proposalId, draftedByTokenId, makerUserId, approvedByUserId, changeSetHash, changeSet, governance, personaFlags }` |
| Approval, adoption or decline refused | that person | `action_proposal` | `{ code, problems? }` |
| Declined; expired | the person | `action_proposal` | `{ reason }`; `{ expiresAt }` |

The Developers page shows each token's counts and its 50 most recent refusals.

### 4.12 UI

**`SafeText`** (new). Every string that comes from an agent, a person or the graph is rendered through it, never as HTML. That covers the rationale, the source reference, parameter values, labels, property values, IRIs, token names, and the maker's and approver's labels.
- It makes these characters visible as a distinct `⟨U+XXXX⟩` marker: Cc characters other than `\n` and `\t`, and every Cf character, including U+061C, U+200B–200F, U+202A–202E, U+2060–2064, U+2066–2069 and U+FEFF.
- It adds a "mixed scripts" badge to text that mixes letters of more than one of Latin, Cyrillic, Greek, Armenian and Cherokee (`\p{Script=…}`).
- It never uses `dangerouslySetInnerHTML`.

**Leaf rendering.** `null` renders as "—" with the title "empty". Booleans render as `true` or `false`. Numbers render as their JSON text. Strings go through `SafeText`.

**Actions page:** sections for Approvals, My drafts and My proposals. **List rows have no checkbox, no "select all", and no approve control.**

**`ProposalSheet`** renders, in this order:
1. The action and version, the status, the drafting token (prefix and name), the maker, and **`effectiveAt` with its age** ("rendered as of … (3 days ago)").
2. A **persona banner** when persona sign-in is on.
3. **"Why this needs approval":** the governed classes, and the class each inherits from (`via`).
4. **"What the requester said (not verified)":** the rationale, in `data-testid="proposal-rationale"`.
5. **"As it is now":** every named object, with all its properties and links.
6. **"What will change":** every leaf of the change set. That includes:
   - every revive, with the prior class, the prior properties and the provenance that will be overwritten;
   - incoming links removed;
   - webhook targets;
   - import warnings, with mapping names read separately.
7. **"Changed since it was submitted"** (or since the token drafted it).
8. Criteria and problems.
9. "Change set" followed by the first 12 hex characters of the hash.

The sheet offers Approve (only when `canApprove`; otherwise it shows the reason) and Decline (which needs a reason) to approvers; Withdraw to makers; and Submit for approval or Apply, and Discard, to a draft's creator. On `changed_since_opened` the sheet reloads. There is no approve-and-next action and no keyboard shortcut for approving.

**Run panel.** When the preview's governance needs approval, the button reads "Submit for approval", needs a reason, and calls `actions.propose`.

**Ontology Studio, class detail.** Admins see "Changes need approval" and "API tokens: allowed / people only". Everyone else sees the values. The UI is in PR 3; until then the setter is reachable through tRPC only.

**`SubmissionDetail` and `SubmissionHistory`.** These show the drafting token, the maker, the approver, the responsible person, the persona flags, the governance at apply, and the hash.

**Export.** "Download CSV" uses `toCsv` (new, `app/src/lib/csv.ts`):
- RFC 4180 quoting;
- a `'` prefix on every **string** cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return;
- the same `⟨U+XXXX⟩` markers as `SafeText` for Cc characters (other than `\n` and `\t`) and Cf characters;
- numbers written as numbers.

A notice says when the export was truncated.

**Developers page.**
- "Limit to these actions", from a new `developer.grantableActions` query that gives a reason for each action that cannot be granted.
- "Can only draft; never applies".
- A **"For an AI agent or other automated tool"** preset. It sets the scopes to read and actions, ticks draft-only, requires at least one action, and offers expiry of 7, 30 or 90 days with 30 preselected and no "Never" (today's form offers "Never", `Developers.tsx:26-31`).
- Per-token counts and refusals.

### 4.13 Failure modes

| Failure | Behaviour |
|---|---|
| Database unavailable | `/api/v1` answers 503 with `retry-after` (`publicApiRoutes.ts:68-76,304-311`). A token refusal that cannot be recorded answers 503. A limit that cannot be checked answers 503. |
| Engine unavailable, for an action checked against SHACL on a class with shapes | Prepare adds `shacl_unavailable` (`service.ts:346-355`). Propose returns it as a check problem. Approval and adoption are refused. Nothing is applied unchecked (REFUSE-13). |
| Approve races decline | Row lock FOR UPDATE: one wins (REFUSE-09d). |
| Governance, action status or version, or membership changes while a plan waits to apply | Re-checked under locks in the apply transaction (REFUSE-07b–e, REFUSE-19l). |
| A governance change runs at the same time as audit writes | `setClass` takes only the governance lock, never a `workspaces` row, so it cannot deadlock with an audit append (4.3; REFUSE-07e). |
| First applies after a re-seed, when no governance-lock row exists | The row is inserted by an autocommit statement before any transaction, so no transaction gap-locks a missing row (4.3; REFUSE-07f). |
| The class columns' collations differ | Every path that enforces governance fails closed with 503 `governance_unavailable` (4.3; REFUSE-02m). |
| Revocation races adoption | The token row lock serialises them: adoption answers `token_inactive` (REFUSE-19m). |
| An incoming link to a deleted object, inserted concurrently | Held back by the foreign-key check on the locked node. In any case only the incoming link ids read at prepare are deleted, for every caller (4.5). |
| Deadlock | `withDeadlockRetry`. |
| A looping token | 60 proposals a minute; 50 drafts per token and 200 per creator; no duplicates; bounded refusal records; no audit-chain appends. |

### 4.14 Normative rules that no test checks (normative, untested)

- **The deadlock retry** around approval, adoption and governance changes.
- **Deadlock freedom in general.** The lock orders are written out in 4.3, and the argument is given there. Two cases are tested deterministically: `setClass` against an audit append (REFUSE-07e), and two first users of a missing governance-lock row (REFUSE-07f). Both deadlocked under earlier revisions. Every other pairing rests on the written order alone.
- **The concurrent-insert path for incoming links (4.5).** On CI's server, the REPEATABLE READ default (UNVERIFIED that CI uses the default) already blocks such inserts with next-key locks, so a break that removes the node lock would not fail any test there. The protection relies on InnoDB's foreign-key locking and on deleting by link id. The id-only deletion itself is tested by REFUSE-06c.
- **The window** between `applyInTx`'s locking re-read of `imports` and its commit, in which a mapping inserted under READ COMMITTED would go unseen.
- **The token-path calls of `too_many_links` and `change_set_too_large`,** and the same checks at approval check 10. The function they call is the one the session path's tests exercise (REFUSE-12d–f).
- **Adoption's in-transaction re-checks of the creator's membership (step 15.4) and of `imports` (15.6).** They use the same code as approval's membership re-check (REFUSE-07c) and imports check (REFUSE-06e), but are not raced separately.
- **The collation check against a real server whose columns differ.** REFUSE-02m stubs the `information_schema` result, and CI's server has one collation. The check is tested; a real mismatched deployment is not.
- **The race between `createClass` and a concurrent apply that creates a node under the new IRI.** It is closed by both taking the governance lock (4.3), but it is not raced in a test. REFUSE-02l tests the check itself.
- **The conservative folding of definition class strings in `createClass`'s check** (NFD, combining marks removed, case folded). It is tested only for case and accent variants, not against every `utf8mb4_0900_ai_ci` equivalence.
- The wording of audit action strings, beyond the code and `entityType` that tests assert.
- How the Developers page shows its counts.
- The order of sections on the proposal sheet, the "Change set" label, and the absence of a keyboard shortcut for approving.
- Whether the overflow counts are accurate under concurrency (they are approximate).
- README and `landscape.ts` text, and indexes.

### 4.15 Files and delivery: three pull requests, each green on CI and the Gate

Each pull request's tests use only code from that pull request and earlier ones.

**PR 1: governance of classes and approval of changes, for people.**
- Code and schema:
  - `schema.ts` and `0013_governance_and_proposals`;
  - `env.ts`, `compose.yaml` and both `.env.example` files;
  - `service.ts`: the prepare reads, `Prepared` fields, `submitAction` governance, `callerKind`, and `applyInTx`. That covers the governance re-check, the incoming-link and revive checks for every caller, and the id-only deletion at the existing write site. The file keeps 7 graph writes (F44).
  - new under `app/api/services/proposals/`: `governance.ts` (class resolution, the lock, `planGovernance`, `actionGovernance`), `changeSet.ts`, `proposals.ts`, `text.ts` (`isWellFormedText`, `sanitiseText`);
  - a new `governanceRouter` (or procedures on `ontologyRouter`): `setClass`, `list`, `capabilities`;
  - `definitions.ts`: `createActionType` and `updateActionType` refuse variant class strings;
  - `mappingRouter.ts`: `upsertMapping` refuses variant class strings;
  - `ontologyRouter.ts`: `createClass` ensures and takes the governance lock, and refuses `class_would_adopt_data` under a governed ancestor. It adds reads only, so the file keeps its 4 graph writes (F44);
  - `actionsRouter.ts`: `listTypes` and `getType` governance fields, `propose`, `listProposals`, `openProposal`, `approveProposal`, `declineProposal`, `exportSubmissions`, and the preview's `governance` field;
  - `publicApiRoutes.ts`: `GET /actions` governance fields; submit through `callerKind: 'token'`.
- README updates.
- Tests: **ACCEPT-01 first**, then REFUSE-01 to 14, ACCEPT-02 to 10, and GUARD-01 to 04 in their PR 1 form.

**PR 2: token controls and drafts.**
- Code and schema:
  - `schema.ts` and `0014_token_controls`;
  - `tokens.ts`; `principal.ts`; `developerRouter.ts`, with `grantableActions`;
  - `publicApiRoutes.ts`: gates, propose, proposals;
  - `actionsRouter.ts`: `adoptDraft`, `discardDraft`;
  - `setClass` gains `tokenAccess`;
  - `app/api/services/proposals/refusals.ts`;
  - `openapi.ts`, `sdk.ts`.
- README updates.
- Tests: **ACCEPT-11 first**, then REFUSE-15 to 22, ACCEPT-12 to 15, and GUARD-04 extended.

**PR 3: interface.**
- Code:
  - `Actions.tsx`; new `ProposalSheet.tsx`, `ChangeSetView.tsx`, `ProposalQueue.tsx` and `SafeText.tsx`;
  - the run panel; the Studio class detail;
  - `SubmissionDetail.tsx`, `SubmissionHistory.tsx`;
  - `Developers.tsx`;
  - `csv.ts`;
  - `app/e2e/approvals.spec.ts`.
- README UI notes and `landscape.ts`.
- Tests: **ACCEPT-16 first**, then REFUSE-23, REFUSE-24, ACCEPT-17 and ACCEPT-18.

### 4.16 Documentation (in the pull request that changes the behaviour)

**README:**
- "Ontology API": the new paths and token options.
- "Action types": class governance.
- "Security": the controls, and the residuals of 3.3.
- The architecture diagram (`README.md:58-76`) gains "AI agent or script (outside Ontos)" calling `/api/v1`.
- "Known limitations" gains:
  - Ontos cannot tell an agent from a script;
  - persona sign-in and shared accounts defeat segregation of duties;
  - imports and telemetry write governed classes, and can overwrite approved changes;
  - governance is per class, and a link is governed by the class of its *from* object, so data linked *into* a governed object needs its own governed class;
  - class strings are compared as the database compares them;
  - there is no approval matrix;
  - reads are not narrowed;
  - refusal records carry no tamper evidence.

**`landscape.ts:264-267`, "AI on the ontology":** "Agents and scripts read through /api/v1 and draft changes that a person adopts; changes to governed classes are applied only when a different person approves the exact change. No agent-facing server yet." Status stays `partial`.

---

## 5. Test contract

### 5.1 How every test runs

**T1. Commands.** Run all of these from `app/`.

| Layer | Command | In CI |
|---|---|---|
| Unit, router, render | `npm test` | verify job (`ci.yml:57-63`) |
| MySQL | `npm run test:mysql` | mysql job, sessions at +05:00 (`ci.yml:79-81,135-144`) |
| Browser | `npm run test:e2e` | e2e job (`ci.yml:238-308`) |

**Running locally.**
- Run this cycle's unit files by path: `$env:DOTENV_CONFIG_PATH='does-not-exist.env'; npx vitest run <files>`.
- Run its MySQL files the same way, with the same variable set: `$env:DOTENV_CONFIG_PATH='does-not-exist.env'; npx vitest run --config vitest.mysql.config.ts <files>`. The default config excludes them (`vitest.config.ts:28`).
- `does-not-exist.env` matters in both cases, because `env.ts:1` loads `app/.env`:
  - in unit runs, a local file must not give the refusal-recording code a working database, which would hide fixture gaps;
  - in MySQL runs, a local `ENGINE_HOST_URL` must not send REFUSE-13's SHACL check to a hosted engine (`app/api/services/workspaceGraph.ts:220-237`).
- **Full-suite results come from CI only.** `semanticEngine.test.ts` can use port 8085 (F18). Running by path is for safety; CI runs everything.

Every MySQL test file calls `emptyDatabase` in `beforeEach`. That also empties `rate_limit_windows` (`app/api/__tests__/mysql/database.ts:48-60`).

Every result is reported with its command, exit code, and pass, fail and skip counts as printed.

**T2. Integration first.** ACCEPT-01 is written first in PR 1, ACCEPT-11 in PR 2, and ACCEPT-16 in PR 3. Each is seen failing because the feature is missing before its code is written.

**T3. No real engine.**
- Fixtures use `validation.shacl: false`, except REFUSE-13.
- REFUSE-13 mocks `semanticEngine` as `ontologyRouter.test.ts:46` does. Its mock's `exclusive` runs the task, `checkLoaded` returns the result of its second argument, `loadSubjects` returns `{ triplesLoaded: 1 }`, and `validateShacl` returns a conforming report, unless the case says the engine is unavailable.
- REFUSE-13 sets `ENGINE_HOST_URL` to empty with `vi.stubEnv` in `vi.hoisted`, before any import. `workspaceGraphs()` then returns null (`workspaceGraph.ts:222-224`), and `checkShacl` uses the mocked engine (`service.ts:180-181`).

**T4. Clocks and dates.**
- The effective time and the approval time come from service-function `now` parameters.
- Expiry is produced by setting `expiresAt` in the past with SQL, so it is judged on the database clock.
- tRPC and the token routes use the real clock, so every fixture date they compare with `{today}` is far in the future.

**T5. Caches.** A test calls `ontologyModels.forget(workspaceId)` (`publicApiRoutes.ts:49-52`) after changing action types.

**T6. Fail first.** A refusal test counts only after it has failed against its named deliberate break.
1. Apply the break in a scratch worktree, never committed.
2. Run the test.
3. Record the command, exit code, counts and failing assertion in a `docs/DECISIONS.md` entry.
4. Revert the break.
5. Show the test passing on the real code.

A break that fails nothing is a finding. REFUSE-20c's break may not fail if MySQL accepts an unpaired surrogate. That is then recorded as a finding, and the rule stays.

**T7. Races.**
1. A second raw `mysql2` connection (`database.ts:51`) holds the named row lock.
2. Start the service call without awaiting it.
3. Poll every 20 ms until **either** a transaction in `information_schema.innodb_trx` is in `LOCK WAIT`, **or** the call has settled, for at most 10 seconds.
4. The raw connection makes its change and commits, or rolls back where the case says so.
5. Await the call and assert the outcome.

Under a break that drops the lock, the call settles without waiting. The test then fails on its outcome assertion, not by timing out.

### 5.2 Shared fixtures (MySQL and router)

- **Workspaces:** `W`, and `W2` for isolation.
- **Modules:** `legal` (`lgl`), `finance` (`fin`) and `hr`.
- **Classes:**
  - `lgl:Agreement`;
  - `lgl:Contract`, a subclass of `lgl:Agreement`, with a `shaclJson` constraint that `lgl:endDate` has `minCount 1`, used only by REFUSE-13;
  - `lgl:Party`, `lgl:Matter`, `fin:Vendor`, `hr:Person`.
- **People in W:**

  | Person | Role | Note |
  |---|---|---|
  | P | editor | |
  | M | editor | |
  | Q | editor | |
  | Q2 | editor | |
  | E | editor | holds token T0 |
  | O | ontologist | |
  | R | viewer | |
  | S | editor | scoped to `hr` |
  | A | workspace admin | |
  | X | editor | `users.role = 'admin'` (platform administrator) |
  | D | editor | a persona account (`auth/service.ts:278`); used by ACCEPT-04 |

  `Q-W2` is an editor in W2 only.
- **Action types** (all `validation.shacl: false` except as noted):
  - `renew-contract`, as seeded (`seed.ts:341-369`).
  - `close-matter`: params `matter`; criterion `{matter.status} eq open`; rule modifies `matter` to `{ status: "closed", closedOn: "{today}", closedBy: "{actor}", closedAt: "{now}" }`.
  - `drop-matter`: deletes `matter`.
  - `open-matter`: creates `lgl:Matter/{matterNo}`.
  - `set-remit-to`: modifies `fin:Vendor` `remitTo`.
  - `notify-renewal`: renew plus one webhook, `https://hooks.vendor.example/x`.
  - `checked-renewal`: renew with SHACL `true`.
  - **For the acceptance tests**, created in setup by O through `createActionType`:
    - `drop-party` (deletes an `lgl:Party`);
    - `annotate-agreement` (object parameter declared `lgl:Agreement`; modifies its `note`).

    REFUSE-02 creates its own action types after the governance is set, because that order is what it tests.
- **Classes added in setup for the acceptance tests:** `lgl:FrameworkContract`, a subclass of `lgl:Contract` (`createClass`), with object `lgl:FrameworkContract/F-1`, inserted with SQL.
- **Objects:**
  - `lgl:Contract/C-1`: `{ status: "active", endDate: "2096-12-31", value: 100000 }`, with a link `C-1 —lgl:withParty→ lgl:Party/PTY-1`;
  - `lgl:Contract/C-2`: `{ status: "active", endDate: "2096-06-30" }`, with a link `C-2 —lgl:concerns→ MT-1`;
  - `lgl:Matter/MT-1`, `lgl:Matter/MT-2`, `lgl:Matter/MT-3`: each `{ status: "open" }`. MT-3 has an incoming link `fin:Vendor/V-1 —fin:concerns→ MT-3`.
  - `lgl:Party/PTY-1`;
  - `fin:Vendor/V-1`: `{ remitTo: "on file" }`.
- **Governance:** A sets `lgl:Contract` to approval *required* in setup. PR 2's tests add `fin:Vendor`: people-only with approval required.
- **Tokens:**
  - **T0** (PR 1 and 2): E's standard token, role editor, read and actions, no options.
  - **T** (PR 2): P's token, role editor, read and actions, grants `renew-contract` and `close-matter`, draft-only.
- **π:** P proposes `renew-contract` **through the service** at `now = 2026-11-02T10:00:00.000Z`, with `{ contract: "lgl:Contract/C-1", newEndDate: "2097-12-31", value: 104000 }` and the rationale "Supplier email renews at four percent up; matched to C-1 by contract number."

### 5.3 Guards (no break needed)

**GUARD-01. Migrations.**
- `0013`, then `0014`, are in the journal with their RELEASED hashes.
- `migrations.mysql.test.ts` builds `schema.ts` and runs again as a no-op.
- CI's drift check passes.

**GUARD-02. No existing test is weakened.** CI's full suite passes. The only edits to existing test files are those in 5.6.

**GUARD-03. No real engine.**
- No new test starts an engine or uses `privateEngine`.
- In ACCEPT-01, a `vi.mock` of `semanticEngine` asserts that `ensureEngineRunning` and `validateShacl` are never called.

**GUARD-04. Tokens reach nothing outside `/api/v1`.**
- **Layer:** a new file, `app/api/__tests__/tokenReach.test.ts`. It imports the boot app with the semantic engine and IoT ingestion mocked, as `bootRoutes.test.ts:44-45` does. It does **not** mock `auth/service` or `workspaceGuard`. `bootRoutes.test.ts:53-63` mocks both and would authenticate the request. A request with no cookie is refused before any database read (F37).
- **Requests**, with only `Authorization: Bearer <T0>`:
  - tRPC `actions.submit`, `actions.approveProposal` and `mapping.runSync` answer unauthenticated;
  - `POST /api/sparql` answers 401;
  - `POST /api/iot/telemetry` answers 401 with `IOT_WEBHOOK_API_KEY` set to another value.
- **PR 2 adds** `actions.adoptDraft` and `actions.discardDraft`.

### 5.4 Refusal tests

Wherever something changes after a person opens a proposal, **the person opens it first**, and the change follows.

**PR 1**

**REFUSE-01. Only admins govern classes. Changes are audited and serialised.** *Layer:* router and MySQL.
- *Cases:*
  - a: O and Q call `setClass` → FORBIDDEN.
  - b: A governs `lgl:Matter` → one audit entry with the old and new values.
  - c: an unknown class, or a case variant of a known one (`lgl:MATTER`) → NOT_FOUND. Governance is set only on exact ontology classes.
- *Breaks:* (a) `setClass` built on the ontologist procedure; (b) no audit entry written; (c) the class looked up with the database's folding equality instead of an exact match.

**REFUSE-02. Governance follows the data, not the action type.** *Layer:* MySQL.
- *Setup:* `lgl:Contract` is approval required, set by A.
- *Cases:* every one of these is refused `approval_required` (session FORBIDDEN, token 403), and the object is unchanged.
  - a: **the sibling-action attack.** O, who is not an admin, creates `extend-contract`, **active at creation**, with the display name "Renew contract" and a rule writing `endDate`. P submits it on C-1 through tRPC. T0 submits it through `/api/v1`.
  - b: O updates the ungoverned `close-matter`, adding a `contract` parameter (`lgl:Contract`) and a rule writing it. P submits it with MT-1 and C-1.
  - c: O creates `drop-party`, which deletes an `lgl:Party` (ungoverned). P submits it on PTY-1. The incoming link from C-1 is stored on governed C-1.
  - d: a soft-deleted node `lgl:Contract/C-9` is inserted with SQL. O creates `open-thing`, which creates `{iri}` as `lgl:Matter`. P submits it with `iri = lgl:Contract/C-9`, which would revive a governed node.
  - e: O creates `annotate-agreement`, whose object parameter is declared as the superclass `lgl:Agreement`. P binds C-1.
  - f: an editor creates `lgl:FrameworkContract` under `lgl:Contract` (`createClass`), and its object F-1 is inserted with SQL. P submits `annotate-agreement` on F-1. The governance is inherited.
  - g: **new definitions and mappings may not use a variant.** O's `createType` and `updateType`, with a create class or object parameter class of `lgl:CONTRACT`, `lgl:Contráct` or the expanded spelling of `lgl:Contract`, are refused BAD_REQUEST `class_variant`. An editor's `upsertMapping` with class `lgl:CONTRACT` is refused BAD_REQUEST `class_variant`. A definition naming `dtwin:Sensor`, which resolves to nothing, is accepted.
  - h: **definitions and nodes stored before that rule are governed by resolution.**
    - *Inserted with SQL:* three action types, each creating `lgl:Contract/{no}`, with create classes `lgl:CONTRACT`, `lgl:Contráct` and the expanded spelling; an action type `old-touch-case`, whose object parameter is declared `lgl:CONTRACT` and which modifies `note`; and probe nodes `lgl:Contract/C-7` of class `lgl:CONTRACT` and `lgl:Contract/C-8` of class `lgl:Contráct`.
    - *For each variant,* the test reads whether `GET /api/v1/objects/lgl/Contract` with T0 lists that variant's probe node. It asserts **listed ⇒ refused**.
    - *Submits:* P submits each create, and `old-touch-case` on C-7, and each must be refused `approval_required`.
    - *The expanded spelling* is refused whether or not it is listed, through compaction.
    - On CI's server (default collation, F42) every variant is listed, so every submit must be refused.
  - i: O creates `drop-contract`, which deletes C-1. P submits it.
  - j: O creates `tag-contract`, which adds a link `C-1 —lgl:taggedWith→ PTY-1`. P submits it.
  - k: O creates `untag-contract`, which removes `C-1 —lgl:withParty→ PTY-1`. P submits it.
  - l: **no laundering through a new class.**
    1. O creates `register-payee`, which creates objects of class `lgl:Payee` at `lgl:Payee/{no}`. `lgl:Payee` is not in the ontology, so the action is accepted.
    2. P submits it, and it applies, ungoverned as designed, creating `lgl:Payee/PY-1`.
    3. An editor's `createClass` with label `Payee` and parent `lgl:Contract`, in module `legal`, is refused CONFLICT `class_would_adopt_data`. No class is created, and `GET /api/v1/objects/lgl/Contract` with T0 does not list `PY-1`.
    4. The same refusal follows with only the definition and no node, after `PY-1` is deleted with SQL.
    5. **Control:** `createClass` `Payee` under the ungoverned `lgl:Matter` succeeds.
  - m: **the collation precondition fails closed.** A unit test of `governance.ts` stubs the `information_schema.COLUMNS` read so that `kg_nodes.classIri` reports a different collation from `ontology_classes.iri`. The first class resolution on an enforcing path throws `GovernanceUnavailable`, and the route answers 503 `governance_unavailable`. With equal collations the same call resolves normally.
- *Breaks.* Each removes or weakens one part of the design and must fail its case:
  - (a, b) **the submit path ignores the plan's governance.** Both the pre-check in `submitAction` and the re-check in `applyInTx` are removed. There is no action-type governance left to fall back on, so this is the concrete form of "governance read from the action type";
  - (c) the touched set omits the *from* objects of incoming links;
  - (d) it omits the prior class of revived nodes;
  - (e) it uses declared parameter classes instead of the bound objects' classes;
  - (f) no inheritance;
  - (g) no variant check in `definitions.ts` (definitions), and none in `mappingRouter.ts` (mappings), each a separate break;
  - (h) class strings resolved by JS `===` against ontology IRIs instead of by the database's comparison (case and accent variants), and no compaction (expanded spelling);
  - (i) the touched set omits deleted objects;
  - (j, k) it omits the *from* objects of added and removed links;
  - (l) `createClass` without the adoption check, as today (`ontologyRouter.ts:246-262`): the class is created and T0's listing returns `PY-1` as a contract;
  - (m) no collation check: resolution proceeds and the call succeeds.

**REFUSE-03. No maker approves their own proposal.** *Layer:* MySQL.
- *Cases:*
  - a: P opens π and approves → `same_person`. π stays pending, and the refusal is audited.
  - b: X proposes, opens and approves → `same_person`.
  - c: `openProposal` for P returns `canApprove: false`.
- *Breaks:* (a) no comparison; (b) the comparison placed after a platform-administrator shortcut (`engine.ts:108`).

**REFUSE-04. The approver must be able to submit the action.** *Layer:* MySQL.
- *Cases:*
  - a: R opens and approves → `forbidden_role`.
  - b: S → `forbidden_scope`.
  - c: Q opens as an editor, is demoted to viewer, then approves → `forbidden_role`.
- *Break:* check 9 removed, with check 13's re-check.

**REFUSE-05. The maker must still be permitted.** *Layer:* MySQL.
- *Cases:* Q opens π. Then (a) P is removed from W, or (b) P is demoted to viewer. Q approves → `maker_no_longer_permitted`.
- *Break:* check 8 removed, with its re-check.

**REFUSE-06. Approval applies the change set shown, or nothing.** *Layer:* MySQL.
- *Cases:*
  - a: Q opens π, C-1's `endDate` is changed **with SQL** to `2097-01-31`, and Q approves → `changed_since_opened`. The criterion `{newEndDate} gt {contract.endDate}` still passes, because 2097-12-31 is after 2097-01-31, so only the hash comparison can refuse it.
  - b: Q approves with a well-formed hash it was never shown → `not_opened`.
  - c: P proposes `drop-matter` on MT-1, and Q opens it. A link `C-1 → MT-1` is then inserted with SQL. Q approves → `changed_since_opened`, and the new link survives.
  - d: P proposes `open-matter` for `lgl:Matter/MT-9`, and Q opens it. A soft-deleted `MT-9` of class `hr:Person` is then inserted. Q approves → `changed_since_opened`.
  - e: Q opens π, and a mapping into `lgl:Contract` is then created. Q approves → `changed_since_opened`.
- *Breaks:*
  - (a) apply the freshly prepared plan without comparing hashes;
  - (b) no view check;
  - (c) no incoming links in the change set, and deletion by `toNodeId`;
  - (d) no `revives`;
  - (e) no `imports`.

**REFUSE-07. Changes made while a plan waits to apply, and governance changes that take turns with applies and never deadlock.** *Layer:* MySQL; (b) to (f) use T7.
- *Cases:*
  - a: O edits `renew-contract` (new version) **before** Q opens π → `openProposal` and approve both give `action_changed`.
  - b: Q opens π. The raw connection locks the `action_types` row and sets `disabled`. Approve waits, the raw connection commits → `action_inactive`.
  - c: Q opens π. The raw connection locks Q's `workspace_members` row and sets `viewer`. Approve waits in the apply transaction, the raw connection commits → `forbidden_role`.
  - d: the raw connection locks W's `governance_locks` row FOR UPDATE, as `setClass` does, and inserts governance for `lgl:Matter`, approval required. Q2's direct submit of `close-matter` on MT-1 waits in `applyInTx`, the raw connection commits → `approval_required`, and MT-1 is unchanged.
  - e: **`setClass` holds the governance lock and does not deadlock with an audit append.** This is the deadlock of the previous revision, reproduced in order.
    1. The raw connection R begins and locks the audit chain: `SELECT * FROM audit_chain_lock WHERE id = 1 FOR UPDATE`.
    2. A's `setClass(lgl:Matter, approval required)` is started, and observed in `LOCK WAIT` on the audit chain.
    3. **(i)** A third connection's `SELECT … FROM governance_locks WHERE workspaceId = W FOR SHARE NOWAIT` fails at once with MySQL's NOWAIT error. So `setClass` holds the governance lock.
    4. **(ii)** R inserts an `audit_log` row for W, as an audit append does after taking the chain lock. The insert completes with no deadlock error.
    5. R rolls back. `setClass` then completes **without error**, and `verifyAuditChain(W)` is true.

    **No deadlock happened on either side.** R's statements raised none, and `setClass` resolved without error. `setClass` runs without `withDeadlockRetry` (4.3), so a deadlock in which InnoDB chose `setClass` as the victim would surface as its error rather than be retried away.
  - f: **first use of the governance lock after a re-seed does not deadlock.**
    1. W's `governance_locks` row is deleted with SQL, and the test clears the process's memory of ensured rows, so the first-use path runs. This assumes the CI server's REPEATABLE READ default.
    2. R begins and runs `SELECT … FROM governance_locks WHERE workspaceId = W FOR SHARE`, which finds no row and holds a gap lock.
    3. Q2's direct submit of `close-matter` on MT-1 is started. Its autocommit `INSERT IGNORE` of the row is observed in `LOCK WAIT` behind R's gap lock.
    4. R runs `INSERT IGNORE INTO governance_locks (workspaceId) VALUES (W)` and commits. Neither side raises a deadlock.
    5. The submit then completes and applies, and exactly one row exists for W.
- *Breaks:*
  - (a) no version check;
  - (b) the apply transaction does not re-check `action_types`;
  - (c) it does not re-check membership;
  - (d) `applyInTx` does not take the governance lock or re-read governance under it;
  - (e-i) `setClass` takes no governance lock, so the NOWAIT read succeeds;
  - (e-ii) `setClass` **also** locks the `workspaces` row FOR UPDATE, as well as the governance lock, as the previous revision did with that row. Step (i) still sees the governance lock held, so the case reaches step (ii). R's insert then waits on the foreign-key check against that row while `setClass` waits on R's chain lock. InnoDB reports a deadlock to R or to `setClass`, and the no-deadlock assertion fails on whichever side it reaches.
  - (f) the apply takes `FOR SHARE` on the missing row **inside** its transaction, and only then runs `INSERT IGNORE`, as the previous revision did. It then holds a gap lock that R's insert waits on, while it waits on R's gap lock. InnoDB reports a deadlock, and the assertion fails. If the CI server runs READ COMMITTED, which takes no gap locks, this break would not fail; that would be recorded as a finding (T6).

**REFUSE-08. An expired proposal cannot be approved.** *Layer:* MySQL.
- *Case:* Q opens π, `expiresAt` is set to one second ago with SQL, and Q approves → `expired`. The status changes and is audited.
- *Break:* no expiry checks.

**REFUSE-09. A proposal is decided once.** *Layer:* MySQL.
- *Cases:*
  - a: approve after decline → `already_decided`.
  - b: decline after approve → `already_decided`.
  - c: Q2 approves after Q's approval was applied → `already_decided`.
  - d: (T7) the raw connection locks π, Q's approve waits, the raw connection sets `declined` and commits → `already_decided`, and no submission exists.
- *Break:* status checks removed from approve and from decline; no FOR UPDATE; the final UPDATE has no status condition.

**REFUSE-10. No token approves; one proposal per call; decisions are limited.** *Layer:* routes, router and MySQL.
- *Cases:*
  - a: `POST /api/v1/proposals/{π}/approve` and `/decline` with T0 → 404.
  - b: `approveProposal({ id: [π], shownHash })` → BAD_REQUEST.
  - c: Q's 31st approval call within 10 minutes → `rate_limited`.
  - d: R's 61st decline call within 10 minutes → `rate_limited`.
- *Breaks:* (a) an approve route on `/api/v1`; (b) widen `id` to accept an array; (c, d) no limiter.

**REFUSE-11. Isolation between workspaces.** *Layer:* MySQL.
- *Case:* `Q-W2` calls `listProposals` (π is absent), and `openProposal`, `approveProposal` and `declineProposal` on π → NOT_FOUND.
- *Break:* drop the workspace filter.

**REFUSE-12. Session proposals are bounded and well formed.** *Layer:* MySQL.
- *Cases:*
  - a: π's exact parameters proposed again → `duplicate_pending`.
  - b: P has 200 pending proposals (inserted with SQL) → `too_many_pending`.
  - c: a rationale missing, of 2,001 characters, or holding `"\ud800"`, or a parameter holding `"\ud800"` → BAD_REQUEST.
  - d: C-1's `propsJson` is padded with SQL to more than 512 KiB → `change_set_too_large`.
  - e: C-1 is given 5,000 outgoing links with SQL → `too_many_links`.
  - f: MT-1 is given 5,000 incoming links, and `drop-matter` is proposed → `too_many_links`.
- *Breaks:* one per case.

**REFUSE-13. Nothing is applied unchecked.** *Layer:* MySQL, with `semanticEngine` mocked (T3).
- *Cases:*
  - a: with `ensureEngineRunning` false, P proposes `checked-renewal` on C-1 → `ok: false`, `shacl_unavailable`, and no proposal.
  - b: with the engine answering conforming, P proposes and Q opens. The mock is then set to unavailable, and Q approves → `shacl_unavailable`, and nothing is applied.
- *Breaks:* (a) propose inserts despite problems; (b) approval ignores prepare's problems.

**REFUSE-14. Criteria are checked again at the real time of approval.** *Layer:* MySQL.
- *Case:* Q opens π and approves with `now = 2098-01-01T00:00:00Z`. `{newEndDate} gt {today}` (`seed.ts:357`) fails at that time → `criterion_failed`, and C-1 is unchanged.
- *Break:* skip check 11, or leave `criteriaContext.now` at `effectiveAt`.

**PR 2**

**REFUSE-15. Token creation checks.** *Layer:* service (`TokenRefused.code`) and router (FORBIDDEN).
- *Cases:*
  - a: `grant_unknown`.
  - b: `grant_inactive`.
  - c: `grant_forbidden`, because the creator S is scoped to `hr`.
  - d: `grant_forbidden`, because the token's role is viewer.
  - e: `grant_people_only` (`set-remit-to`, with `fin:Vendor` people-only).
  - f: 21 distinct keys → `too_many_grants`.
  - g: `[]` → `no_grants`.
  - h: duplicate keys are stored once, sorted, pinned.
  - i: a name containing U+202E, a newline, or U+200B → `invalid_name`.
  - j: P holds 24 live tokens, 2 revoked and 1 expired. The 25th is allowed; the 26th → `too_many_tokens`.
  - k: a token row with malformed `actionGrantsJson` → 401 `invalid_token` on every route.
- *Breaks:* one per case. For (j), the break counts revoked and expired tokens.

**REFUSE-16. People-only data is out of reach of every token, through any action type.** *Layer:* MySQL.
- *Setup:* A sets `fin:Vendor` to people-only with approval required. O (not an admin) then creates `update-vendor-contact`, **active**, writing `fin:Vendor` `remitTo`.
- *Cases:*
  - a: T0 previews, proposes and submits it on V-1 → 403 `people_only`.
  - b: P's draft-only token without grants proposes it → 403 `people_only`.
  - c: T0's `GET /actions` shows `tokenAccess: people_only`, with `canSubmit` and `canPropose` false.
  - d: **people-only data reached only through an incoming link,** which the action's declared reach does not show. T0 previews and submits `drop-matter` on MT-3, whose incoming link from V-1 is stored on V-1 → 403 `people_only`. The action's reach is `lgl:Matter`, which is ungoverned, so only the plan check can refuse it.
  - e: **class-string variant.** An action type `old-vendor-case`, creating class `fin:VENDOR` at `fin:Vendor/{no}` with `remitTo`, is inserted with SQL to stand for a definition stored before the exactness rule. A probe node of class `fin:VENDOR` is inserted too. If `GET /api/v1/objects/fin/Vendor` lists the probe, T0's submit of `old-vendor-case` must be refused 403 `people_only`. On CI's server it is listed.
  - f: **a token-originated proposal adopted before its data became people-only.**
    1. A sets `lgl:Matter` to approval required.
    2. T drafts `close-matter` on MT-1. P adopts it, and it is pending.
    3. A sets `lgl:Matter` people-only.
    4. Q opens the proposal, **after** the switch, and approves → `people_only`. MT-1 is unchanged.
  - g: P, signed in, submits `update-vendor-contact` → `approval_required`. P proposes it → pending, because people-only does not bind people.
- *Breaks:*
  - (a–c) both people-only checks, the action-level one and the plan one, removed;
  - (d) the plan's people-only check removed, with the action-level check kept;
  - (e) class strings resolved by JS `===` instead of the database's comparison;
  - (f) approval check 10a and its re-check in the apply transaction removed.

**REFUSE-17. Grants limit a token to listed action types.** *Layer:* MySQL routes.
- *Cases:*
  - a: P's token T′ grants only `close-matter`, and previews `renew-contract` → 403 `not_granted`.
  - b: after O edits `close-matter`, T′ proposes it → 403 `grant_outdated`.
  - c: T′'s `GET /actions` lists only `close-matter`.
- *Break:* grants ignored.

**REFUSE-18. Tokens draft; people decide.** *Layer:* MySQL.
- *Cases:*
  - a: T's draft is visible only to P. M gets NOT_FOUND on open and adopt, and the draft is absent from M's lists.
  - b: approve on a draft → `not_submitted`.
  - c: a token with no creator proposes → 403 `creator_required`, recorded.
  - d: T submits `close-matter` → 403 `propose_only`.
  - e: **shared token.** M uses T to draft. M cannot adopt the draft. P adopts it, and P then approving → `same_person`. M may approve, and the record names T as drafter, P as maker and M as approver.
  - f: P's other token calls `GET /api/v1/proposals/{T's draft}` → 404.
  - g: `POST /api/v1/proposals/{id}/adopt` → 404.
- *Breaks:*
  - (a) any member may see and adopt drafts;
  - (b) approve accepts drafts;
  - (c) tokens without a creator may propose;
  - (d) no `propose_only` check;
  - (e) the maker compared with the creator only for session proposals;
  - (f) no token filter;
  - (g) an adopt route on `/api/v1`.

**REFUSE-19. Adoption checks.** *Layer:* MySQL; (l) and (m) use T7.
- *Setup:* T drafts `close-matter` with `{ matter: "lgl:Matter/MT-1" }`, except in (e) and (k). **P opens the draft first, except in (c).**
- *Cases:*
  - a: T's `expiresAt` set to one second ago with SQL → `token_inactive`.
  - b: O makes a new version → `action_changed`.
  - c: (no open) adopt with an unseen hash → `not_opened`.
  - d: MT-1's **label** changed with SQL → `changed_since_opened`. The label is in the change set's `objects`, while `close-matter`'s criterion `{matter.status} eq open` still passes, so prepare does not refuse it first.
  - e: T drafts `renew-contract` on C-2 with `newEndDate` 2098-01-01. P opens it at `now = 2097-12-31T12:00Z` and adopts at `now = 2098-01-01T00:00Z` → `criterion_failed`.
  - f: P opens it at `now = 2026-11-02T10:00Z` and adopts at `now = 2026-11-03T10:00:01Z`. The age, the service's `now` minus `renderedAt`, exceeds 24 hours → `view_stale`.
  - g: P is demoted to viewer → `forbidden_role`.
  - h: P discards the draft, then adopts → `already_decided`.
  - i: the draft's `expiresAt` is set in the past → `expired`.
  - j: `close-matter` is set disabled → `action_inactive`.
  - k: T drafts `renew-contract` on C-2. P has 200 pending proposals → `too_many_pending`.
  - l: the raw connection locks W's `governance_locks` row FOR UPDATE and makes `lgl:Matter` people-only. Adoption waits, the raw connection commits → `people_only`.
  - m: the raw connection locks T's `api_tokens` row, sets `revokedAt` and withdraws the draft. Adoption waits at the token lock, the raw connection commits → `token_inactive`.
- *Breaks:* one per case, removing that check or its in-transaction re-check.

**REFUSE-20. Token refusals are recorded, never silent, and bounded without hiding a probe.** *Layer:* MySQL, plus a unit test with a failing database.
- *Cases:*
  - a: each of `not_found`, `not_granted`, `grant_outdated`, `people_only`, `propose_only`, `approval_required`, `forbidden_role` (submit), `forbidden_scope`, `creator_required`, `too_many_drafts` and `duplicate_pending` gives exactly one row, and the `audit_log` row count is unchanged.
  - b: a propose failing a criterion gives a row with `stage = 'checks'`.
  - c: a `submit` refused `not_granted`, whose parameter holds `"\ud800"` → 403, with `paramsJson` NULL and `paramsUnstorable` true.
  - d: parameters over 4 KiB → stored as the digest only.
  - e: a problem message echoing ill-formed input is stored sanitised.
  - f: the record write throws → 503.
  - g: 20 rows for (T0, `update-vendor-contact`, `people_only`) are inserted this hour with SQL. The next such refusal → no new row, and overflow `suppressed` = 1 with that key and code. A refusal for (T0, `set-remit-to`, `people_only`) is still itemised.
  - h: 100 `not_found` rows are inserted with SQL. The next `not_found` → overflow `('*', 'not_found')`, while a `people_only` probe is still itemised.
  - i: `rate_limited`, `invalid_json`, `invalid_body`, a malformed key, and a preview's check problems produce no rows.
  - j: a preview's permission refusal is recorded while it still answers 200.
- *Breaks:*
  - (a) do not record;
  - (b) always record `stage = 'scope'`;
  - (c) store the parameters raw. If this does not fail, that is a finding (T6);
  - (d) store parameters whatever their size;
  - (e) store messages raw;
  - (f) answer 403 when the write throws;
  - (g) one cap per token for all codes and actions;
  - (h) `not_found` shares the per-action budget;
  - (i) record before the rate limit and the body checks run;
  - (j) skip recording on preview.

**REFUSE-21. Token proposals are bounded.** *Layer:* MySQL.
- *Cases:*
  - a: T's 61st propose within a minute → 429 with code `rate_limited`.
  - b: with 50 drafts of T inserted with SQL, T's next propose → 429 `too_many_drafts`. With 200 drafts of P's tokens inserted with SQL across 5 tokens, the next propose by any of them → `too_many_drafts`. Inserting with SQL keeps the case within the 30-second test timeout.
  - c: a rationale missing, of 2,001 characters, or holding `"\ud800"`, or a `sourceRef` of 513 characters → 400 `invalid_body`, not recorded.
  - d: P's 61st adopt-or-discard call within 10 minutes → `rate_limited`.
- *Breaks:* one per case. For (d), adopt and discard are taken out of the decisions limiter.

**REFUSE-22. Tokens learn nothing new through drafts.** *Layer:* MySQL routes.
- *Cases:*
  - a: P's draft-only token granting `open-matter` drafts `lgl:Matter/MT-9`, where a soft-deleted `MT-9` exists. The 201 response and `GET /proposals/{id}` show a plain create in `changes`, and none of the keys `revives`, `imports`, `objects`, `sideEffects`, `changeSet` or `changeSetHash`.
  - b: a draft touching an imported node shows no mapping id or name.
  - c: a `notify-renewal` draft shows no webhook target.
- *Break:* return the full change set to the token.

**PR 3**

**REFUSE-23. Untrusted text is inert and visible.** *Layer:* render.
- *Cases:*
  - a: a rationale of `<img src=x onerror=alert(1)> [click](javascript:alert(1)) https://evil.example` renders as literal text, with no `img` or `a` element inside `proposal-rationale`.
  - b: U+202E, U+200B, U+2066 and U+200F in the rationale, a token name, a parameter value, an object label and an IRI each render as a visible marker.
  - c: `раyment` (Cyrillic р and а, Latin yment) shows the "mixed scripts" badge.
- *Breaks:* (a) `dangerouslySetInnerHTML`; (b) raw text; (c) no mixed-script check.

**REFUSE-24. CSV export neutralises formulas and shows hidden characters.** *Layer:* unit.
- *Cases:*
  - a: `=1+1`, `+1`, `-1`, `@x`, `\tx` and `\rx` are written with a leading `'`. Quotes are doubled. Cells with commas or newlines are quoted. The number `-5` stays `-5`.
  - b: U+202E and U+200B in a string cell are written as `⟨U+202E⟩` and `⟨U+200B⟩`.
- *Breaks:* (a) no prefix rule; (b) no markers.

### 5.5 Acceptance tests

**PR 1**

**ACCEPT-01. A person's change, round trip, through tRPC on MySQL.** Written first.
1. P proposes `renew-contract` on C-1 through tRPC.
2. Q lists, opens, and approves with the hash shown.
3. Expected:
   - C-1 holds `endDate` 2097-12-31, `value` 104000, `renewedBy` = P's label, and **`renewedOn` = the UTC date of the stored `effectiveAt`**.
   - The submission has `proposalId`, `submittedBy` P, `approvedBy` Q, `changeSetHash`, and `governanceJson` naming `lgl:Contract` as approval required.
   - The audit payload holds `rationaleDigest`, and no rationale text.
   - `verifyAuditChain(W)` is true.
   - GUARD-03's assertions hold.

**ACCEPT-02. What is applied is what the maker submitted and the approver was shown.** *Layer:* MySQL, with injected times.
- For π, proposed at 2026-11-02, opened at 2026-11-05 and approved at 2026-11-06: `makerHash`, the hash shown and `appliedHash` are all equal, and the stored JSON hashes to `appliedHash`.
- A `close-matter` session proposal whose `{now}` renders to the millisecond, approved one day later, gives three equal hashes as well.

**ACCEPT-03. Decline and withdraw.** *Layer:* MySQL.
- Q declines π with a reason. C-1 is unchanged, and the decline is audited.
- P withdraws a second proposal → `declined`, with P as `decidedBy`.
- R declines → `cannot_decline`, audited.

**ACCEPT-04. One list.** *Layer:* MySQL.
- Rows sit at pinned instants `2026-11-02T23:59:59Z` and `2026-11-03T00:00:00Z`:
  - Q2's direct `close-matter` on MT-1;
  - T0's direct `close-matter` on MT-2, through `/api/v1`;
  - a rejected direct submission;
  - π, applied;
  - a proposal made by the persona account D and approved by Q, applied;
  - a submission row inserted with SQL with `governanceJson` NULL, standing for a row from before this cycle.
- R, a viewer, exports two adjacent days. Each row is in the correct day on CI's +05:00 server.
- T0's row has `responsible_person` = E, `started_by` = T0's label, and an empty `signed_off_by`.
- Q2's row has `responsible_person` = Q2 and an empty `signed_off_by`.
- π's row has `signed_off_by` = Q, `opened_at`, and `governance_at_apply` = approval required.
- D's row has `maker_persona` = true and `approver_persona` = false. The proposal row stores `makerIsPersona` true.
- The older row has `governance_at_apply` = unknown.
- 10,001 rows → 10,000, with `truncated`. A range of 367 days → BAD_REQUEST.

**ACCEPT-05. Changes outside the change set do not block approval.** *Layer:* MySQL.
- Q opens π. Q2 submits `close-matter` on MT-1 directly, and it is asserted applied. Q approves π, and it applies.
- **A mapping rename does not block approval.** A mapping into `lgl:Contract` exists before Q opens π, so π's change set carries an import warning with that mapping's id. After Q opens π, the mapping is renamed. Q approves, and it applies, because the hash holds the mapping's id, not its name. This case moved here from ACCEPT-07, where a unit test could not fail.

**ACCEPT-06. The change set carries what the approver must see.** *Layer:* MySQL. Each of these appears in the change set:
- a `notify-renewal` change set lists `sideEffects: [{ kind: "webhook", target: "https://*.vendor.example/…" }]`;
- a `drop-party` proposal on PTY-1 lists C-1 among `incomingLinksRemoved`, and its governance names `lgl:Contract`;
- an `open-matter` proposal reviving a deleted node lists `revives` with the node's prior class, properties and provenance;
- a proposal on a node with `sourceMappingId` lists an import warning with mapping ids;
- `governance.classes[].via` names `lgl:Contract` for a node of `lgl:FrameworkContract`.

**ACCEPT-07. Properties of the hash.** *Layer:* unit.
- The same input gives the same hash.
- Reordering database rows changes nothing.
- Changing any single leaf changes the hash; this is checked over every leaf.
- Criteria and SHACL detail are not hashed.
- `diffPaths` returns at most 100 paths.

**ACCEPT-08. Bounds, validation and configuration (PR 1).** *Layer:* unit, router and MySQL.
- `PROPOSAL_TTL_DAYS` of 0, 31 or `x` fails at startup, naming the variable, in production and in development. 7 is used when it is unset.
- `listProposals` limits (0 and 201 refused), the cursor, `scope: "mine"`, and the 200-character rationale cut.
- `declineReason` of 0 or 501 characters → BAD_REQUEST.
- New action strings longer than 255 characters are cut.
- Approval refusals `not_opened` and `forbidden_role` are audited.
- The approvals limit, when it cannot be checked (mocked `RateLimiter` throws) → 503.
- `openProposal` on an expired pending proposal moves it to `expired`, with an audit entry.
- A view is recorded only when there were no problems.
- **An approval refusal whose problem message echoes a parameter holding `"\ud800"` is audited with the message sanitised.**
  - Session propose refuses ill-formed strings (4.4, step 1), so the pending proposal row is **inserted with SQL**, its `paramsJson` holding the escape `"\ud800"`. Q opens it and approves, and the refusal's audit payload must carry the sanitised message.
  - If MySQL refuses to store that row, which is UNVERIFIED (as in REFUSE-20c), the case runs instead as a unit test of the function that builds the approval-refusal audit payload. MySQL's refusal is recorded as a finding.
- `listProposals` rows show the governing classes.

**ACCEPT-09. A conflict that leaves the change set unchanged is re-planned once, and applies.** *Layer:* MySQL, T7.
- Q opens π. The raw connection locks C-1's `kg_nodes` row. Approve waits in `applyInTx`.
- The raw connection soft-deletes C-1's `lgl:withParty` link, inserts an identical link with a new id, and commits.
- The fingerprint conflict (`service.ts:414-416`) is re-planned, the hash is unchanged, and the approval applies.
- If the re-plan were removed, the approval would fail, so this test can fail.

**ACCEPT-10. How governance is shown, stored and kept.** *Layer:* MySQL.
- `GET /actions` (T0) and `listTypes` show `renew-contract` as approval required, and `annotate-agreement` as approval required through a descendant.
- Every applied submission stores `governanceJson`.
- A switches `lgl:Contract` back to `none`. The `class_governance` row is deleted, because both settings are back at their defaults. π stays pending. **Q opens π after the switch**, because governance is part of the hash, and approves it.
- `governance.list` returns governed classes to any member.
- A node of class `dtwin:Sensor`, which resolves to no ontology class, is ungoverned. O's `touch-sensor` (modify, object parameter `dtwin:Sensor`) is accepted at creation, and P's direct submit of it applies.
- **A link *into* a governed object is not a touch of it** (4.3; 3.3 row 20). O's `link-party` adds `PTY-1 —lgl:partyTo→ C-1`. P's direct submit applies, and its `governanceJson` names no governed class.

**PR 2**

**ACCEPT-11. A token's draft, round trip, through the real routes on MySQL.** Written first.
1. T drafts the renewal of C-2 (201). No audit entry is written: the `audit_log` count is unchanged.
2. P opens it, adopts it (pending), and Q approves.
3. Expected:
   - the records name T as drafter, P as maker and Q as approver;
   - the token's views carry `changes` only;
   - `GET /submissions/{id}` shows `submittedBy` P, and no approver.

**ACCEPT-12. A token's draft on ungoverned data: the creator applies it by adopting it, unless approval becomes required meanwhile.** *Layer:* MySQL; (b) uses T7.
- a: T drafts `close-matter` on MT-1, and P adopts it → applied. `approvedBy` is NULL, and `closedBy` = P.
- b: T drafts `close-matter` on MT-2, and P opens it.
  1. The raw connection locks W's `governance_locks` row FOR UPDATE and sets `lgl:Matter` to approval required.
  2. P's adopt waits in its transaction, and the raw connection commits.
  3. The draft becomes `pending`, with P as maker, and MT-2 is unchanged.

  If adoption read the governance before its lock, the adopt would apply the change, so this test can fail.

**ACCEPT-13. Existing token behaviour is unchanged while nothing is governed or narrowed.** *Layer:* routes.
- `publicApiRoutes.test.ts` and `publicApiSdk.system.test.ts` pass with **only** the mock additions in 5.6, items 4 and 5.
- For a standard token with no options and no governed class:
  - `GET /actions` items have today's keys plus `approval`, `tokenAccess` and `canPropose`;
  - preview and submit responses have today's key sets.
- `/openapi.json` gains exactly the three new path families.
- The generated SDK compiles and exposes `actions.propose`, `proposals.list` and `proposals.get`.

**ACCEPT-14. Revocation and discard.** *Layer:* MySQL.
- P revokes T, which has one draft and one adopted pending proposal. The draft is `withdrawn` and named in the audit entry. The pending proposal stays approvable.
- P discards another draft → `discarded`, audited. M cannot discard it (NOT_FOUND).

**ACCEPT-15. New token routes (PR 2).** *Layer:* MySQL routes.
- `GET /proposals` limits (0 and 201 refused) and the cursor.
- `GET /proposals/{id}` of another workspace → 404.
- A session calling `/actions/{key}/propose` → 401 `token_required`.
- A new route with the database unavailable → 503 with `retry-after`. The token propose limit, when it cannot be checked → 503.
- With 200 drafts of P's tokens inserted with SQL, P's session proposal is accepted. Drafts do not count against the pending cap.
- T's `GET /actions` gives a `deniedBecause` for `canSubmit: false` that names draft-only.
- The token-creation audit payload holds `actionGrants` and `proposeOnly`.

**PR 3**

**ACCEPT-16. In the browser.** Written first. Tagged `@shared-state` (`app/playwright.config.ts:19-31`), on CI's stack with persona sign-in on.
1. The admin persona governs `lgl:Contract` (approval required) in the Studio.
2. The editor persona creates a token from the AI-agent preset, role editor, granting Renew contract.
3. The test drafts, through the token, the renewal of the active contract whose end date is latest, to one day later. Seeded active contracts end 30 to 365 days after seeding (`seed.ts:770`), so the criteria pass.
4. The editor opens My drafts, sees the changes, the governed class and the unverified rationale, and chooses Submit for approval. On its own proposal it sees no enabled Approve.
5. The ontologist persona sees the persona banner and approves.
6. The detail shows "Priya Sharma (Editor)" as maker, "Dr. James Wei (Ontologist)" as approver (`auth/service.ts:277-278`), the token prefix, and the persona flags.

Teardown runs in `afterEach` (retries, `playwright.config.ts:11`): the editor revokes the token, and the admin removes the governance. The renewal stays applied. No other browser test reads contracts, which a reviewer found by searching `app/e2e`.

**ACCEPT-17. The sheet shows every leaf of the change set.** *Layer:* render.
- A change set holding every part of 4.5 is rendered.
- A helper enumerates its leaves and asserts each is rendered as 4.12 specifies, including `null` (as "—"), booleans and numbers.

**ACCEPT-18. Interface controls.** *Layer:* render.
- *Proposal sheet:*
  - the maker sees no enabled Approve, and sees the reason;
  - the persona banner shows when persona sign-in is on;
  - list rows have no checkbox, "select all" or approve control;
  - `changed_since_opened` reloads the sheet;
  - `effectiveAt` and its age are shown;
  - "Why this needs approval" names the class and `via`.
- *Run panel:* "Submit for approval" for governed plans.
- *Studio:* governance controls only for admins.
- *Developers page:*
  - the AI-agent preset sets read and actions, offers 7, 30 and 90 days with 30 selected and no "Never", ticks draft-only, and requires an action;
  - `grantableActions` reasons are shown;
  - a plain token's create request is unchanged.
- *Submission views:* `SubmissionDetail` and `SubmissionHistory` show the parties, the responsible person and the governance at apply.
- *Export:* the truncation notice is shown.

### 5.6 Changes to existing test files and configuration, each its own line

1. `app/api/__tests__/migrationHistory.test.ts` gains the RELEASED lines for `0013` (PR 1) and `0014` (PR 2), as its comment requires (`:24-27`).
2. `app/api/__tests__/publicApiPrincipal.test.ts:44-60`: the `apiToken` builder gains `actionGrantsJson: null, proposeOnly: false` (PR 2). No assertion changes.
3. Partial fixtures **found by searching (grep only; `tsc` was not run)**: `publicApiTokens.test.ts:39`, `developerRouter.test.ts:64`, `actionWebhooks.test.ts:76`, `workspaceScoping.test.ts:315`, `src/__tests__/developersPage.test.tsx:47,156`. Each gains the new fields only if `tsc -b` requires it, and is named in its pull request.
4. `app/api/__tests__/publicApiRoutes.test.ts`:
   - **PR 1:** `vi.mock("../services/proposals/governance", …)` returns no governance for every key. `GET /actions` would otherwise query a database whose mock returns queued rows to selects only (`:35-53`).
   - **PR 2:** `vi.mock("../services/proposals/refusals", …)` resolves without writing. The 403, 400 and 404 refusals at `:284-293` and `:300-302` would otherwise answer 503.
   - Fixture-only. No assertion changes.
5. `app/api/__tests__/publicApiSdk.system.test.ts`: the same two mocks (PR 1 and PR 2). Its 403 case at `:143-147` and its `getDb: vi.fn()` (`:41`) need them. Fixture-only.
6. `src/__tests__/developersPage.test.tsx:55-56`: the mock server gains cases for the new procedures (PR 3). The create-request assertions (`:123,:141`) are untouched, because the form omits unset options.
7. `app/api/__tests__/actionsRouter.test.ts` (PR 1):
   - **Change:** a fixture-only `vi.mock("../services/proposals/governance", …)` that returns no governance. `listTypes` and `getType` now read governance through `governance.ts`. This file mocks only the definitions and the service (`:22-35`) and calls `listTypes` at `:138-147`, so in CI, with an empty `DATABASE_URL`, the read would fail (a local `.env` can hide this).
   - **No assertion changes.** `capabilities` is unchanged (`:113-116`). The session submitter object is unchanged, so `:161-166` holds. Signed-in people's refusals are not recorded, so `:169-176` holds. A reviewer found no test there comparing a whole action-type row with `toEqual` (`:144,146`; `scoping.mysql.test.ts:214,218`).
8. **No edit to** `developerRouter.test.ts`. `TokenCreator` is unchanged (`:81`), and the new checks run after the existing ones (`:91-95`).
9. **No edit to** `app/api/__tests__/graphChangeWriters.test.ts`. `service.ts` keeps exactly 7 writes to the graph's tables, and no other file gains one (4.5; F44). If the implementation cannot keep that, adding a counted writer there is the test's own documented procedure (`:5-7`). It is reported as its own line item, never as a loosening.
10. **Expected unaffected (UNVERIFIED):** `mappingSyncShacl.test.ts` and `workspaceScoping.test.ts` save mappings through `memoryDb` (`:20`, `:32`). The variant check only adds `iri` to the class select and compares it in JS. `memoryDb` matches with JS equality, so the returned `iri` always equals the input.
11. `compose.yaml:21-36` and both `.env.example` files gain `PROPOSAL_TTL_DAYS`.
12. `app/api/__tests__/actionWebhooks.test.ts` calls `listTypes` and `getType` on `memoryDb` with no governance mock (`:18`, `:44-47`, `:60`).
    - **Expected to pass unchanged:** `governance.ts`'s reads for listings use only predicates `memoryDb` evaluates (4.3, "Shape of governance reads"). Its store holds no governance or ontology rows, so they return "no governance". Listings never run the collation check.
    - **If it fails anyway** (UNVERIFIED until run), it gains the same fixture-only `governance.ts` mock as item 7, listed in its pull request, with no assertion changes.

**No CI workflow change and no seed change. No test is skipped, deleted or loosened.**

**Counts: 24 refusal tests (REFUSE-01 to 24), 18 acceptance tests (ACCEPT-01 to 18), 4 guards (GUARD-01 to 04).**

### 5.7 Changes to the test contract

None of these tests had been approved, but each change is listed.

**In r4 (the latest revision):**
- **New cases:**
  - REFUSE-02l: `createClass` may not adopt existing data under a governed class.
  - REFUSE-02m: differing collations fail closed.
  - REFUSE-07f: first use of the governance lock does not deadlock.
- **Corrected:**
  - **REFUSE-07e's break (e-ii):** `setClass` **also** locks the `workspaces` row, so step (i) passes and the deadlock is exercised. The case asserts no deadlock on either side, with `setClass` not wrapped in a retry.
  - **ACCEPT-08:** inserts with SQL the proposal whose parameter holds `"\ud800"`, with a unit-test fallback.
- **Listed:** `actionWebhooks.test.ts` (5.6 item 12).

**In r3:**
- **New cases:**
  - REFUSE-02g–k: variant class strings refused at write; stored variants governed by resolution, asserted as "listed ⇒ refused"; deleting a governed object; adding and removing a link from one.
  - REFUSE-07e: `setClass` holds the governance lock and does not deadlock with an audit append, deterministic.
  - REFUSE-16d–f: people-only data reached only through an incoming link; a class-string variant; a token-originated pending proposal refused at approval.
  - REFUSE-21d: the decision limit for adopt and discard.
  - ACCEPT-12b: approval required during adoption makes the draft pending.
  - Additions to ACCEPT-04 (persona row, a row from before this cycle, MT-2), ACCEPT-08 (sanitised audit payloads, governing classes in lists), ACCEPT-10 (open after the switch, the all-defaults row deleted, an unresolved class ungoverned, a link into a governed object not touched) and ACCEPT-15 (drafts outside the pending cap, propose limit 503, the draft-only reason, the creation audit payload).
- **Corrected:**
  - **REFUSE-19d:** changes MT-1's label, not its status. A status change makes `close-matter`'s criterion fail first, so a correct build answered `criterion_failed` (R3-T1).
  - **REFUSE-06a:** pins the new end date at 2097-01-31.
  - **REFUSE-19f:** states its clock.
  - **REFUSE-07d and 19l:** lock the governance-lock row, not the `workspaces` row.
  - **REFUSE-21b:** inserts drafts with SQL.
  - **T7:** polls until the lock wait **or** the call settles.
  - **T1:** MySQL runs also use `does-not-exist.env`, and REFUSE-13 stubs `ENGINE_HOST_URL`.
- **Breaks made concrete** so that each can fail its test:
  - REFUSE-02a, b: the submit path ignores the plan's governance.
  - REFUSE-16a–c: both people-only checks removed.
  - REFUSE-16d: reworked to reach `fin:Vendor` only through an incoming link, which the action's declared reach does not show.
  - Breaks added for REFUSE-01b, c and REFUSE-20b, d, i, j.
- **Moved:** the mapping-rename case, from ACCEPT-07 (a unit test, which could not fail) to ACCEPT-05 (MySQL).

**In r2:**

**New.**
- REFUSE-02 (the sibling-action attack, with seven cases) and REFUSE-16 (people-only data through a sibling action), which answer the governance-bypass finding.
- REFUSE-07c and 07d (membership and governance races).
- REFUSE-14 (criteria at the real time).
- REFUSE-19e–m (adoption checks).
- REFUSE-20g–j (records cannot hide a probe; what is not recorded).
- REFUSE-22 (no new read reach).
- REFUSE-24b (CSV markers).
- ACCEPT-09 (re-plan, which an earlier draft listed as untestable).
- ACCEPT-10 (governance).
- ACCEPT-15 (PR 2 routes).

**Moved to PR 2** so that PR 1's tests use only PR 1 code: the token-adoption cases of the token-reach guard, the `/proposals` limits, the 503 on new token routes, and every test using token T.

**Corrected:**
- **ACCEPT-01:** asserts `renewedOn` from the stored `effectiveAt`, because tRPC uses the request time.
- **REFUSE-13:** a SHACL shape was added to `lgl:Contract`. Without one, `checkShacl` returns `no_shapes` before touching the engine (`service.ts:165-179`), so the test could not produce `shacl_unavailable`. Case (a) gains its own break.
- **REFUSE-06a:** changes C-1 with SQL. Contracts are governed, so a direct submission would be refused.
- **REFUSE-12d:** pads stored properties rather than parameters. Parameters are capped at 10,000 characters and 20 per action.
- **REFUSE-20 cap cases:** rows are pre-inserted with SQL, avoiding the 300-a-minute limit and the 30-second test timeout.
- **REFUSE-21:** pins `rate_limited` and runs on MySQL.
- **REFUSE-19:** names the draft's action and parameters, and opens first except in (c).
- **REFUSE-07:** cases renumbered a to d.
- **GUARD-04:** moved to a file that does not mock authentication.
- **ACCEPT-13:** reworded to "passes with only the listed mock additions".
- **ACCEPT-16's preset:** includes the read and actions scopes.
- **ACCEPT-17:** defines how `null`, booleans and numbers render.

**Changed with the design:**
- The earlier action-type governance tests now govern classes.
- Recording of signed-in people's refusals is removed (section 7), with its cases.
- REFUSE-14's earlier mention of a `creator_required` case is withdrawn: that case is REFUSE-18c.

---

## 6. Decisions needed from the owner

Each question carries ENGINEER's recommendation.

1. **Rule 4.** Keep the renewal feature and log the detector, reversing rule 4's direction for the second feature (3.2). Or pivot to the detector, in which case ENGINEER's decision on it is (c). *Recommend:* keep.
2. **(b), or (c),** given every residual in 3.3. *Recommend:* (b). If rows 2, 3 or 8 mean VETO's ground 1 still reaches what r3 builds, choose (c).
3. **`{actor}`** names the maker, from the stored label. *Recommend:* yes.
4. **Templates render at the maker's frozen effective time,** at most 24 hours before adoption and at most TTL + 1 day before application. Criteria are also checked at the real time. *Recommend:* yes.
5. **The hash covers the named objects' state, webhooks, import warnings and governance.** *Recommend:* yes.
6. **A token's proposal is a draft, and only its creator adopts it.** *Recommend:* yes.
7. **Governance defaults to none on every class.** *Recommend:* yes. Admins opt classes in.
8. **Limits** as in 4.1. *Recommend:* as stated.
9. **Who may decline:** anyone who could submit the action, and the maker. *Recommend:* yes.
10. **The export's columns and scope** (4.6). *Recommend:* yes.
11. **The token name rule and the 25-token cap** for every new token. *Recommend:* yes (3.6).
12. **Standard tokens with no creator** (F4). *Recommend:* a separate decision.
13. **Merge before VETO's next turn.** *Recommend:* merge each pull request when CI and the Gate are green. Every control is opt-in, and reach does not grow, apart from the one bit of 3.3 row 21. Do not merge if the owner reads "does not ship" as reaching this.
14. **The preview omission** (F10). *Recommend:* a separate pull request.
15. **Publishing.** *Recommend:* commit r3 as `docs/specs/2026-10-28-governed-agents-cycle-1.md`, with D-037 to D-039, in one pull request. Keep the earlier drafts out of the public repository, as D-024 did for `xfn`.
16. **Token refusal records outside the audit chain.** *Recommend:* accept, and design a separate chain later.
17. **One admin governs alone.** *Recommend:* accept this cycle, with the audit entry.
18. **Rule 1: is r3 one feature** (3.6)? If not, the split is: this cycle builds class governance, approval of changes and token drafts (PR 1, plus PR 2 without grants and refusal records), and the token narrowing and records come next. *Recommend:* one feature, as argued.
19. **Restrict authoring of action types that can reach governed classes to admins,** as defence in depth. *Recommend:* not this cycle. REFUSE-02 shows that governance holds without it, and it would take authoring from ontologists.
20. **Governance per class, or per property.** *Recommend:* per class now. Per property needs property keys normalised across prefixed and short forms (`engine.ts:252-265`).
21. **Governing imports into governed classes** (3.3 row 8), and telemetry writes to governed objects in the twin module (row 22). *Recommend:* the next cycle's candidate, with VETO's import condition.
22. **A token's one bit about deleted nodes** (3.3 row 21). Accept the bit, or refuse every revive by a token, which changes existing behaviour. *Recommend:* accept, and state it in the README.

---

## 7. Not in this cycle

**What stays open inside VETO's grounds and conditions:** every residual in the table in 3.3, rows 1 to 22. None is cleared by r3. Row 21, a token's one bit about deleted nodes, is the only one r3 causes.

**Deferred features.**
- **The agent-facing MCP server.** It comes after VETO judges these controls:
  - a stdio process holding only a token, with no database handle;
  - tools mapping one-to-one onto the `/api/v1` reads, `GET /actions`, preview, propose and the proposal reads;
  - its integration test first;
  - whether to write it by hand (F17) or add a dependency is the owner's choice.
- **Recording permission refusals for signed-in people** (rule 1, 3.6).
- **Property-level governance** (Q20).
- **Governance of imports and telemetry** (Q21). That includes protecting approved changes from them, and keeping governed objects out of the twin module, where telemetry writes any property (row 22).
- **Governing links into a governed object from other classes** (row 20). Today the admin must govern the linking class instead.
- **Approval-matrix routing.**
- **The remit-to detector.**
- **Read scoping for tokens.**
- **Matching aids** for agreements with the same counterparty.
- **Two-approver control, and two-admin control of governance.**
- **Hash-binding direct submissions.**
- **A sweep that marks expired proposals.**
- **Notifications to approvers.**

**Findings outside the feature (reported, not fixed).**
- F10: the preview omits properties.
- F13: an import overwrites properties wholesale and keeps no prior values.
- F14: the demo imports contracts.
- F24: a delete removes incoming links its plan does not list. r3 fixes this for every caller by reading those links at prepare and deleting only those ids (4.5).
- F25: a create can revive a deleted node of another class. This affects direct submissions. r3 checks the revived set under lock and governs by the prior class.
- F30: subject templates are unrestricted.
- F38 and F46: action definitions' class strings are not checked against the ontology, and the mapping editor's class check folds case and accents. r3 refuses new variants (4.3). Definitions stored before r3 are governed through resolution, and are not rewritten.
- Existing audit action strings can exceed 255 characters, and `sql_mode` is not set (UNVERIFIED).

**Entries to append to `docs/DECISIONS.md`** (not appended, because this turn is read-only; each is `APPROVED BY: nobody — pending`):
1. ENGINEER's r3 choice of (b), and this spec's path.
2. The findings above.
3. The rule-4 reading.

---

## 8. State carryforward

**What was built or declined.**
- **Built:** nothing. This spec is PROPOSED.
- **ENGINEER's choice:** (b). If the owner approves, three pull requests build:
  - class governance (approval required, people only), inherited by every action type that reaches the class, with class strings compared as the database compares them, and a per-workspace governance lock;
  - refusal of variant class strings in new action definitions and mappings;
  - a check that a new class does not adopt existing data into a governed class, and a fail-closed check that the class columns share one collation;
  - approval of changes to governed data by a person other than the maker, applying exactly the change set shown;
  - re-checks under lock when a plan is applied;
  - token drafts adopted only by their creator in session;
  - grants and draft-only for any token;
  - token refusal records;
  - one exported list;
  - the interface.

  Tests: 24 refusal, 18 acceptance, 4 guards.
- **Declined this cycle:** BUILDER's MCP server; refusal records for signed-in people; property-level governance; governance of imports.
- **Logged, not executed:** USER's remit-to detector (3.2).

**Invariants preserved.**
- Every change an outside caller makes **through `/api/v1`** goes through an action type, and is checked, permitted by role and module scope, recorded and audited. This is BUILDER's own scope. Imports, telemetry and the IoT webhook write outside action types (F13, F20, F21).
- An API token authenticates only on `/api/v1` (GUARD-04).
- A token whose creator is on record never acts above that creator. A token without one acts on its own role (F4, 6 Q12).
- An action is applied in one transaction with its submission row and its audit entry.
- Ontos holds no causal estimates, metric values, incentive design or roll-up.

**Invariants r4 would introduce (none exists until it is built).** "Touches" and class comparison are as defined in 4.3:
- a link touches only its *from* object;
- a class string is compared as the database compares it, which is how the typed reads compare it.

The invariants:
- No caller applies, through any action type, a plan that touches a class governed *approval required*. This is checked on the plan, and again under the governance lock (REFUSE-02, REFUSE-07d).
- No API token previews, proposes or submits a plan that touches a *people-only* class, through any action type, and no token-drafted proposal touching one is approved (REFUSE-16).
- A governance change never takes a `workspaces` row lock, and does not deadlock with audit writes (REFUSE-07e).
- No new action definition or mapping names a variant of an ontology class (REFUSE-02g).
- No new class adopts existing data into a governed class (REFUSE-02l).
- Governance is enforced only while the class columns share one collation; otherwise it fails closed (REFUSE-02m).
- No transaction ever takes the governance lock on a missing row (REFUSE-07f).
- A token's proposal is a draft. Only its creator, signed in, can adopt it. A draft-only token cannot apply (REFUSE-18).
- No maker approves their own proposal (REFUSE-03).
- No token approves anything. One call decides one proposal, and decisions are limited (REFUSE-10).
- What an approval applies is the change set its approver was shown, or nothing (REFUSE-06, ACCEPT-02).
- A proposal is decided once (REFUSE-09).
- A token's refusal on a write path is recorded, or answered 503. Each refusal is itemised up to 20 times an hour per (token, action, code), then counted with its action and code. The list of what is not recorded is in 4.10 (REFUSE-20).
- A token learns nothing through its drafts that `preview` does not already tell it (REFUSE-22). The one bit of 3.3 row 21 comes from governance refusals, not from drafts.

**Open VETO conditions that will recur.** All 22 residuals in 3.3. The ones VETO is most likely to rest on:
- two accounts and shared accounts (rows 2 and 3);
- mappings and imports into governed classes by editors (row 8);
- ungoverned data within tokens' reach (row 9);
- reads not narrowed (row 10);
- payment data not recognisable, and governance per class only (row 18);
- imports and telemetry overwriting approved changes (row 19);
- links into a governed object from ungoverned classes (row 20);
- telemetry writing governed objects placed in the twin module (row 22);
- the MCP server, when it is built.

**USER's stated priority for the next cycle.**
- The remit-to change detector, in USER's words: "something that spots a remit-to change buried in an otherwise routine email, pulls it out, and puts it in front of whoever runs the callback, with the phone number we had on file before the email arrived."
- Still open: "whether it lands above the line where my approval matrix says a director signs", and the two-agreements case.

USER's kill conditions stand as acceptance criteria for the next cycle.

---

## Appendix A. How this spec was produced

- **The cycle.** It was run from 2026-10-26 to 2026-10-28 under the author's Adversarial Persona Loop protocol, which is kept outside this repository. It used the personas the owner approved for this feature (D-038).
  - Each persona was a separate agent and spoke once, in the protocol's order.
  - Each was briefed with the protocol, its persona and the turns before it.
  - BUILDER read the code and the README; VETO read the README's security sections and the capability comparison.
  - USER was given no code and was told not to use the product's internal names.
  - Before the next turn began, the orchestrator checked each turn against the protocol's rules for that persona and its anti-patterns, and checked some of its claims against the files. That was three of BUILDER's claims about the code and two of VETO's claims about the README.
  - All four turns passed at the first attempt.
- **VETO's citations.** VETO was briefed to name each authority exactly, to say why it binds the company, and to tie each ground to the proposal. Its notes state which wordings it read at the source and which it took from secondary sources or from memory (Notice).
- **The spec.** ENGINEER's first draft chose (b). Independent reviewers, each a separate agent with read-only access, then reviewed it in four rounds, and ENGINEER revised it after each round:
  1. **Round 1, four reviewers.** The lenses were protocol and honesty, code accuracy, security design, and tests and buildability. They found four blockers. One was in the design: the controls bound only tokens that declared themselves agents. Three were in the tests. The first revision moved the controls onto action types, binding every caller, and made a token's proposal a draft.
  2. **Round 2, the same four reviewers.** They found a design blocker: an ontologist could sidestep governance on an action type with a sibling action type that writes the same data. They also found three test blockers: two fixed tests that would fail against a correct build, and existing tests the change would break without being listed. The second revision moved governance to classes.
  3. **Round 3, the security and tests reviewers.** They found two major design issues: class strings that the database's collation folds into a governed class, and a deadlock between governance changes and audit writes. They also found one test that would fail against a correct build. The third revision fixed them.
  4. **Round 4, the same two reviewers.** They confirmed their round-3 findings resolved, and the tests reviewer judged the test contract ready. The security reviewer found one major gap: records created under a class string not yet in the ontology could be adopted later by a new subclass of a governed class. It also found two minor issues, and the tests reviewer three minor wording issues. This revision (r4) closes all six, and the orchestrator checked its changed lines against the round-4 findings.

  Appendix B states every finding in a sentence and says where this revision answers it.
- **Evidence.** Facts about the code were read from the worktree on 2026-10-28. No test, build, server or engine was run. The items the spec marks UNVERIFIED remain so.
- **What is not published.** The earlier drafts and the reviewers' working files are kept out of the repository, as D-024 did for `xfn`. This appendix and Appendix B are their record.
- **VETO.** No reviewer and no revision clears VETO's grounds. Only VETO can do that, in its next turn.

---

## Appendix B. Review findings and where this revision answers them

Four rounds of review. Round 1 reviewed the first draft, round 2 the second, round 3 the third and round 4 the fourth. Rounds 1 and 2 were by four reviewers: protocol and honesty, code accuracy, security design, and tests and buildability. Rounds 3 and 4 were by the security and test reviewers. Each finding is stated in a sentence. "Fixed" means this revision changes the design or the tests. "Argued" means it explains why the point stands. "Open" means it is listed as not addressed in 3.3 or section 7.

**Round 1**

| ID | Finding | Disposition | Where |
|---|---|---|---|
| 1.A1 | The controls bound only tokens that declared themselves agents, so an ordinary token wired to an agent could apply changes at once. | Fixed; superseded by 2.A1. | 3.0, 4.3 |
| 1.A2 | Persona sign-in lets one person act as several users, defeating segregation of duties. | Fixed in part (flagged); open | 4.12; 3.3 row 1 |
| 1.A3 | Segregation was keyed on a token's creator, not on who drove the token; tokens are shared within teams. | Fixed (creator adopts in session); open in part | 4.4; REFUSE-18e; 3.3 row 5 |
| 1.A4 | One admin could open data to agents and mint the token that uses it. | Argued; open | 3.3 row 6; Q17 |
| 1.A5 | "No bulk approval" held only in the UI; a script could approve many proposals in one request. | Fixed in part (limits); open | 4.1; REFUSE-10; 3.3 row 17 |
| 1.B1 | Deleting an object removed incoming links that were neither shown nor locked. | Fixed | 4.5; REFUSE-06c |
| 1.B2 | Webhook side effects were outside what the approver saw. | Fixed | 4.5; ACCEPT-06 |
| 1.B3 | `{now}` rendered to the millisecond, so an action using it could never be approved. | Fixed (frozen effective time) | 4.4, 4.5; ACCEPT-02 |
| 1.B4 | A create could silently revive a deleted node of another class. | Fixed (shown with prior state; governed by prior class) | 4.3, 4.5; REFUSE-02d, REFUSE-06d |
| 1.B5 | The hash depended on database row order, and link lists could be truncated. | Fixed | 4.5; ACCEPT-07; REFUSE-12e–f |
| 1.B6 | Bidi controls, zero-width characters and look-alike letters could spoof the approval sheet. | Fixed in part; open | 4.12; REFUSE-23; 3.3 row 16 |
| 1.B7 | Token names could carry misleading text into labels and the export. | Fixed | 4.8; REFUSE-15i |
| 1.B8 | The preview summary also drops the old values of removed properties. | Fixed (finding recorded) | F10 |
| 1.C1 | The claim that agent changes never land on imported classes was false. | Withdrawn; warnings; open | 4.5; 3.3 row 19 |
| 1.C2 | Telemetry and the twin simulation also write properties outside action types. | Open | F21; 3.3 row 19 |
| 1.C3 | The mapping editor does not restrict subject templates. | Settled; open | F30 |
| 1.D1 | An unpaired surrogate in a parameter could make a refusal record fail, leaving nothing recorded. | Fixed | 4.10; REFUSE-20c |
| 1.D2 | "Every refused attempt is recorded" overstated what was recorded. | Fixed (exact lists) | 4.9, 4.10 |
| 1.D3 | A flood of refusals would contend the global audit lock. | Fixed | 4.10 |
| 1.D4 | Changes between the checks and the apply were not re-checked under lock. | Fixed | 4.3, 4.6; REFUSE-07 |
| 1.D5 | A status change does not make a new version. | Fixed | F12 |
| 1.D6 | The approver's identity reached tokens. | Fixed | 4.7 |
| 1.D7 | Free text from agents went into the immutable audit chain. | Fixed in part (rationale digest only); open | 4.11; 3.3 row 12 |
| 1.D8 | The scopes for agent tokens contradicted each other. | Resolved (no agent kind) | 4.8 |
| 1.D9 | Class strings were compared raw. | Fixed in round 2 (expanded IRIs); extended in round 3 (the database's comparison, and variants refused at write; 3.S1) | 4.3; REFUSE-02g–h |
| 1.D10 | Expired tokens left their proposals pending. | Fixed | 4.4; REFUSE-19a |
| 1.E1 | An approver who was never permitted would get `not_opened`, not `forbidden_role`. | Fixed | REFUSE-04 |
| 1.E2 | A test expected a date difference that real clocks would not produce. | Fixed | ACCEPT-02 |
| 1.E3 | First-PR tests depended on second-PR code. | Fixed (again in round 2) | 4.15 |
| 1.E4 | The decided-once test could never be shown failing. | Fixed | REFUSE-09 |
| 1.E5 | The no-engine guard spied on a function that is called internally. | Fixed | GUARD-03 |
| 1.E6 | Fixture dates would start failing in 2027. | Fixed | 5.2 |
| 1.E7 | The browser test used the wrong persona names, and its teardown did not survive retries. | Fixed | ACCEPT-16 |
| 1.E8 | Existing tests that would break were not listed. | Fixed | 5.6 |
| 1.E9 | The local command would reach port 8085. | Fixed | 5.1 |
| 1.E10 | Tests did not say when the person opened the proposal. | Fixed | 5.4 preamble |
| 1.E11 | The "no link element" check would fail on IRIs that legitimately render as links. | Fixed | REFUSE-23a |
| 1.E12 | A test could pass without its precondition happening. | Fixed | ACCEPT-05 |
| 1.E13 | An acceptance test had an undefined baseline. | Fixed | ACCEPT-13 |
| 1.E14 | Several smaller test defects. | Fixed | 5.7 |
| 1.E15 | Normative rules had no test. | Fixed | 4.14 |
| 1.F1 | Why (b) holds before VETO rules was not argued. | Argued | 3.3 |
| 1.F2 | The persona section was not verbatim. | Fixed | 1 |
| 1.F3 | The carryforward overclaimed. | Fixed | 8 |
| 1.F4 | The rule-4 reading did not engage USER's strongest cue. | Fixed | 3.2 |
| 1.F5 | An open question read as decided. | Fixed | 3.7 |
| 1.F6 | A quotation was altered. | Fixed | 3.2 |
| 1.F7 | The Notice was incomplete. | Fixed | Notice |
| 1.F8 | Exporting direct submissions might be a second feature. | Argued | 3.6 |
| 1.F9 | Kill conditions were carried to every later cycle. | Fixed | 8 |
| 1.F10 | The submit sequence was inconsistent. | Fixed | 4.7 |
| 1.F11 | Small inaccuracies. | Fixed | header, 3.1 |
| 1.F12 | Missing file and parameter details. | Fixed | 4.15 |
| 1.G | Items marked unverified were settled. | Labels updated | 3.1, 4.2, 5.6 |

**Round 2**

| ID | Finding | Disposition | Where |
|---|---|---|---|
| 2.A1 | Governance on an action type could be sidestepped by any ontologist through a second action type writing the same data. | **Fixed: governance moved to classes and inherited by every plan** | 3.0, 4.3; REFUSE-02, REFUSE-16 |
| 2.A2 | A cap of 600 refusals an hour per caller let a probe hide behind junk refusals. | Fixed | 4.10; REFUSE-20g–h |
| 2.A3 | The export showed a token as the signer, omitted the responsible person, and did not record whether approval was required. | Fixed | 4.6; ACCEPT-04 |
| 2.A4 | The real-time criteria check was a no-op as specified, and the effective time could be backdated. | Fixed (`now` replaced; 24-hour view bound; age shown) | 4.4, 4.6; REFUSE-14, REFUSE-19e–f |
| 2.A5 | Adoption's transaction did not re-check people-only or read the approval setting under lock; approval did not lock the account role. | Fixed | 4.4, 4.6; REFUSE-19l |
| 2.A6 | Incoming-link protection relied on an isolation level the code does not set. | Fixed (delete by link id, for every caller from round 3; foreign-key lock); untested path listed | 4.5; 4.14 |
| 2.A7 | The approver did not see what a revive destroys. | Fixed | 4.5, 4.12; ACCEPT-06 |
| 2.A8 | Tokens gained read reach through their drafts' change sets. | Fixed | 4.7; REFUSE-22 |
| 2.A9 | Problem messages echo caller input, so stored problems are not purely server-written. | Fixed (sanitised) | 4.10; REFUSE-20e |
| 2.A10 | Mapping names in the hash, and a re-read `{actor}`, could invalidate approvals. | Fixed (ids only; stored label) | 4.5; ACCEPT-07 |
| 2.A11 | Whoever holds a token could fill its creator's proposal quota. | Fixed (per-token and per-creator draft caps, separate from pending) | 4.1; REFUSE-21b |
| 2.A12 | The CSV export carried raw bidi and zero-width characters. | Fixed | 4.12; REFUSE-24b |
| 2.A13 | Decline and adoption refusals were audited with no limit. | Fixed | 4.1; REFUSE-10d |
| 2.A14 | Shared accounts defeat segregation of duties like a second account. | Open | 3.3 row 3 |
| 2.A15 | The 5,000-link limit is per query, not per object, so `too_many_links` could fail to fire. | Fixed | 4.5; REFUSE-12e |
| 2.A16 | The import warnings were not re-checked under lock. | Fixed (locking re-read); residual window listed | 4.5; 4.14 |
| 2.B1 | Recording refusals before answering would break existing route tests. | Fixed (listed fixture-only mocks) | 5.6 items 4–5 |
| 2.B2 | The first acceptance test pinned a date that tRPC cannot inject. | Fixed | ACCEPT-01 |
| 2.B3 | The SHACL test could never reach the engine, because no fixture class had a shape. | Fixed | 5.2; REFUSE-13 |
| 2.B4 | First-PR tests still used second-PR code. | Fixed | 4.15; 5.7 |
| 2.B5 | Adding a field to the token creator would break an existing strict test. | Fixed (`TokenCreator` unchanged) | 4.8; 5.6 item 8 |
| 2.B6 | The real-time criteria checks had no test. | Fixed | REFUSE-14, REFUSE-19e |
| 2.B7 | The membership re-check under lock was not tested on its own, and a governance re-check was claimed but not specified. | Fixed | REFUSE-07c–d; 4.3 |
| 2.B8 | `String.prototype.isWellFormed` is outside the server's ES2022 library. | Fixed (helper) | 4.0 |
| 2.B9 | The token-reach guard's file mocks authentication, so it would test only the mock. | Fixed | GUARD-04 |
| 2.B10 | The change set could not be built from existing prepared data. | Fixed (new reads named) | 4.5 |
| 2.B11 | Assorted test defects: unnamed actions, unbuildable sizes, timeouts, ambiguous codes, wrong config, missing scopes. | Fixed | 5.7 |
| 2.B12 | Normative rules were neither tested nor listed. | Fixed | 4.14; 5.4–5.5 |
| 2.C1 | The (b) argument overstated: reads, the agent-facing preset and SDK, and an incomplete residual count. | Fixed | 3.3 |
| 2.C2 | The carryforward and USER table overclaimed. | Fixed | 3.5; 8 |
| 2.C3 | Rule 1 was not argued for the broader scope. | Argued; session refusal records moved out; Q18 | 3.6; 7 |
| 2.C4 | Lock re-checks were claimed beyond what was specified and tested. | Fixed | 4.13; REFUSE-07, REFUSE-19 |
| 2.C5 | A test was said to cover a case it did not. | Fixed | 5.7 |
| 2.C6 | The spec pointed at unpublished review material. | Fixed (this appendix) | header; Appendix B |
| 2.C7 | Small inaccuracies: test lettering; claims about break failures, migrations, citations and the Notice. | Fixed | 3.8, 4.2, 5.4, Notice |
| 2.S1 | No existing test compares a whole action-type row with `toEqual`. | Settled | 5.6 item 7 |
| 2.S2 | No other browser test reads contracts, and seeded contracts end 30 to 365 days out. | Settled | ACCEPT-16 |
| 2.S3 | Prefixed and expanded class IRIs differ only for nodes an action creates with a differently spelled class. | Settled; expanded comparison | 4.3; F38 |
| 2.S4 | `sql_mode` is not set by the repository. | Still unverified | 4.11 |
| 2.S5 | The frozen effective time holds through `prepareSubmission` and `planEdits`. | Settled | 4.5 |
| 2.S6 | Webhook targets are pinned by the definition's version. | Settled | 4.5 |
| 2.S7 | The approval locks are feasible, and their order agrees with existing code. | Settled for the approval locks. The governance change's lock order was wrong, and is fixed in round 3 (3.S2). | 4.3, 4.6 |

**Round 3**

| ID | Finding | Disposition | Where |
|---|---|---|---|
| 3.S1 | A class string in a different letter case or accent, which the default MySQL collation folds into a governed class, was not governed. Yet the app's typed reads listed such objects as that class, and the mapping editor accepted the variant. | **Fixed:** class strings are resolved by the database's own comparison, the one the typed reads use. New variants are refused in action definitions and mappings. | 3.0, 4.3; REFUSE-02g–h, REFUSE-16e |
| 3.S2 | Setting governance locked the `workspaces` row exclusively and then waited for the audit lock, while an audit append held that lock and waited on the same row through a foreign key: a deadlock. | **Fixed:** a dedicated governance-lock row that no foreign key touches; the lock orders are written out. | 4.2, 4.3; REFUSE-07e; 4.14 |
| 3.S3 | The decision text said a plan touches objects it links *to*, but the design counts only a link's *from* object, so data linked into a governed object from another class is ungoverned. | Fixed (text aligned; the modelling rule stated); open | 3.0, 4.3, 4.16; ACCEPT-10; 3.3 row 20 |
| 3.S4 | Governing a revive by the prior class tells a token whether a deleted node of a governed class exists at an IRI. | Argued; open as one bit of read reach | 3.3 row 21; Q22 |
| 3.S5 | A token-drafted proposal adopted before its class became people-only would still apply on approval. | Fixed | 4.3, 4.6 check 10a; REFUSE-16f |
| 3.S6 | Telemetry writes any property of a twin-module object, including a governed object that an approved action placed there. | Open | 3.3 row 22; Q21; 7 |
| 3.S7 | Switching governance off and on again leaves only the audit log to tie a submission made in between to the gap, because the row is deleted. | Argued (audited from → to; `governance_at_apply` is recorded); open | 3.3 row 6 |
| 3.S8 | Several claims in the decision, residuals, USER table, carryforward, untested list and this appendix overstated what the design did. | Fixed | 3.0, 3.3–3.5, 4.14, 8, this appendix |
| 3.T1 | An adoption test changed the matter's status and expected a hash mismatch, but the action's criterion refuses the change first. | Fixed (changes the label) | REFUSE-19d |
| 3.T2 | Listing action types now reads governance, which breaks an existing router test that has no database. | Fixed (fixture-only mock listed; file list updated) | 5.6 item 7; 4.15 |
| 3.T3 | Several breaks for the governance tests could not fail them, because two checks refuse the same case. | Fixed (concrete breaks; an incoming-link case for the plan-only check) | REFUSE-02, REFUSE-16 |
| 3.T4 | A test pins the number of graph writes per file, and the id-only link deletion could add one. | Fixed (reuses the existing write site; no new writers) | 4.5; 5.6 item 9 |
| 3.T5 | A governance test approved a proposal opened before the governance changed, which the hash would refuse. | Fixed (opens after the switch) | ACCEPT-10 |
| 3.T6 | The export test needed two open matters and had one. | Fixed | 5.2; ACCEPT-04 |
| 3.T7 | A test did not pin the new end date, and some dates would fail the action's own criterion. | Fixed | REFUSE-06a |
| 3.T8 | The clock for a draft view's age was unspecified. | Fixed | 4.4; REFUSE-19f |
| 3.T9 | Acceptance tests used action types and a class created only inside a refusal test. | Fixed | 5.2 |
| 3.T10 | The mapping-rename property could not fail as a unit test. | Fixed (moved to MySQL) | ACCEPT-05 |
| 3.T11 | Local MySQL runs could load a local engine-host setting and bypass the engine mock. | Fixed | 5.1 T1, T3 |
| 3.T12 | The drizzle-kit version is settled by the lockfile. | Fixed (label) | 4.2; F47 |
| 3.T13 | Some cases had no break of their own. | Fixed | REFUSE-01, REFUSE-20 |
| 3.T14 | Creating 200 drafts over HTTP risked the test timeout. | Fixed (SQL inserts) | REFUSE-21b |
| 3.T15 | A race test under a lock-dropping break would hang rather than fail. | Fixed (poll until lock wait or settled) | 5.1 T7 |
| 3.T16 | Direct submissions still deleted incoming links by node id, unchecked. | Fixed (link ids read at prepare, checked under lock, for every caller) | 4.5 |
| 3.T17 | The governance re-check was specified twice. | Fixed (once, in 4.3) | 4.3, 4.6 |
| 3.T18 | The persona fixture was unused, and persona flags were untested on the server. | Fixed | ACCEPT-04 |
| 3.T19 | Some normative rules were neither tested nor listed. | Fixed (tests added: REFUSE-02i–k, REFUSE-07e, REFUSE-21d, ACCEPT-08, ACCEPT-10, ACCEPT-12b, ACCEPT-15; the rest listed) | 4.14; 5.4–5.5 |

**Round 4**

| ID | Finding | Disposition | Where |
|---|---|---|---|
| 4.S1 | Records written under a class string that names no ontology class could be laundered into a governed class: an editor creates a class with that name under the governed class, and typed reads then list the records as governed objects that nobody approved. | **Fixed:** `createClass` refuses `class_would_adopt_data` under a governed ancestor, when nodes or definitions already use the new IRI, and takes the governance lock while it checks. | 3.3, 3.4, 3.5, 4.3, 4.9, 4.15, 8; REFUSE-02l; 4.14 |
| 4.S2 | The rule that class strings are compared as the database compares them assumed that the class columns share a collation, and nothing checked it. | **Fixed:** a once-per-process check of the four columns' collations. Every path that enforces governance fails closed with 503 if they differ. | 4.3, 4.9, 4.13; REFUSE-02m |
| 4.S3 | After a re-seed, no governance-lock row exists, and two first users could deadlock on the missing row's gap lock. | **Fixed:** the row is inserted by an autocommit statement before any transaction, and a transaction that finds it missing rolls back and starts again. The lock-order text is corrected. | 4.3, 4.13; REFUSE-07f |
| 4.T1 | The deadlock test's break replaced the governance lock instead of adding to it, so it never reached the deadlock; and a retry could have hidden a deadlock. | Fixed (the break adds the row lock; no-deadlock asserted on both sides; `setClass` not retried) | 4.3; REFUSE-07e |
| 4.T2 | The sanitised-audit case needed a proposal with an ill-formed parameter, which session propose refuses. | Fixed (the row is inserted with SQL; unit fallback) | ACCEPT-08 |
| 4.T3 | An existing test lists action types on the in-memory database with no governance mock. | Fixed (governance reads restricted to what the stand-in evaluates; listed with a fallback mock) | 4.3; 5.6 item 12 |

---

## Status record (appended 2026-10-28; nothing above is changed)

- **Approved** by the owner on 2026-10-28, as (b) (D-041). The owner chose:
  - Q2: (b), not (c);
  - Q13: merge each pull request when CI and the Gate are green, before VETO's next turn;
  - Q18: one feature under rule 1;
  - Q15: publish the spec with D-037 to D-041 in one pull request.
- Every other question in section 6 is settled as ENGINEER recommended.
- The header's "PROPOSED" describes the spec as it was reviewed. This record supersedes it.
- **Built:** nothing yet. Code is written from this spec in the three pull requests of section 4.15.
- **VETO's grounds** are not cleared. Only VETO can clear them, in its next turn.

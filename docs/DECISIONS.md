# Decisions — Ontos

Append-only. Never edit a past entry: add a newer dated entry that supersedes it.
Each entry: date, what was decided, evidence, alternatives rejected, and `APPROVED BY:`,
naming the human instruction, or `nobody — pending` where no human has said yes.

---

## D-001 — 2026-10-14 — Revert the sign-in bypass in `useAuth.ts`

- **Decided:** discard the uncommitted change to `app/src/hooks/useAuth.ts` that returned a
  hard-coded admin user and `isAuthenticated: true` for every visitor.
- **Evidence:** with the bypass, `npm test` in `app` reported 22 failures, all in
  `src/__tests__/useAuthOutage.test.tsx`. After `git checkout -- app/src/hooks/useAuth.ts`,
  that file passed 42 of 42; the full suite passed 1,092 with 1 skipped (exit 0); `tsc -b` exit 0.
- **Alternatives rejected:** keeping the bypass behind a flag. It turned off sign-in for all
  users and broke the outage tests.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Revert the temporary auth bypass … and
  restore the test suite" when asked which thread to take.

## D-002 — 2026-10-14 — `xfn` rules live in a hand-written `xfn-shapes.ttl`

- **Decided:** write the `xfn` SHACL rules by hand in `docs/semantic-layer/xfn-shapes.ttl`
  rather than through the app's generator.
- **Evidence:** `shaclJsonToTurtle` (`app/api/services/rdfBridge.ts`, from line 416) writes
  `minCount`, `maxCount`, `datatype`, `class`, `pattern`, `severity` and `message` only. The
  rules need `sh:sparql` and `sh:in`, which it does not write.
- **Alternatives rejected:** extending `shaclJsonToTurtle` first. That is the larger change,
  and it touches every module's export.
- **APPROVED BY:** nobody — pending.

## D-003 — 2026-10-14 — `xfn:revises` is the one allowed Variable-to-Variable link

- **Decided:** the rule "no triple links one `xfn:Variable` to another" exempts `xfn:revises`,
  so a revised Variable definition does not break it (critique issues L1.1, L2.6).
- **Evidence:** REFUSE-01 and ACCEPT-01 in `app/api/__tests__/xfnSemanticLayer.test.ts`.
  Turning the rule off failed REFUSE-01; removing the exemption failed ACCEPT-01 (mutations
  M1 and M5, 2026-10-14).
- **Alternatives rejected:** a separate definitional-lineage predicate named in an allow-list
  (the critique's other option). It adds a property for no gain at this stage.
- **APPROVED BY:** nobody — pending.

## D-004 — 2026-10-14 — Constituents of an additive Outcome share its unit

- **Decided:** an `Outcome` with `compositionKind "additive"` may only have constituents of
  its own `unitDimension`. Ticket counts and OTIF reach cost only through `EffectClaim`s
  (critique issues L1.8, L2.2, L3.6).
- **Evidence:** REFUSE-02 (mutation M2 failed it) and ACCEPT-06 (mutation M6 failed it).
- **Alternatives rejected:** keeping the draft's breakdown of total cost into ticket rate,
  OTIF and an indemnity flag. All three critiques rejected it.
- **APPROVED BY:** nobody — pending.

## D-005 — 2026-10-14 — Attributed records name one author and one time; privileged records name a holder

- **Decided:** Decision, Commitment, Transfer, Handoff, claims, appraisals, perspectives and
  variable operationalisations require one `xfn:attributedTo` and one `xfn:recordedAt`. A
  record with `accessClass "privileged"` requires `xfn:privilegeHolder`.
- **Evidence:** REFUSE-03 (mutation M3 failed it; only Decision is tested), REFUSE-04
  (mutation M4 failed it), ACCEPT-03 and ACCEPT-06 (mutation M7 failed both).
- **Not done:** redaction tombstones, retention references, and a test of the `accessClass`
  value list.
- **Alternatives rejected:** leaving Decision, Commitment, Transfer and Handoff unattributed,
  as in the draft (critique issues L1.12, L2.7, L3.1). Privilege marking was raised by L3.2.
- **APPROVED BY:** nobody — pending.

## D-006 — 2026-10-14 — `ExposureGap` leaves the semantic layer (proposed)

- **Decided (proposal only):** `xfn:ExposureGap` is not stored in `xfn`; a later diagnostic
  layer would compute it (critique issues L2.1, L3.3, L1.24).
- **Evidence:** none in code. The spec names a refusal test for it (REFUSE-04 in
  `docs/specs/2026-10-14-xfn-semantic-layer.md`), and that test is not written. See D-007.
- **Alternatives rejected:** keeping `ExposureGap` with an admission gate (critique L3.3's
  alternative).
- **APPROVED BY:** nobody — pending.

## D-007 — 2026-10-14 — OPEN: the spec's REFUSE-04 and the test called REFUSE-04 differ

- **State:** the spec's REFUSE-04 is "refuse `xfn:ExposureGap` in Layer 1". The test named
  REFUSE-04 checks that a privileged record names a holder. The spec's test was replaced
  without approval, which the repository's rules forbid.
- **Options:** (a) write the `ExposureGap` refusal as REFUSE-04 and renumber the privilege
  test as a new item in a superseding spec; (b) keep the privilege test and add the
  `ExposureGap` refusal as REFUSE-05 in a superseding spec.
- **APPROVED BY:** nobody — pending (owner's decision).

## D-008 — 2026-10-14 — OPEN: persona instantiation for Ontos not approved

- **State:** `docs/specs/2026-10-14-xfn-semantic-layer.md` drafts BUILDER, USER (COO), VETO
  (General Counsel and CRO) and ENGINEER. The repository's rules require the owner's approval
  before the first cycle; it was not asked for. The spec also contains loop anti-patterns
  (VETO proposing fixes; ENGINEER "accepted in full") and an uncounted figure ("25 classes
  and 68 properties").
- **Consequence:** the spec stays PROPOSED. A superseding spec will be written once the
  personas are approved or changed.
- **APPROVED BY:** nobody — pending (owner's decision).

## D-009 — 2026-10-14 — Correct the `xfn` README and the ACCEPT-06 test data

- **Decided:**
  1. Rewrite `docs/semantic-layer/README.md` to match the evidence: draft status, no link
     into an app-data folder, each rule mapped to the critique issues it covers and how far
     it is tested, and the open items.
  2. Fix ACCEPT-06's data: no claim names the same variable as cause and effect (EC-0101 did);
     Legal's claim is about uncovered liability (V-supplier → V-uncovered-liability); add the
     Finance warranty claim and Legal's privileged indemnity `TermDeviation`, both listed in
     the spec's ACCEPT-06 and missing from the test. No assertion was loosened.
  3. Find `xfn-shapes.ttl` from the test file's own location, not the working directory.
- **Evidence:** the README's 5 links resolve. The suite passed 10 of 10 run from `app`, and 10
  of 10 run from the repository root with `--root app`. A scan of ACCEPT-06 found 6 claims and
  0 with the same cause and effect. Mutations M1 to M7 each failed the tests they target.
- **Alternatives rejected:** keeping the README's earlier claims, which the 2026-10-14
  review found false or overstated.
- **APPROVED BY:** the owner, 2026-10-14, "Agreed. execute", answering the proposal to do
  items 1, 4 and 5 of the review.

## D-010 — 2026-10-14 — The `xfn` tests run on an engine of their own

- **Decided:** `app/api/__tests__/xfnSemanticLayer.test.ts` starts a private engine
  (`startPrivateEngine`, as `engineLoadSize.test.ts` does), builds its own
  `SemanticEngineClient` against it, and stops it after the suite. No assertion changed.
- **Evidence:** before the change, the file used the shared default engine and cleared its
  store before every test, as `semanticEngine.test.ts` does. Run together in one vitest call,
  so that the two files ran at the same time, 6 of 6 runs failed, with 4 to 7 failures each
  in both files. `semanticEngine.test.ts` alone passed 3 of 3 (11 of 11 tests). The full suite
  with the `xfn` file on disk passed 10 of 10 (1,102 passed, 1 skipped): there the two files
  never overlapped, so the collision was latent. After the change the paired run passed 6 of
  6 (21 of 21 tests each), the `xfn` suite passed 10 of 10 twice, `tsc -b` exited 0, and
  eslint on the file exited 0. Before the change, running the suite also cleared whatever
  engine answered on the default port, which on this machine was one using the owner's own
  data directory.
- **Alternatives rejected:** wrapping each test in `exclusive()`, which serialises only within
  one process, not across vitest workers; a lock shared by every engine-backed test file,
  which is a larger change to committed tests.
- **APPROVED BY:** the owner, 2026-10-14, "proceed", after the change was described as "a
  private engine plus its own `SemanticEngineClient` … it needs no change to any assertion".

## D-011 — 2026-10-14 — The evidence of D-003 to D-005 and D-009, checked again

- **What was done:** the suite was run unchanged against a private engine, then against
  copies of `xfn-shapes.ttl` with exactly one rule disabled. Each copy was served to the test
  in place of the real file, and every run logged the hash of the file it was served. Controls:
  an identical copy, 10 of 10 passed; a copy with no constraints, all 10 failed.
- **Mutants (named V-M1 to V-M9, to keep them apart from the M-numbers above) and the tests
  each one failed:** V-M1 Variable-to-Variable rule off: REFUSE-01. V-M2 `revises` exemption
  removed: ACCEPT-01. V-M3 additive-unit rule off: REFUSE-02. V-M4a `attributedTo` constraint
  removed: REFUSE-03. V-M4b `recordedAt` constraint removed: REFUSE-03. V-M5 `privilegeHolder`
  rule off: the test named REFUSE-04. V-M6 `accessClass` value list removed: none. V-M7
  EffectClaim shape removed: none. V-M8 VariableOperationalisation shape removed: none. V-M9
  MetricBinding shape removed: ACCEPT-05 only, because its data is then checked by no shape
  and the client throws on the engine's empty verdict, not because a refusal was lost.
- **What this means for the entries above:** D-003's evidence reproduces (V-M1, V-M2), as do
  REFUSE-02's in D-004 and REFUSE-03's and REFUSE-04's in D-005. The M1 to M7 cited in D-003,
  D-004, D-005 and D-009 are defined nowhere, so those lines cannot be rechecked as written.
  D-004's "ACCEPT-06 (mutation M6 failed it)" and D-005's "ACCEPT-03 and ACCEPT-06 (mutation
  M7 failed both)" did not reproduce: removing a single rule fails neither test. D-009's
  "10 of 10" was measured before D-010 changed the file; D-010 has the current figures.
- **APPROVED BY:** nobody — pending. This entry records evidence; it decides nothing.

## D-012 — 2026-10-14 — What D-004 and D-005 enforce, as shown (narrows both)

- **D-004 as enforced:** a constituent is refused only when it and its additive parent both
  state a `unitDimension` and the two differ. A constituent with no `unitDimension` under a
  USD parent conforms; so does a parent with none over USD and count constituents (both
  shown). The rule compares the stated labels as strings; nothing checks that a unit is
  monetary.
- **D-005 as enforced:** one `attributedTo` and one `xsd:dateTime` `recordedAt` are required
  on the 13 classes `xfn-shapes.ttl` names: AttributedRecord, Claim, EffectClaim, ProxyClaim,
  DivergenceClaim, ForecastClaim, Appraisal, Decision, Commitment, Transfer, Handoff,
  VariableOperationalisation and Perspective. Shown refused: an unattributed Decision,
  Commitment, Transfer or Handoff; two authors; a `recordedAt` given as a plain string. Not
  covered, although spec section 3.2 puts them under AttributedRecord: InterventionSetting,
  VariableCorrespondence, AccountabilityAssertion, DecisionRight, Answerability and
  MetricBinding. An unattributed MetricBinding conforms; an unattributed DecisionRight or
  InterventionSetting gets no verdict at all. TermDeviation is not covered either, so the
  attribution of ACCEPT-06's TD-0042 is not checked. A `privilegeHolder` is required only on
  records typed AttributedRecord, Claim, EffectClaim or TermDeviation: a Decision or an
  Appraisal marked privileged with no holder conforms (shown).
- **Why it matters:** the engine applies a shape to instances of a class's subclasses (shown),
  so loading spec 3.2's class hierarchy would widen both rules, and would make ACCEPT-05 fail,
  because its MetricBinding has no author (shown). See D-013, question 1.
- **APPROVED BY:** nobody — pending. This corrects the record; D-004 and D-005 themselves
  are still pending.

## D-013 — 2026-10-14 — OPEN: questions the next persona-loop cycle has to settle

A review of the spec, the rules, the tests and the drafts on 2026-10-14 left these open. Each
needs the owner, or the next cycle's ENGINEER spec, to decide:

1. Are MetricBinding and the other AccountabilityAssertions, InterventionSetting and
   VariableCorrespondence attributed records? Spec 3.2 says yes; ACCEPT-05's fixture, in the
   spec and in the test, has no author. One of the two has to change.
2. Must every attributed record that is marked privileged name a holder, or only claims?
3. Must an additive outcome and each constituent state a `unitDimension`, and is it a unit
   label or a dimension?
4. Is `viaDecision` only context, or must `claimedCause` be a variable the decision set, as
   the draft and critique issue L2.4 have it? ACCEPT-06 now chains claims through part quality.
5. Do `claimedSign` and "cause differs from effect" belong in this layer's rules? Today a
   claim whose cause is its effect conforms (shown).
6. Bounds on `xfn:revises`: one per Variable, no cycles (a two-way pair conforms, shown), same
   construct, and attributed.
7. Are Variable and Outcome attributed, as the draft and the critiques have them? Whose remit
   is a shared outcome? ACCEPT-06 puts total cost of ownership in Procurement's alone.
8. The draft's `recordStatus` and ordinal-only magnitude: carried forward, or dropped on
   purpose.
9. VETO's conditions still unmet: tombstones and retention, evidence citations, capacity.
   Under the protocol the cycle did not converge, so no code follows from it. The next
   ENGINEER chooses a smaller feature with tombstoning deferred and put back to VETO, or
   declines.
10. Not yet triaged: the executive-realism adoption items (delegated authorship, a draft or
    submitted state, Decision ingestion); seven layer-purity items with no proposal (rollup
    rules, the magnitude band's "normal range", `impactedFunction`, within-band, the depth
    justification of the propagation contract); and the 13 extension-point contracts, which
    no longer match spec 3.2.
11. Where `xfn` rules live in the product: no app code reads `xfn-shapes.ttl`, and the stored
    SHACL form cannot hold `sh:sparql` or `sh:in` (D-002).
12. Upstream additions `xfn` depends on: no `orderLineItem` on Logistics, no `contractSide`
    and no seeded `status` property on Legal's Contract.

- **APPROVED BY:** nobody — pending (owner's decision).

## D-014 — 2026-10-14 — OPEN: the local commit that adds `AGENTS.md` is not public-safe

- **State:** local `master` carries one unpushed commit that adds `AGENTS.md` with the
  internal form of the portfolio rules. That form's own section 6 requires the public-safe
  form before publication, and this repository's main remote is public. Pushing it, or any
  branch cut from local `master`, would publish it. Its subject line, "[Organization]
  [Private]", describes the private mirror, not the public remote.
- **Until decided:** push nothing cut from local `master`; cut branches from the remote's
  `master`.
- **APPROVED BY:** nobody — pending (owner's decision).

## D-015 — 2026-10-14 — OPEN: publishing the `xfn` work

- **State:** the spec, `xfn-shapes.ttl`, the test file and this log are untracked. The
  repository rules require the owner's go-ahead before a spec is committed to a public
  repository, and the spec's personas are unapproved (D-008).
- **To do before publication:** say plainly that the Acme, Apex and NewCo scenario, its
  people, figures and dispute are invented; present the legal citations in the spec and in a
  comment of `xfn-shapes.ttl` as the VETO persona's concerns, not as legal statements; decide
  whether D-001 belongs in the public record; decide how BUILDER is named.
- **APPROVED BY:** nobody — pending (owner's decision).

## D-016 — 2026-10-14 — The Ontos personas are approved, BUILDER by role (resolves D-008)

- **Decided:** the persona instantiation drafted in section 1 of
  `docs/specs/2026-10-14-xfn-semantic-layer.md` is approved as drafted (USER: a chief
  operating officer in a supplier-switch dispute; VETO: General Counsel and Chief Risk
  Officer, with the veto conditions listed there; ENGINEER: full-stack ontologist), except
  that BUILDER is named by role, "repository owner", not by name. Cycle 1 is run again under
  the protocol in a new dated spec that supersedes that one; the old spec stays as a record.
- **Evidence:** the first cycle ran before any approval and broke the protocol (D-008, D-013
  question 9).
- **Alternatives rejected:** approving with BUILDER named, so that published persona dialogue
  would read as the owner's own words; pausing `xfn`.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Approve; BUILDER by role (Recommended)".

## D-017 — 2026-10-14 — REFUSE-04 is the `ExposureGap` refusal (resolves D-007)

- **Decided:** the spec's REFUSE-04 stands: `xfn:ExposureGap` is refused in this layer, by a
  rule that refuses any instance, shown to fail first. The privilege-holder test gets its own
  new ID in the new spec.
- **Alternatives rejected:** giving REFUSE-04 to the privilege rule and adding the
  `ExposureGap` refusal as REFUSE-05.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Spec wins; privilege test gets new ID
  (Recommended)".

## D-018 — 2026-10-14 — `AGENTS.md` reaches the public remote only in its public-safe form (resolves D-014)

- **Decided:** the unpushed commit that adds the internal form of `AGENTS.md` is kept on a
  local-only branch, local `master` is reset to the remote's `master`, and `AGENTS.md` is
  added by pull request with the public-safe form of the portfolio rules (dated 2026-10-09:
  the same rules, without paths, account details or export-control wording). The owner sees
  the diff before anything is pushed.
- **Alternatives rejected:** parking the commit with no public `AGENTS.md`; leaving `master`
  as it was.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Public-safe version via PR (Recommended)".

## D-019 — 2026-10-14 — The `xfn` work stays uncommitted until the new cycle is approved (D-015)

- **Decided:** nothing of `xfn` is committed until the spec of the re-run cycle (D-016) is
  approved; then it is committed on a branch cut from the remote's `master` and goes in by
  pull request. D-015's list of things to do before publication still applies.
- **Alternatives rejected:** committing to a local branch now; a draft pull request now.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Not until the new cycle is approved
  (Recommended)".

## D-020 — 2026-10-14 — Correction to D-013 question 11

- **Corrects:** D-013 question 11 says the stored SHACL form "cannot hold `sh:sparql` or
  `sh:in`". That is wrong about `sh:sparql`. The stored constraint type has a `sparql` slot
  (`app/api/services/rdfBridge.ts` line 21, `sparql?: string`), and `app/db/seed.ts` line
  314 fills it on an HR shape. It is the compiler, `shaclJsonToTurtle`, that never writes
  it: line 21 is the only mention of `sparql` in `rdfBridge.ts`. The stored form has no slot
  for `sh:in` or `sh:nodeKind`. D-002, which speaks only of the compiler, stands.
- **Found with it:** the HR value at `seed.ts` line 314, `"endDate >= startDate"`, is not a
  SPARQL query, and the compiler drops it without a word, so that rule is never enforced.
  The cycle-1 re-run spec reports that the UI's read-only Turtle shows it as `sh:sparql`
  (`studio-utils.ts` line 219, `library/lib.ts` line 174); that part was not rechecked here.
- **APPROVED BY:** nobody — pending. This corrects the record; it decides nothing.

## D-021 — 2026-10-14 — Cycle 1 re-run: ENGINEER chooses (b); the spec awaits the owner

- **State:** cycle 1 was run again under the protocol (D-016), one agent per persona, each
  turn checked. ENGINEER chose (b), a smaller feature: the `xfn` cycle-1 contract as
  hand-written rules and tests only (14 classes, 51 properties, 65 rule units, 20 refusal
  tests with 168 cases, 8 acceptance tests, 2 guards), with nothing seeded or loaded, and
  USER's one-page view as the next cycle's feature. VETO killed the proposal on privilege and
  commitments; ENGINEER does not clear VETO, and no real record may be loaded until VETO
  clears those grounds in a later cycle and the conditions in the spec's section 7 hold. The
  spec is `docs/specs/2026-10-14-xfn-semantic-layer-cycle-1-rerun.md`; it supersedes the
  first spec.
- **Owner decisions inside the spec:** whether MetricBinding stays in this layer (its
  section 6, question 1); the fixture changes it marks as changes of meaning (sections 5.5
  and 5.6); its reading of the protocol's rule 4 (section 3); and the publication questions
  in its section 7, including the superseded spec and the reviewer's note.
- **APPROVED BY:** nobody — pending (the owner approves or rejects the spec).

## D-022 — 2026-10-14 — The cycle-1 re-run spec is approved as written (resolves D-021)

- **Decided:** `docs/specs/2026-10-14-xfn-semantic-layer-cycle-1-rerun.md` is approved as
  written, with the fixture changes it marks as changes of meaning (ACCEPT-06 items 1-5 and
  12, REFUSE-02's change of unit label) and its reading of the protocol's rule 4. Its rules
  and tests are implemented from it, each refusal shown failing first, and go in by pull
  request (D-019).
- **Alternatives rejected:** reading it first and deciding later; declining under (c).
- **APPROVED BY:** the owner, 2026-10-14, choosing "Approve as written (Recommended)".

## D-023 — 2026-10-14 — MetricBinding stays in `xfn`, as the binding fact only

- **Decided:** MetricBinding stays an attributed record of `xfn`, holding only that a seat is
  evaluated on a metric version. Targets, weights, thresholds, periods, scoring and pay
  belong to the incentive system, which is authoritative for them (the spec's section 4.0 and
  section 6, question 1).
- **Alternatives rejected:** refusing MetricBinding in this layer.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Keep it, binding fact only (Recommended)".

## D-024 — 2026-10-14 — The superseded first spec stays out of the public repository

- **Decided:** `docs/specs/2026-10-14-xfn-semantic-layer.md` is not committed to the public
  repository. It is kept locally as the record it is. The current spec and this log record
  that it existed and why it was superseded (D-008, D-016); references to its path here name
  a file that is not published.
- **Alternatives rejected:** publishing it with a notice that it is superseded.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Keep it out of the public commit
  (Recommended)".

## D-025 — 2026-10-14 — The dropped HR rule is fixed in a separate pull request

- **Decided:** the finding in D-020 is fixed on its own, apart from `xfn`: the compiler stops
  dropping stored keys it cannot write without saying so, and the HR rule gets a real form or
  is removed, each with a test seen to fail first.
- **Alternatives rejected:** recording it and changing nothing.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Separate bug-fix PR (Recommended)".

## D-026 — 2026-10-14 — How the approved spec is implemented, and what the tests add to it

- **Decided:**
  1. `docs/semantic-layer/xfn-shapes.ttl` is rewritten in full from the spec's section 4.3:
     65 units in 15 node shapes, each message beginning with its unit ID. The ten class axioms
     of section 4.1 go in a new `docs/semantic-layer/xfn-classes.ttl`.
  2. The fixtures live in `app/api/__tests__/xfnFixtures.ts`. P, ENV, BASE, the additions and
     the acceptance fixtures are written as the spec writes them. A refusal case is a list of
     changes applied to BASE's triples. A small parser reads the part of Turtle the fixtures use
     and throws on anything else. A change that names a triple BASE does not hold, or adds one
     it already holds, throws. No RDF library is added.
  3. `app/api/__tests__/privateEngine.ts` now also returns the path of the binary it started,
     so the suite can log the binary's SHA-256 (T1).
  4. GUARD-02 reads messages and `sh:select` strings through `ENCODE_FOR_URI`, so the test
     decodes them without parsing N-Triples escapes.
  5. **Tests beyond the spec's list.** A "Fixtures" group of three tests: the parser yields
     exactly the triples the engine reads from the same text, for BASE and each addition; the
     168 cases are present and each applies to BASE; and the 129 constraint entries agree with
     the cases' expected results. GUARD-02 check 5 also asserts that there are exactly 15
     `sh:select` strings, so that it cannot pass on an empty result.
  6. T5 and T6 run outside the suite (section 5.6, item 11), from scripts in the session's
     scratch directory. T5 calls the engine over the same HTTP endpoints as `semanticEngine.ts`,
     with the same verdict check, because that module's imports need the database layer's path
     aliases.
- **Evidence:** in `app/`, with `DOTENV_CONFIG_PATH=does-not-exist.env`,
  `node node_modules/vitest/vitest.mjs run xfnSemanticLayer`: 195 passed of 195, exit 0. The
  suite's T1 line names `app\bin\open-ontologies.exe`, SHA-256 `431bcd0d…a629387d`, version
  1.3.0. That file and `bin\open-ontologies.exe` are byte-identical (`Get-FileHash`, both
  38,113,792 bytes), which settles for this run what the spec's T7 left unverified.
  `tsc -b` exit 0; `tsc -p tsconfig.server.json` exit 0, listing all three test files; eslint
  on the three files exit 0. T5: 168 cases, every one conforming with its listed units
  disabled and refused as expected with them in place; 0 findings.
- **Alternatives rejected:** adding an RDF parser (`n3`) as a dependency for tests alone;
  writing BASE as hand-made triples, which would hide the spec's text; running T5 inside the
  suite, against item 11.
- **APPROVED BY:** items 1-4 and 6: the owner's approval of the spec (D-022). Item 5:
  nobody — pending.

## D-027 — 2026-10-14 — Every refusal is shown failing first; three observations differ from the spec's wording

- **Decided:** the rules and tests of D-026 meet T5 and T6, and the spec stays as written.
  Three places where the runs differ from the spec's wording are recorded here instead (a-c
  below). One more assertion beyond the spec joins D-026 item 5's pending list: each refusal
  case checks the exact set of (unit, focus node, component) results. T2 asks for the
  component only for the constraint the case breaks, and T4 allows several results for one
  pair.
- **Evidence:**
  - **T6** (`tsx t6.ts <out> 6`, session scratch, 597 s, exit 0; rules SHA-256
    `f3f17cb4…83d7794`). 138 runs, each of the unchanged suite (195 tests) against one copy of
    the rules, each copy shown served by its hash in the redirect log and in the suite's own
    T1 line. The identity copy failed nothing. Each of the 129 single-constraint copies failed
    every case 4.3 lists against that constraint, the bracketed "also" cases included, and none
    failed GUARD-02. The copy without the `revises` exemption failed ACCEPT-01 in both runs.
    Each of s1-s7 failed GUARD-02; s5, s6 and s7 on check 5 alone. In s4, checks 3 and 4 both
    reported XR-06 on two nodes.
  - **T5** (`tsx t5.ts`, same engine binary): 168 cases. Each conforms with its listed units
    disabled, and each is refused with exactly its expected units against the unchanged rules.
    0 findings.
  - **Observations that differ from the spec's wording:**
    a. s1 (Variable dropped from `xfn:RecordShape`) failed 11 refusal cases: R03-a, R03-l to
       R03-q and R08-a to R08-d. Section 5.3 says s1 and s3 "also fail one refusal case each".
       s3 failed exactly one, R19-01.
    b. The XR-06 and XR-07 `minCount` copies also failed R03-k, whose expected set holds both
       units. 4.3's Cases column does not list R03-k against them.
    c. The copy without the `revises` exemption also failed R08-a, R08-b and R08-d, whose
       fixtures link Variables by `revises`.
  - **Independent audit:** six read-only reviewers compared one slice each against the spec,
    and a seventh agent tried to refute what they reported. No transcription discrepancy was
    found in the rules (65 units, 129 constraints, the 15 SPARQL bodies), P, BASE, the
    additions, ACCEPT-01 to ACCEPT-08 (compared line by line), the 168 cases or the 129
    constraint entries. Three points were upheld, all tests that check more than the spec:
    the exact component sets above, check 5's count of 15, and the Fixtures group.
- **Alternatives rejected:** narrowing the component assertion to the spec's letter before the
  owner rules. That would loosen a passing check that nobody asked to loosen, and it is the
  owner's call either way. Rewriting 5.3's sentence about s1: specs are append-only.
- **APPROVED BY:** nobody — pending (the assertion beyond the spec). The evidence needs no
  approval.

## D-028 — 2026-10-14 — The full suite fails on this machine today, with or without `xfn`

- **Decided:** the `xfn` pull request goes ahead and CI judges it. None of the failing tests'
  time bounds is changed.
- **Evidence:** the full unit suite was run on a private engine (nothing on port 8085), with
  `DOTENV_CONFIG_PATH=does-not-exist.env`. Runs alternated without and with
  `xfnSemanticLayer.test.ts`:
  - Without it: 2 failed of 1,093, then 4 failed.
  - With it: 3 failed of 1,288, then 3 failed.
  - `engineHostServer.test.ts` ("answers 504 at the route's timeout…", e.g. "expected 518 to
    be less than 440") and `workerEngineLock.test.ts` (a test timeout) failed in all four.
  - The other failures differ from run to run, and each is a time bound or a timeout.
  - Run alone, those two files passed 24 of 24, twice.
  - Neither file imports `privateEngine.ts` or anything of `xfn`.
  - Twelve full-suite runs of the same kind passed with 0 failures between 01:02 and 01:08 the
    same day, before this implementation.
- **Alternatives rejected:**
  - Widening the time bounds. That loosens a check to make a run pass.
  - Running the `xfn` file alone through the vitest config. That changes the configuration
    for a failure the file does not cause.
- **APPROVED BY:** nobody — pending.

## D-029 — 2026-10-14 — The tests that check more than the spec are kept (resolves D-026 item 5 and D-027)

- **Decided:** three things stay in `xfnSemanticLayer.test.ts`: the Fixtures group of three
  tests; GUARD-02 check 5's count of 15 `sh:select` strings; and each refusal case's exact
  set of (unit, focus node, component) results.
- **Alternatives rejected:** cutting them back to the spec's letter, with the suite and the
  fail-first campaign run again.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Keep all three (Recommended)".

## D-030 — 2026-10-14 — D-001 and the reviewer's note in spec 4.0 are published as written

- **Decided:** this register goes into the public repository with D-001 as written. The cycle-1
  spec goes in with the reviewer's note in its section 4.0 as marked: one reviewer's reading,
  unverified and not legal advice. These are the two publication decisions that spec section 7
  left to the owner.
- **Alternatives rejected:** holding this register back, which would leave the spec and README
  citing entries that are not published; holding the spec back, which would publish the rules
  and tests without the document that specifies them.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Publish as written (Recommended)" for D-001
  and "Publish as marked (Recommended)" for the note.

## D-031 — 2026-10-14 — The `xfn` work goes in by pull request, merged only when CI and the Gate are green

- **Decided:** the eight files staged on `feat/xfn-cycle-1` are committed without an AI
  trailer and pushed to the public repository, and a pull request is opened. It is
  squash-merged when CI and the Gate are green, and master is then mirrored to the private
  copy. If CI fails on the time-bound tests of D-028, the work stops there and is reported,
  not merged. This settles D-028's pending decision.
- **Evidence:** before pushing, on 2026-10-14: the branch came from master `3e3a882`, which
  both remotes also held. `gh repo view` read the public repository as PUBLIC and the mirror
  as PRIVATE. A pattern scan of the staged blobs for keys, tokens, home paths, account names,
  email and export-control wording found 0 hits; gitleaks is not installed here.
- **Alternatives rejected:** opening the pull request and leaving the merge to the owner; not
  pushing yet.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Push, PR, merge when green (Recommended)".

## D-032 — 2026-10-14 — How the dropped HR rule is fixed (carries out D-025)

- **Decided:**
  1. **The compiler refuses a key it cannot write.** When `shaclJsonToTurtle` meets a stored
     constraint key it cannot write, it throws an error that names the class, the path and the
     key. It no longer drops the key without saying so.
  2. **The date rule gets a real form.** It becomes the SHACL core constraint
     `sh:lessThanOrEquals`: on an employment contract, the start date is not after the end
     date. The compiler learns that one key. First, a probe shows that the engine supports it.
  3. **The `hireDate` mismatch is a separate finding.** The HR shape requires `hr:hireDate` on
     EmploymentContract, while the seed puts `hireDate` on Person and `startDate` on contracts.
     It is recorded on its own entry once a validation run shows it, and is not fixed here.
     The date rule uses the property the seeded contracts carry, `hr:startDate`.
  4. **A data migration repairs stored rows.** Migration 0012 rewrites the stored rule in
     databases already seeded, since the seed only inserts.
- **Evidence (read 2026-10-14):**
  - Dropped key: `rdfBridge.ts` lines 449-470 write only `minCount`, `maxCount`, `datatype`,
    `class`, `pattern`, `severity` and `message`. `seed.ts` line 314 stores
    `{ path: "hr:endDate", sparql: "endDate >= startDate" }`.
  - UI: `src/components/library/lib.ts` line 174 shows that rule as `sh:sparql`.
  - Who writes class rules: only the two seeds, at `seed.ts` line 582 and `seed-twins.ts`
    line 165. No API route writes them, and the seed inserts and never updates.
  - Keys in use: across both seeds' rules, `sparql` is the only key the compiler cannot
    write. `seed.ts` has 11 constraints; the twin rules are in `twinModels.ts` lines 51-67.
    So refusing breaks no other stored rule.
- **Alternatives rejected:** compiling the rest and reporting what was dropped; removing the
  date rule; folding the `hireDate` mismatch into this fix; fixing the seed only and leaving
  existing databases to be reseeded by hand.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Refuse, naming it", "Give it a real form",
  "Separate finding" and "Data migration" (each marked Recommended).

## D-033 — 2026-10-14 — Finding: the seeded employment contracts fail the HR shape's `hireDate` rule

- **Decided:** recorded, not fixed (D-032 item 3). The seed's header counts every SHACL
  violation its planted data should raise ("SHACL VIOLATION BUDGET"). This one is not on that
  list, so by the header's own terms it is a modelling mistake to fix in a change of its own.
- **Evidence:**
  - The HR shape requires `hr:hireDate` on every EmploymentContract (`db/seedShacl.ts`), and
    `seed.ts` declares `hireDate` on EmploymentContract as "Start date" (line 243 on master
    `7d2c57b`; line 244 after D-034 moves the seed's rules out).
  - The seed instead sets `hireDate` on Person nodes (master line 730; 688 after D-034). Its
    EmploymentContract nodes carry `startDate` and `type` only (master line 768; 726 after
    D-034).
  - On 2026-10-14 a contract built the way those EmploymentContract nodes are built was validated on a private
    engine (binary SHA-256 `431bcd0d…a629387d`). Data came from `knowledgeGraphToTurtle` and
    shapes from `shaclJsonToTurtle`. The contract does not conform: one `minCount` result on
    `hr:hireDate`. The same contract with a `hireDate` conforms.
  - The seed builds up to 90 such contracts; their exact number is not counted here.
- **Alternatives rejected:** folding it into the date-rule fix (the owner chose a separate
  finding).
- **APPROVED BY:** the owner, 2026-10-14, choosing "Separate finding (Recommended)".

## D-034 — 2026-10-14 — The HR date rule is enforced; how D-032 was carried out

- **Decided:**
  1. **Compiler.** `shaclJsonToTurtle` refuses any constraint key outside the set it writes,
     naming the class, the path and the key. It now also writes `sh:lessThanOrEquals`. The
     `sparql` field is gone from `ShaclConstraintJson`.
  2. **Seed rule.** The seed stores the date rule as
     `{ path: "hr:startDate", lessThanOrEquals: "hr:endDate", severity: "Violation" }` with a
     message. The seed's rules move unchanged into `db/seedShacl.ts`, because importing
     `seed.ts` runs the seed and the tests must read the rule the seed stores.
  3. **Migration.** `db/migrations/0012_hr_date_rule.sql` replaces exactly the old stored
     constraint with the new one, in every workspace.
  4. **UI.** The Library's and the Studio's read-only Turtle, and the Studio's constraint
     list, show `lessThanOrEquals`. Without this, the UI would hide an enforced rule, the
     reverse of the bug.
- **Evidence** (2026-10-14; every engine a private one):
  - **Engine probe:** `sh:lessThanOrEquals` refuses an end date before the start date
    (component `lessThanOrEquals`). It accepts equal dates, a later end date and no end date.
    Without the rule, the same data conforms.
  - **Fail-first, before the fix:** 7 of the 11 new unit and engine tests failed. Among them,
    a contract ending before it starts conformed on a real engine (`expected [] to deeply
    equal [{…}]`).
  - **Fail-first, guard:** with the refusal in and the seed unchanged, "compiles every rule
    the seeds store" failed, naming `hr:EmploymentContract`, `hr:endDate` and `"sparql"`.
  - **Fail-first, migration** (MySQL 8.4): a no-op 0012 failed the rewrite test; an
    over-broad one failed "leaves every other rule as it is"; one that changes something on
    every run failed "changes nothing when run again".
  - **After the fix:**
    - The new tests pass.
    - The MySQL suite: 15 files, 105 passed, 0 failed, 3 skipped (`iotHandover`, which needs
      an MQTT broker).
    - The unit suite: 98 files, 1,298 passed, 0 failed, 1 skipped.
    - `tsc -b` exit 0; eslint on the 10 changed files exit 0.
- **Alternatives rejected:** a copy of the rule in the tests instead of the seed's own, which
  would let the two drift; leaving the UI unchanged.
- **APPROVED BY:** items 1-3: the owner's choices in D-032. Item 4 and the move of the seed's
  rules: nobody — pending.

## D-035 — 2026-10-14 — An import treats a rule the compiler refuses as one it cannot check

- **Decided:** the compiler's refusal is a `ShaclCompileError`. The import's SHACL check
  (`checkImportShacl`, `services/mappingSync.ts`) maps it to `uncheckable`, the result the
  module already gives shapes it cannot read:
  - In `block` mode, the job fails once and is not retried, naming the class, the path and the
    key.
  - In `warn` mode, the job imports, and its record says which rule was not checked.
- **Evidence:**
  - **The bug, from a read-only review of this change before it was pushed:** three reviewers
    each took one area, and a fourth checked their claims.
    - Without this mapping, a refusal was a plain `Error`. The job queue retried it twice more
      (`jobs/worker.ts` line 321; `queue.ts` line 42), re-reading the source each time.
    - In `warn` mode the import failed outright.
  - **Fail-first:** the two new tests in `mappingSyncShacl.test.ts` failed against that code.
    The block-mode test got a plain `Error` where it expected a `PermanentJobError`, and the
    warn-mode import threw.
  - **The other upheld points, fixed before commit:**
    - In D-033, `seed.ts` line numbers read on master would have pointed at other code after
      this change. They are now given for both trees.
    - An assertion in `shaclCompile.test.ts` could not fail. It is replaced by one that counts
      the compiled shapes, which was seen failing when the compiler was made to drop a class.
    - The README now says "constraint key".
- **Alternatives rejected:** failing the job once in both modes, so that nothing is imported
  under a rule that cannot be enforced, even when the mapping is set to warn.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Treat as 'cannot check' (Recommended)".

## D-036 — 2026-10-14 — The HR fix goes in by pull request, merged only when CI and the Gate are green

- **Decided:** the files staged on `fix/hr-date-rule` are committed without an AI trailer and
  pushed to the public repository, and a pull request is opened. It is squash-merged when CI
  and the Gate are green, and master is then mirrored to the private copy. If anything fails,
  the work stops there and is reported, not merged.
- **Evidence:** before pushing, on 2026-10-14: the branch came from master `7d2c57b`, which
  both remotes also held, and `gh repo view` read the public repository as PUBLIC.
  - Staged: 16 files, +538 / -52.
  - A pattern scan of the staged blobs for keys, tokens, home paths, account names, email,
    export-control wording and AI-tool attribution found 0 hits.
  - Unit suite: 1,300 passed, 0 failed, 1 skipped. MySQL suite: 105 passed, 0 failed,
    3 skipped. Both ran on a private engine.
- **Alternatives rejected:** opening the pull request and leaving the merge to the owner; not
  pushing yet.
- **APPROVED BY:** the owner, 2026-10-14, choosing "Push, PR, merge when green (Recommended)".

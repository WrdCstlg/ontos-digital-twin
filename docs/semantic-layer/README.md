# Cross-Functional Core (`xfn`) — draft

**Status: the rules and tests of cycle 1 exist. Nothing of it is in the app.** The SHACL rules
and their tests follow the approved cycle-1 spec (`docs/DECISIONS.md`, D-022). Nothing of `xfn`
is in `app/db/seed.ts`, the module registry, the product's rule compiler, an API or the UI, and
no real record may be loaded until the loading gate below holds.

`xfn` is the proposed semantic layer for cross-functional decision modelling: how a
decision in one business function lands as a consequence in another. It relates the
existing modules (`hr`, `lgl`, `cmp`, `fin`, `log`), and it holds *claims* about
cross-boundary effects, with their claimant and evidence, without ever asserting that a
claim is true. Causal inference, measurement, incentive design and roll-up are separate
systems meant to bind to it through its extension points.

The anchor scenario used throughout (Acme Corp, its suppliers Apex and NewCo, their people,
figures, contract and dispute) is invented for illustration.

| File | Contents |
|---|---|
| [`../specs/2026-10-14-xfn-semantic-layer-cycle-1-rerun.md`](../specs/2026-10-14-xfn-semantic-layer-cycle-1-rerun.md) | The feature spec, approved (D-022): persona-loop cycle 1, run under the protocol with the approved personas, and ENGINEER's spec with its rules and tests. A status record at its end says what was built from it. |
| [`xfn-shapes.ttl`](xfn-shapes.ttl) | The rules: 65 units in 15 node shapes, written by hand from spec 4.3. Each message begins with its unit ID, e.g. `[XR-03a]`. |
| [`xfn-classes.ttl`](xfn-classes.ttl) | The ten class axioms of spec 4.1. Load only these: another hierarchy would make the rules wrong. |
| [`../../app/api/__tests__/xfnSemanticLayer.test.ts`](../../app/api/__tests__/xfnSemanticLayer.test.ts) | The spec's section 5 tests, on an engine of their own; fixtures in [`xfnFixtures.ts`](../../app/api/__tests__/xfnFixtures.ts) |
| [`xfn-draft-spec.json`](xfn-draft-spec.json) | The synthesis draft the cycle started from: 35 classes, 247 properties, 13 extension points, 23 cross-module links, 17 reconciled terminology conflicts, and a walkthrough of the anchor scenario. Cycle 1 admits 13 of its classes and refuses the rest (spec 4.1). |
| [`xfn-draft-critiques.json`](xfn-draft-critiques.json) | The three adversarial critiques of that draft: ontology rigour (27 issues), layer purity (16), executive realism (13); 56 issues in all |

An earlier spec, written before the personas were approved, is superseded and not published
(D-016, D-024).

## What the rules refuse

| Records | Refused | Tests |
|---|---|---|
| Every record (the 10 attributed classes and `AttributedRecord`) | Not exactly one `attributedTo` (an IRI), `recordedBy` (an IRI) and `recordedAt` (`xsd:dateTime`); an `accessClass` other than one of open, restricted, privileged; a `recordStatus` other than one of draft, asserted, withdrawn; a privileged record without its holder seat, or more than one holder; more than one `revises`, a revision of a record of another type, or a revision cycle; `citesEvidence` that is not an EvidenceItem; two statements | REFUSE-03, 05, 06, 07, 08, 20; R16-n |
| Variable | Any triple to another Variable except `revises`; not exactly one definition | REFUSE-01; R15-g, R15-h |
| Outcome | Not stated over exactly one Variable; no function's remit; a constituent that is not an Outcome; a decomposition with no `compositionKind` (only "additive" is admitted) or `unitDimension`, or a constituent without the total's `unitDimension` (compared as exact strings) | REFUSE-02; R15-a to R15-f |
| Decision | No decider (an IRI), seat (a Position), date (`xsd:date`), Variable it sets, or words | REFUSE-12 |
| EffectClaim | No cause, effect, decision, function it speaks for, or words; a mediator that is not a Variable; a cause the decision did not set; an effect that is also a cause | REFUSE-09, 10, 11 |
| Commitment | No direction, promisor, date, counterparty, place it is written down, or words; a commitment the company gave with no seat; an author who is not an `hr:Person`; a contract-captured promise with no `evidencedIn`, or any other with no cited evidence | REFUSE-13, 14 |
| TermDeviation, EvidenceItem | No contract (an IRI), term kind or direction from the lists; no evidence summary or source system | REFUSE-16 |
| MetricDefinition, MetricVersion | No name or owning function; no metric it versions, or no definition text | REFUSE-17 |
| VariableOperationalisation, MetricBinding | Not exactly one Variable and one metric version; not exactly one holder seat, metric and version, or a version of another metric | REFUSE-18 |
| Refused vocabulary | Any `ExposureGap` (derived, so not stored here); any of the 29 classes deferred this cycle; a node typed only `AttributedRecord` | REFUSE-04, 19; R03-k |

ACCEPT-01 to ACCEPT-08 must conform, each alone and with `xfn-classes.ttl` in the same data
graph: a revised definition, an effect claim, a privileged claim with its holder seat, an
operationalised Variable, a scorecard binding, the anchor scenario end to end, two rival
"Savings" definitions side by side, and commitments in and outside an executed contract.

**How far that is shown** (D-027). Each of the 129 constraints was disabled in turn in a
copy of `xfn-shapes.ttl`. Each copy was served to the unchanged suite, and its hash appeared
in the suite's own log. Every copy failed the cases the spec lists against its constraint.
Every refusal case conforms once its listed units are disabled. Three of the tests check more
than the spec asks, which the owner has yet to accept (D-026, D-027).

**What the rules do not check** (spec 4.5 and 7):
- A misspelt or new `xfn:` class name.
- The text datatypes.
- `subFunctionOf`.
- The class of cross-module values, except that a commitment's author is an `hr:Person`.
- Edits after entry, which leave no trace.

`accessClass` is a marking only: nothing enforces it.

## Open items

- **VETO's conditions are not met**, and VETO kills or clears in the next cycle. Under the
  loading gate (spec 7), no real record is loaded into any workspace until three things hold:
  `accessClass` is enforced on every read path; VETO has cleared its grounds 1 and 2; and the
  designs for erasure, tombstones, edit history, retention and sequestration exist.
- **Not integrated** (spec 4.4):
  - The 51 properties of spec 4.2 are not in the seed.
  - The UI's module registry (`app/src/lib/modules.ts`) is a fixed list. Its `ModuleKey`
    admits the five ontology modules, `twin` and `custom` only, and 32 files under `app/src`
    import it.
  - The product's rule compiler (`shaclJsonToTurtle`, `app/api/services/rdfBridge.ts`)
    cannot write 28 of the 65 units, which need `sh:sparql` (15), `sh:in` (7) or
    `sh:nodeKind` (6). It also writes one shape per class, which fits neither the refused-class
    rules nor the one shared shape for every record.
  - There is no API, ingestion, export or UI.
- **Layer purity.** No property of the draft beyond spec 4.2's 51 is in scope this cycle
  (spec 7). So the draft's rollup rules, magnitude band, `impactedFunction` and within-band
  are absent, not resolved. `ExposureGap` is settled: it is refused (XR-04). The additive
  breakdown of total cost is settled for this cycle: additive only, one unit dimension (XR-02).
- **The extension-point contracts are out of date.** The draft's 13 contracts, which the other
  layers are meant to bind to, do not match spec 4.1-4.2.
- **IRI collision.** The scenario's contract IRIs `ACME-CTR-0042` and `ACME-CTR-0017` are
  IRIs the seed generates for demo contracts. They must not collide before any `xfn` record is
  loaded into a seeded workspace (spec 7).
- **Upstream properties the draft assumes do not exist** in `app/db/seed.ts` (read
  2026-10-14): no `log:orderLineItem` from PurchaseOrder to InventoryItem, and no seeded
  `status` or `contractSide` property on `lgl:Contract`.
- **The HR date rule is fixed apart from `xfn`.** The seed stored it as a `sparql` value that
  is not a query, and the compiler dropped it without saying so (D-020). It is now
  `sh:lessThanOrEquals`, and the compiler refuses any constraint key it cannot write (D-034). A related
  finding stays open: the seeded employment contracts fail the HR shape's `hireDate` rule
  (D-033).
- **The tests start an engine of their own** (D-010), so they never touch the engine on the
  default port.

## Why it is a draft

The design ran as a multi-agent workflow: eight domain agents, five architecture agents, one
synthesis agent, then four critics and a final pass meant to fold their findings in. Three
critics ran. The fourth, integration against this codebase, and the final pass both failed
when the run hit a usage limit. The integration findings above come from reading the code on
2026-10-14. Cycle 1 of the persona loop then narrowed the draft to the vocabulary and rules
above. Later cycles decide the rest, VETO's grounds first.

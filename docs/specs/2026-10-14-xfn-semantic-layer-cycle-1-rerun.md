# Feature Spec: Cross-Functional Core (`xfn`), cycle 1 re-run

**Date:** 2026-10-14
**Status:** PROPOSED. Nothing here is approved, built or committed until the owner approves it (D-019).
**Supersedes:** `docs/specs/2026-10-14-xfn-semantic-layer.md`, which stays as a record (D-016).
**Author:** ENGINEER, after cycle 1 of the Adversarial Persona Loop was run again under the protocol (see Appendix A).

> **Notice.** The anchor scenario (Acme Corp, Apex, NewCo, their people, contracts, figures and dispute) is invented. Legal authorities named anywhere in this spec, the persona instantiation and turns included, are the VETO persona's concerns, not legal statements; the one exception is the reviewer's note in 4.0, which is one reviewer's reading, unverified and not legal advice. The persona turns are generated dialogue, not statements by any person. No rule here makes a legal determination.

---

## 1. Persona instantiation (approved, D-016)

Reproduced from section 1 of the superseded spec as the owner approved it, with BUILDER named by role.

### BUILDER
- **Who:** the repository owner (named by role, D-016).
- **System:** Ontos (Enterprise Ontology Management & Digital Twin Platform)
- **Invariant:** No direct Variable-to-Variable relational triples without mediation through an AttributedRecord (`EffectClaim` via `Decision`). Layer 1 (semantics) must remain strictly segregated from causal estimation (Layer 2), time-series measurement (Layer 3), incentive evaluation (Layer 4), and diagnostic propagation (Layer 5).
- **Proposed Feature:** The Cross-Functional Core (`xfn`) module: 25 classes and 68 properties linking `hr`, `lgl`, `cmp`, `fin`, and `log` into a single governed consequence topology. *(Editor's note: "25 classes and 68 properties" matches neither the draft, which has 35 classes and 247 properties, nor the superseded spec's section 3.2, which lists 33 classes. Section 4 gives the counts that apply.)*

### USER
- **Role:** Chief Operating Officer (COO) overseeing ExCo operations.
- **Current Situation:** VP of Procurement and VP of Customer Operations & Quality are in an active dispute before the CEO. Procurement claimed a $2.4M cost reduction by switching component suppliers under contract ACME-CTR-0042. Operations and Quality are dealing with a 45% surge in RMA defect teardowns, expediting freight charges, and discovery that the new supplier contract omitted standard product liability indemnification clauses.
- **Expectation:** Needs to see the whole decision chain in one place — the supplier switch decision, the cost savings claims, the defect ticket rate, the missing indemnity clause, and the impacted functional remits — backed by evidence, without the system declaring either executive "guilty" or fabricating causal certainty where there is only attribution.
- **Consequence of Tool Failure:** If the platform forces a single executive to take the blame, bakes in contentious unvetted claims as objective truth, or crashes under conflicting department definitions, the COO closes the tab, ExCo dismisses the digital twin as an academic toy, and cross-functional decisions revert to political warfare in slide decks.

### VETO
- **Role:** General Counsel & Chief Risk Officer.
- **Authority & Concerns:** 
  1. *Federal Rules of Civil Procedure Rule 26(b)(3) (Attorney Work Product) & Attorney-Client Privilege:* If an executive or in-house lawyer records a permanent, un-redactable assertion in an operational knowledge graph stating "we lost indemnity coverage on component C due to unapproved deviation," that triple is discoverable in commercial litigation with the vendor or customer product liability actions.
  2. *FRCP 37(e) & Records Retention:* Permanent immutability cannot prevent governed redaction or tombstones required by court orders or GDPR Article 17 (Right to Erasure) for person-attributed records.
  3. *Unattributed Corporate Acts:* Core institutional commitments, transfers, and decisions cannot be anonymous or entered post-hoc without an author, timestamp, and capacity.
- **Veto Conditions:** Kills any feature where:
  - High-liability risk claims cannot be marked as privileged and protected by access classifications.
  - Institutional commitments and contracts lack attributed authorship and evidence citations.
  - Records cannot be formally tombstoned under legal retention rules.

### ENGINEER
- **Role:** Full-Stack Ontologist & Systems Architect.
- **Mandate:** Synthesizes the loop into a hardened, buildable, and testable engineering specification that satisfies USER's operational dilemma, unblocks VETO's discoverability objections, and preserves BUILDER's architectural invariants.

---

## 2. Cycle 1 transcript (generated persona dialogue; see the Notice above)

Each persona was a separate agent, speaking once, in the protocol's order. Each turn was checked against the protocol before the next was written (Appendix A).

### Turn 1: BUILDER

> I own Ontos, and Ontos owns one layer of five: meaning. Its five modules, hr, lgl, cmp, fin and log, each hold one function's vocabulary, and none can say that a decision taken in one function's remit lands in another's. A supplier switch sits in fin, the contract under it in lgl, the late shipments in log; the line between them, and who drew it, lives in slide decks. That gap is the problem.
>
> The feature is the Cross-Functional Core, xfn: a sixth module that relates the other five without editing them. Its edges start at xfn nodes and point into the function modules, never back, so removing it breaks none of them. I am proposing it from the committed draft, 35 classes and 247 properties, with two changes. Decision, Commitment, Transfer and Handoff, unattributed in the draft, become attributed records. ExposureGap goes: it is derived, and derived things do not live here. The centre is the effect claim: an n-ary record naming a cause Variable, an effect Variable, usually the Decision it runs through, one author and the function that author speaks for. xfn holds the claim and never asserts it. Its record status tracks what was said, not whether it is true; verdicts arrive only as attributed appraisals; metric definitions carry no values.
>
> The invariant this feature exists to preserve: no triple links one Variable directly to another; every arrow between two Variables runs through an attributed record. No property in the draft has Variable as both domain and range. The one direct link I allow is xfn:revises, which records that a definition replaced an earlier one and claims no effect. The other half holds too: causal estimation, measurement, incentive scoring and propagation stay in their own systems, and xfn keeps only the names they key on.
>
> Refusing a Variable-to-Variable triple needs sh:sparql. The app's SHACL compiler does not emit it, and no app code reads the hand-written shapes file where the rule lives today. That rule is part of this feature: a seeded xfn without it in force describes the invariant and does not preserve it.

### Turn 2: USER

> It's 6:40 a.m. On my desk is the pre-read for this morning's session with the CEO: Procurement's two-page memo booking $2.4 million in savings under ACME-CTR-0042, Quality's RMA tracker showing defect teardowns up 45% since the changeover, and the signed contract with Legal's yellow tab on the page where the product liability indemnity should be and isn't. I have forty minutes before I'm asked who's right.
>
> I opened this to get one page I can hand across the table. I need to see who approved the vendor change and when, what each VP is asserting, where every number came from, and which departments are absorbing the fallout. Procurement measures savings at unit price. Operations measures landed cost, with the expedite freight included. I expected both definitions side by side, each with an owner's name on it, and neither one quietly picked as the official figure.
>
> The missing clause is a different kind of thing. Anyone can check whether the clause is in the signed document. Whether the new parts drove the teardowns is somebody's opinion, and I want to know whose it is and what they're resting it on.
>
> Here is what ends it for me. If this tells me the vendor change caused the defect surge as settled fact, I'm done. If it hands the CEO one name to blame, I'm done, and so is this tool's reputation on the executive floor. If I put a number in front of ExCo and can't trace who said it and when, I've armed one VP against the other. And if it locks up, or silently picks a winner because two departments mean different things by "savings," we're back to dueling presentations by nine.

### Turn 3: VETO

> I kill this on two grounds, and name a third I do not rest the kill on.
>
> Privilege. In the draft's walkthrough my office enters EC-2025-0144, "virtually certain" the supplier switch cost us indemnity cover, kept verbatim and frozen once asserted. The proposal gives it no privilege marking and no access class. Under Upjohn Co. v. United States, 449 U.S. 383 (1981), privilege protects communications, not facts: whether the clause is in the contract was never privileged. My assessment can be, while it stays confidential; circulating it beyond those who need it puts that in issue. FRCP 26(b)(3)(A) ordinarily shields only documents prepared in anticipation of litigation or for trial, and its 1970 Advisory Committee note excludes material assembled in the ordinary course of business. ABA Model Rule 1.6(c) states the lawyer's duty: reasonable efforts to prevent unauthorized access to information relating to a representation. My first condition is met.
>
> Commitments. A Commitment gains an author, but the draft's author is "claimant, author, preparer or recorder": possibly whoever keyed it in. Nothing says who gave the promise, or in what office. Its one evidence link, evidencedIn, is absent whenever the promise is not in an executed contract. Whether a promise binds us turns largely on the actual or apparent authority of whoever made it (Restatement (Third) of Agency §§ 2.01, 2.03). FRE 803(6)(A) lets our record of it past the hearsay rule only if made at or near the time by, or from information transmitted by, someone with knowledge; this record does not say who that was. My second condition is met.
>
> Disposal. The draft says withdrawal is never deletion. That breaches nothing I can name today: FRCP 37(e) reaches ESI that should have been preserved for litigation and was lost through a failure to take reasonable steps; it obliges no one to delete, and neither does a legal hold. My third condition is not met. It will be once this graph holds personal data that GDPR Article 17(1) obliges us to erase, subject to exceptions such as 17(3)(e) for legal claims, or once a record copies a document produced to us in discovery and the producer gives notice of a privilege or work-product claim under FRCP 26(b)(5)(B), which obliges us to promptly return, sequester or destroy it and any copies.
>
> This does not ship.

### Turn 4: ENGINEER

ENGINEER's spec is sections 3 to 8.

---

## 3. ENGINEER's decision

**Notice.** The anchor scenario (Acme Corp, Apex, NewCo, their people, contracts, figures and dispute) is invented. Legal authorities named anywhere in this spec, the persona turns included, are the VETO persona's concerns, not legal statements; the one exception is the reviewer's note in 4.0, which is one reviewer's reading, unverified and not legal advice. No rule here makes a legal determination.

**Status: PROPOSED.** Nothing in this spec is approved, built or committed until the owner approves it (D-019). It supersedes `docs/specs/2026-10-14-xfn-semantic-layer.md`, which stays as a record (D-016). The acceptance and refusal tests in section 5 are fixed here, before implementation, and changing them later needs the owner's approval.

**Decision: (b), a smaller feature.**

If the owner approves this spec, the cycle's code is the cycle-1 contract of `xfn`. That is 14 classes, 51 properties, and 65 rule units in 15 node shapes, written by hand in `docs/semantic-layer/xfn-shapes.ttl`. A test file holds 20 refusal tests (168 cases), 8 acceptance tests and 2 guards, and runs on an engine of its own (D-010). Nothing is seeded, nothing is loaded into a workspace, and nothing reaches the UI. The partial value: the meaning and refusals that USER's page will rest on are fixed and shown to hold before any real record exists. The page itself is not built this cycle.

**Rule 4: USER's page is not a different feature.** USER asks for one page with five things: who approved the vendor change and when, what each VP asserts, where each number came from, which departments absorb the fallout, and both definitions of savings side by side with an owner's name on each. BUILDER's feature is the vocabulary those facts are recorded in. ENGINEER reads the page as the same feature seen from its reader's side, for two reasons:

1. Every item on USER's list is a record this vocabulary defines: Decision, EffectClaim, EvidenceItem, the path from an Outcome to its remit, and MetricDefinition. Without them the page has nothing to show.
2. The protocol bars USER from the app's vocabulary. A USER in a semantic-layer cycle will therefore always describe the view, not the schema. If every such description counted as a different feature, rule 4 would turn every semantic-layer feature away.

So the cycle does not pivot. BUILDER's proposal is declined in the form proposed, not "logged, not executed", and the page is the next cycle's feature (section 8). The owner may read rule 4 the other way. In that case the page is a different feature and the cycle pivots to it. ENGINEER's decision on the page would then be (c), because the page first needs this contract and access enforcement on every read path, and building this contract becomes BUILDER's reframe in a new cycle. Under that reading, nothing in this spec is built this cycle.

**How (b) unblocks VETO.** VETO's grounds are about real records. The two it kills on:
- Ground 1 is a real privileged assessment circulating beyond those who need it.
- Ground 2 is a real company record of a real promise that does not say who gave it, in what office, or who had knowledge of it.

What this cycle would build is three files in a repository: hand-written rules, class axioms, and a test file whose records are invented and loaded only into a throwaway engine. It creates no real record and no place to put one. Nothing is seeded and no workspace loads `xfn` data. The gate in section 7 forbids loading any real record, commitments included, until `accessClass` is enforced on every read path, VETO has cleared grounds 1 and 2 in a later cycle, and the disposal designs that ground 3 needs exist. That is the sense in which (b) unblocks VETO: nothing VETO named is within reach of what is built.

The design also gives VETO's next turn concrete fields to judge, where today there are none: `accessClass`, `privilegeHolder`, `promisedBy`, `promisedInCapacityOf`, an individual author on every commitment, and required evidence. Whether those fields answer grounds 1 and 2 once real records are loaded is for VETO to decide in the next cycle. ENGINEER does not clear VETO. This is the "smaller feature with tombstoning deferred and put back to VETO" that D-013 question 9 anticipated. If the owner reads VETO's "This does not ship" as reaching the rules and tests themselves, the honest choice is (c): nothing is written, and this spec stands as the record of the design.

**Why not (a).** Option (a) needs `xfn` in the product, with BUILDER's invariant in force there and VETO's privilege ground answered there. The product has neither:

1. **The product cannot carry the rules.** `shaclJsonToTurtle` (`app/api/services/rdfBridge.ts`, lines 416-485) writes only `minCount`, `maxCount`, `datatype`, `class`, `pattern`, `severity` and `message` (lines 449-470). The stored constraint type has a `sparql?: string` slot (line 21) that the compiler never writes, and it has no slot for `sh:in` or `sh:nodeKind`. 28 of this spec's 65 units need one of those three (4.4). BUILDER's own condition was that a seeded `xfn` without the rule in force describes the invariant and does not preserve it, so `xfn` is not seeded.
2. **Nothing reads an access class.** A search of `app/` for "xfn" finds only the test file (verified 2026-10-14). A privilege marking that no read path honours is only a label. Whether the app's existing role-based access control could enforce a per-record class was not examined (UNVERIFIED).

**Why not (c).** The refusals this layer owes USER and VETO can be specified, and shown failing first, without the app. The engine evaluates `sh:sparql` (D-011), and the suite already runs on a private engine (D-010). Declining would leave the draft as the only statement of `xfn`, and the draft has no access marking at all. Verified 2026-10-14: none of the draft's 247 properties is `accessClass`, `privilegeHolder` or `recordedBy`.

**Where this spec departs from BUILDER's proposal** (under protocol rule 5, ENGINEER's spec wins):
- **Classes.** This is not "the draft with two changes". The spec admits 13 of the draft's 35 classes plus `VariableOperationalisation` from spec 3.2. Of the draft's other 22 classes, ExposureGap is refused permanently and 21 are refused this cycle. Spec 3.2 adds 8 more names, which are refused this cycle.
- **Seeding.** Nothing is seeded.
- **Every arrow is anchored to its decision.** A claim's cause must be a variable its decision set. Chains of claims by different authors cannot be recorded.
- **Attribution.** Variable and Outcome are attributed records, as the draft had them. Every record names the person who entered it, separately from its author, and a commitment's author must be an individual.
- **No verdicts.** There is no verdict of any kind this cycle, BUILDER's attributed appraisals included: Appraisal is deferred.

### Trade-offs: what is given up, and by whom

1. **USER (the COO).** USER gets no page this cycle and nothing usable at 6:40 a.m. What USER gets instead is a vocabulary in which several things cannot be recorded: a settled-verdict status, an unowned definition, an unattributed or untimed record, or an arrow that no single person asserted. The page is later work, gated on integration (section 7).
2. **BUILDER.** BUILDER gets no seeded module, and 14 classes and 51 properties instead of the 35 and 247 proposed. The invariant is in force only in the rules file and its tests, not in the product.
3. **Quality, Support and Finance as authors.** An author can record an arrow about the decision only from the variable the decision set (the supplier), naming intermediate variables as mediators. Two kinds of claim cannot be recorded: a claim about a mid-chain link alone ("bad parts raise tickets"), and a standing claim with no decision. An author who knows only the mid-chain link must either speak to the whole arrow or record nothing.
4. **Support, and anyone whose effects are not stated as outcomes.** With `impactedFunction` dropped, who bears a claimed effect is read only by the path from `claimedEffect` to an Outcome's `statedOver` and then to its `inRemitOf`. An effect on a Variable that no Outcome is stated over has no bearer that can be derived. Someone must record an Outcome for every effect variable, or that function's fallout is invisible on the page.
5. **The CPO and every VP.** There is no appraisal, dispute or endorsement record. A disagreement is a second claim on the same arrow, in its author's own words. Nobody, Legal included, can record a verdict.
6. **USER again, on remit.** The layer does not check a total's remit against its parts' remits (6, Q7). A total placed in one function's remit by its author is accepted. Keeping the page from handing the CEO one name depends on the page showing each constituent's remit next to the total's.
7. **Everyone who records.** Every record needs five envelope fields, every Variable and Outcome included. A commitment needs seven more fields, an individual as author, and evidence. The data-entry cost falls on analysts and category managers.
8. **Commitments with no written trace.** A promise with no evidence item at all cannot be recorded, even a verbal one. The minimum is an EvidenceItem saying "none: recollection", with its own author. Some real promises will go unrecorded rather than be recorded without a source.
9. **Legal (VETO).** Privilege is a marking plus a named holder seat, not access control. There are no privilege-basis or privilege-log fields. The layer neither forbids deletion nor provides it, and keeps no edit history. All of this stays open (section 7).
10. **Later layers (causal estimation, propagation).** There is no claimed sign, preferred direction, magnitude band or impacted-function list. Nothing from this cycle tells a consumer whether an effect is good or bad for a function.
11. **Finance and the measurement layer.** `unitDimension` says what kind of quantity an outcome is ("money"), not its currency. A total whose parts are reported in different currencies is admitted. Nothing checks the units of the values that would be summed; that is the measurement layer's job.
12. **The incentive layer, if the owner admits MetricBinding (6, Q1).** `xfn` would hold the attributed fact that a seat is evaluated on a metric version, and the incentive system would hold terms and scoring. Two systems would then speak about the same binding, and the boundary has to be kept by decision, not by code.
13. **Readers of delegated records.** A record entered by someone other than its author is allowed (`recordedBy`) and may stay in `draft`. Any page built on it must show draft records as unconfirmed. Otherwise it will present an analyst's encoding as a VP's words.
14. **The implementer.** The work is 65 units containing 129 constraints, each shown failing alone (T6). It takes 129 constraint mutants, 1 exemption mutant, 7 structural mutants and 168 clean-case runs (T5).

## 4. Normative specification

### 4.0 Conventions

- **Namespace.** `xfn:` = `https://ontos.dev/ontology/xfn/`. The module metadata in section 3.1 of the superseded spec is not carried forward, because nothing is seeded.
- **Records.** A *record* is an instance of one of the 10 attributed classes in 4.1. A rule that applies to "every record" is a node of the one NodeShape `xfn:RecordShape`, whose `sh:targetClass` names `xfn:AttributedRecord` and all 10 attributed classes. Naming each class does not depend on class axioms being loaded. Keeping every such rule in one shape means the cases R03-a to R03-k, which exercise each of the 11 targets, exercise every such rule (GUARD-02 checks the structure).
- **Cross-module ranges.** Ranges in other modules are stored `null` and named in the definition. The tuple format is the `PropDef` type at `app/db/seed.ts` line 237. The null-range convention appears at lines 249, 266, 269 and 294 (verified 2026-10-14).
- **Standard terms used.** `rdf:type`, `rdfs:label`, `rdfs:subClassOf`, `xsd:string`, `xsd:date`, `xsd:dateTime`, and `hr:Person` (`https://ontos.dev/ontology/hr/Person`). Workspace nodes are written with `a <classIri>` (`rdfBridge.ts` line 295), so a seeded person carries `rdf:type hr:Person`.
- **Layer boundary for MetricBinding (pending the owner, 6 Q1).** `xfn` holds only the attributed statement that a seat is evaluated on a metric version. The incentive system holds weights, targets, thresholds, periods, scoring and pay, and is authoritative for them.
- **A reviewer's note on VETO's citation.** A reviewer reads FRE 803(6)(A) as one of several cumulative conditions of one hearsay exception. On that reading, an opposing party's use of the company's own record may fall under FRE 801(d)(2) instead. This was not verified in this cycle and is not legal advice, and no rule here depends on it. The transcript is left as VETO spoke it.

### 4.1 Classes in scope this cycle (14)

| # | Class | Parent | Definition |
|---|---|---|---|
| 1 | `AttributedRecord` | none (abstract) | A record that someone stated, defined, recorded or stipulated something, and when. It never records that the thing is true. A node typed only as this class is refused (XR-19b). |
| 2 | `Variable` | AttributedRecord | A named, neutral state or quantity of the business that claims are about, e.g. "primary supplier of component C". It is the construct, not its metric, its values, a contrast with a past state, or a valence. Someone defined it, so it is attributed. |
| 3 | `Outcome` | AttributedRecord | A state of the business that its author places in one or more functions' remit, stated over one Variable. It may be decomposed by definition into constituent Outcomes, and this cycle only additively. |
| 4 | `Decision` | AttributedRecord | A decision that was taken: who decided, in which seat, on what date, which Variables it set, and what was decided, in words. Proposed decisions and options are out of scope this cycle. |
| 5 | `EffectClaim` | AttributedRecord | One author's claim, made for one function, that the change a Decision made to a Variable it set produces a change in another Variable. Holding the claim never asserts it. |
| 6 | `Commitment` | AttributedRecord | A promise given to or received from an external party. It records who gave it, in which seat (when the company gave it), when, to or from whom, where it is written down, the evidence of it, and the individual whose account the record is. |
| 7 | `TermDeviation` | AttributedRecord | A recorded observation that a named contract departs from, or lacks, a risk-allocating term compared with a benchmark. It records what a document says and can be checked against that document. Any assessment of the consequences is a separate record, an EffectClaim. |
| 8 | `EvidenceItem` | AttributedRecord | A body of evidence that an author relies on. It is described and located, never copied. |
| 9 | `MetricDefinition` | none | The catalogue identity of a named metric, owned by exactly one function. Names are not unique: two functions' "Savings" are two definitions. |
| 10 | `MetricVersion` | AttributedRecord | One operational definition of a metric, in words: what one value means, and its baseline. It holds no values. |
| 11 | `VariableOperationalisation` | AttributedRecord | A record that a MetricVersion measures a Variable, either as its level or as a change in it against the baseline the version states. One Variable may have several, from rival functions. |
| 12 | `MetricBinding` | AttributedRecord | A record that a seat is evaluated on a metric, pinned to the version in force. It holds no target, weight, threshold or payout. Admitted pending the owner's boundary decision (6, Q1). |
| 13 | `BusinessFunction` | none | A durable domain of business responsibility, such as Procurement, Quality, Support, Finance, Legal or Operations. |
| 14 | `Position` | none | A seat that exists independently of who fills it, e.g. "Chief Procurement Officer". This cycle it is identified by its IRI and an optional `rdfs:label` only. |

The 14 classes are 1 abstract class, 10 attributed concrete classes (rows 2-8 and 10-12), and 3 unattributed reference classes (rows 9, 13 and 14).

**Class axioms.** There are ten axioms, the triples `xfn:C rdfs:subClassOf xfn:AttributedRecord`, one for each C among Variable, Outcome, Decision, EffectClaim, Commitment, TermDeviation, EvidenceItem, MetricVersion, VariableOperationalisation and MetricBinding. They live in a new file, `docs/semantic-layer/xfn-classes.ttl`. GUARD-01 and the acceptance tests' second run (T3) use it.

**Not in the vocabulary:**
- **Refused permanently in this layer (XR-04):** `xfn:ExposureGap`. It is derived, and computing it belongs to a later layer.
- **Refused this cycle (XR-19a), 29 names.**
  - From the draft (21): ControlledTerm, AnalyticAgent, Deliberation, BoundaryObject, LegalEntity, Perspective, PerspectiveCorrespondence, Handoff, Transfer, AccountabilityAssertion, DecisionRight, Answerability, DecisionDomain, DimensionBinding, GrainDimension, Claim, ProxyClaim, DivergenceClaim, ForecastClaim, Appraisal, Reading.
  - From superseded spec 3.2 only (8): InterventionSetting, VariableCorrespondence, BoundaryConcept, BoundaryInstance, BoundaryMedium, SeatOccupancy, SeatRelation, and DecisionQuestion, which spec 3.2 names only as the range of `optionOf`.
- **The arithmetic.** The draft has 35 classes (verified 2026-10-14): 13 admitted, 21 refused this cycle and 1 refused permanently.
- **Used only as refused input:** `xfn:causes` (REFUSE-01). It is not a property of the vocabulary.
- **Known gap:** a misspelt or new `xfn:` class name that is in none of these lists is not caught.
- **Load only these axioms.** Loading the draft's or spec 3.2's hierarchy instead of 4.1's would make the rules wrong. The engine applies `sh:targetClass` through `rdfs:subClassOf` (shown 2026-10-14). With `EffectClaim rdfs:subClassOf Claim` or `MetricBinding rdfs:subClassOf AccountabilityAssertion` in the data, XR-19a would therefore refuse every EffectClaim or every MetricBinding.

### 4.2 Properties in scope this cycle (51), as seed tuples

The tuples use the `PropDef` format (`app/db/seed.ts` line 237): `[name, kind, domain, range, datatype, cardinality, definition]`. They are **not** added to `seed.ts` this cycle. Where a requirement depends on a condition, the tuple gives the unconditional cardinality, the definition states the condition, and 4.3 holds the rule. Section 7 lists every declaration that no rule checks.

```ts
// AttributedRecord: the envelope every record carries (9)
["attributedTo", "object", "AttributedRecord", null, null, "1..1", "The one agent who answers for the record's content: the person or org unit whose statement, definition or account it is (hr:Person or hr:OrgUnit, cross-module axiom). On a Commitment it must be an individual (hr:Person): the person whose account of the promise the record is. Never only the person who keyed the record in; that is recordedBy. Must be an IRI. Its class is checked only on a Commitment."],
["recordedBy", "object", "AttributedRecord", null, null, "1..1", "The person who entered the record (hr:Person, cross-module axiom). May be the attributedTo person. Must be an IRI; its class is not checked."],
["recordedAt", "datatype", "AttributedRecord", null, "xsd:dateTime", "1..1", "When the record was first entered, as the record states it. Like every field it can be rewritten in place without trace (4.5), so this layer cannot show that the value is the original entry time. Set against a decision's or a promise's own date, it states how long after the event the record was made; the layer does not judge that gap."],
["accessClass", "datatype", "AttributedRecord", null, "xsd:string", "1..1", "open | restricted | privileged. open: anyone with access to the workspace; restricted: named need-to-know; privileged: restricted, with a claim of legal privilege administered by the privilegeHolder seat. A marking only: nothing enforces it this cycle."],
["privilegeHolder", "object", "AttributedRecord", "Position", null, "0..1", "The seat that asserts and administers a claim of privilege over the record for the company. Required when accessClass is privileged. Records that privilege is claimed, not that it applies."],
["recordStatus", "datatype", "AttributedRecord", null, "xsd:string", "1..1", "draft | asserted | withdrawn: the speech act only, changed in place. draft: entered, not yet confirmed by the attributedTo agent; asserted: that agent stands behind it; withdrawn: that agent retracted it, which removes nothing. No value means true, verified, accepted or settled, and none will be added. Whether a record is superseded is read from revises, not stored."],
["revises", "object", "AttributedRecord", "AttributedRecord", null, "0..1", "The earlier record of the same class that this record replaces. The revising record is a new record; the revision does not change the earlier one. The only predicate allowed between two Variables; it claims no effect."],
["statement", "datatype", "AttributedRecord", null, "xsd:string", "0..1", "The record's content in its author's own words, verbatim. At most one on any record. Required on EffectClaim (the claim), Decision (what was decided, without reference to effects) and Commitment (the promise in the words given). Where a structured field disagrees with it, the statement is the record."],
["citesEvidence", "object", "AttributedRecord", "EvidenceItem", null, "0..*", "Evidence the record's own author relies on. Anyone else brings evidence in a record of their own."],
// Variable (1)
["variableDefinition", "datatype", "Variable", null, "xsd:string", "1..1", "What state or quantity this is, independent of any metric that measures it and of any decision."],
// Outcome (5)
["statedOver", "object", "Outcome", "Variable", null, "1..1", "The Variable whose state the outcome is about."],
["inRemitOf", "object", "Outcome", "BusinessFunction", null, "1..*", "The function or functions whose remit includes the outcome, as the outcome's author states it. No rule relates a total's remit to its constituents' remits; how bearers follow from constituents is a query for the propagation layer."],
["hasConstituent", "object", "Outcome", "Outcome", null, "0..*", "Decomposition by definition: the outcome is, by definition, the sum of these. Never causal; a claimed driver is an EffectClaim. Every decomposition is additive this cycle."],
["compositionKind", "datatype", "Outcome", null, "xsd:string", "0..1", "additive, the only value admitted this cycle: the outcome is the sum of its constituents. Required on an outcome that has constituents."],
["unitDimension", "datatype", "Outcome", null, "xsd:string", "0..1", "The kind of quantity the outcome is, compared as an exact string, e.g. 'money', 'count', 'money per unit'. A dimension, not a unit: the currency or unit that values are reported in belongs to the measurement layer. A rate or per-unit quantity names its denominator ('money per unit'), so it never matches a total's 'money'. Required on an outcome with constituents and on each of its constituents. Nothing is converted in this layer."],
// Decision (4)
["decidedBy", "object", "Decision", null, null, "1..1", "The individual who took the decision (hr:Person, cross-module axiom). Must be an IRI; its class is not checked."],
["decidedInCapacityOf", "object", "Decision", "Position", null, "1..1", "The seat in which that person decided, as the record states it. Whether the seat carried the authority is not checked this cycle."],
["decidedOn", "datatype", "Decision", null, "xsd:date", "1..1", "The date the decision was taken."],
["intervenesOn", "object", "Decision", "Variable", null, "1..*", "The Variables the decision sets directly. Consequences are never listed here; they are EffectClaims."],
// EffectClaim (6)
["claimedCause", "object", "EffectClaim", "Variable", null, "1..*", "The Variable or Variables whose change, made by viaDecision, is claimed to produce the effect. Each must be a Variable that decision intervenesOn."],
["claimedEffect", "object", "EffectClaim", "Variable", null, "1..1", "The Variable claimed to change as a result. Never one of the claim's causes."],
["viaDecision", "object", "EffectClaim", "Decision", null, "1..1", "The decision the claim is about. Every claim this cycle is about a decision."],
["onBehalfOf", "object", "EffectClaim", "BusinessFunction", null, "1..1", "The function whose position the claim speaks for."],
["claimedMediator", "object", "EffectClaim", "Variable", null, "0..*", "Variables the author says the effect passes through, recorded as said. This layer draws no chain from them."],
["magnitudeStatement", "datatype", "EffectClaim", null, "xsd:string", "0..1", "The author's own words on size, e.g. '$2.4 million a year, measured at unit price'. A quotation; this layer holds no value."],
// Commitment (7)
["commitmentDirection", "datatype", "Commitment", null, "xsd:string", "1..1", "given (the company owes it) | received (the counterparty owes it)."],
["promisedBy", "object", "Commitment", null, null, "1..1", "The individual who gave the promise: for a given commitment, the company's person (hr:Person); for a received one, the counterparty's individual who gave it (an IRI for that person; no module has a class for counterparty staff this cycle). Cross-module; must be an IRI; its class is not checked."],
["promisedInCapacityOf", "object", "Commitment", "Position", null, "0..1", "The seat in which the company's person gave the promise. Required when commitmentDirection is given. Records the office stated; whether it carried authority to bind the company is not decided here."],
["promisedOn", "datatype", "Commitment", null, "xsd:date", "1..1", "The date the promise was given."],
["commitmentCounterparty", "object", "Commitment", null, null, "1..1", "The external party the promise is made to or received from (lgl:Party or fin:Vendor, cross-module axiom). Must be an IRI."],
["capturedIn", "datatype", "Commitment", null, "xsd:string", "1..1", "contract | order-form | price-file | email | slide | verbal | tool-configuration | none: where the promise is actually written down, if anywhere."],
["evidencedIn", "object", "Commitment", null, null, "0..*", "The executed lgl:Contract or lgl:Clause containing the promise (cross-module axiom). Required when capturedIn is contract; for any other capturedIn the commitment must cite an EvidenceItem instead."],
// TermDeviation (4)
["deviationInContract", "object", "TermDeviation", null, null, "1..1", "The lgl:Contract in which the term departs or is absent (cross-module axiom). Always present, absences included, so the record can be checked against the document. Must be an IRI."],
["termKind", "datatype", "TermDeviation", null, "xsd:string", "1..1", "indemnity | liability-cap | warranty | termination-right | payment-terms | sla | data-processing | other."],
["deviationDirection", "datatype", "TermDeviation", null, "xsd:string", "1..1", "more-favourable | equivalent | less-favourable | absent."],
["benchmarkContract", "object", "TermDeviation", null, null, "0..1", "The lgl:Contract compared against, e.g. the displaced supplier's (cross-module axiom)."],
// EvidenceItem (4)
["evidenceSummary", "datatype", "EvidenceItem", null, "xsd:string", "1..1", "What the evidence shows and does not show, in its author's words."],
["evidenceSourceSystem", "datatype", "EvidenceItem", null, "xsd:string", "1..1", "The system the evidence came from. 'none: recollection' is a valid value, so a person's account never looks like a system export."],
["sourceLocator", "datatype", "EvidenceItem", null, "xsd:string", "0..1", "Where the source is, outside the graph: a file, an export, a report. A locator, never a copy of the source's content."],
["evidenceSource", "object", "EvidenceItem", null, null, "0..*", "Records in other modules that the evidence rests on: lgl:Contract, lgl:Clause, fin:Transaction, log:Shipment, cmp:Evidence (cross-module axiom)."],
// MetricDefinition (2)
["metricName", "datatype", "MetricDefinition", null, "xsd:string", "1..1", "The name as used in meetings, e.g. 'Savings'. Not unique: two functions' 'Savings' are two definitions, and nothing marks either one as official."],
["definedByFunction", "object", "MetricDefinition", "BusinessFunction", null, "1..1", "The function whose definition this is."],
// MetricVersion (3)
["versionOf", "object", "MetricVersion", "MetricDefinition", null, "1..1", "The metric this version defines."],
["definitionText", "datatype", "MetricVersion", null, "xsd:string", "1..1", "Plain-language statement of what one value means. No values are held."],
["baselineDescription", "datatype", "MetricVersion", null, "xsd:string", "0..1", "What 'before' means for a savings or reduction metric, e.g. 'last-paid unit price' or 'landed cost per unit including expedite freight'."],
// VariableOperationalisation (2)
["operationalises", "object", "VariableOperationalisation", "Variable", null, "1..1", "The Variable measured."],
["measuredBy", "object", "VariableOperationalisation", "MetricVersion", null, "1..1", "The metric version that measures the Variable, either as its level or as a change in it against the baseline the version states."],
// MetricBinding (3), pending the owner's boundary decision (6, Q1)
["holder", "object", "MetricBinding", "Position", null, "1..1", "The seat evaluated on the metric. A seat, never a person."],
["bindsMetric", "object", "MetricBinding", "MetricDefinition", null, "1..1", "The metric the seat is evaluated on."],
["boundVersion", "object", "MetricBinding", "MetricVersion", null, "1..1", "The version in force for the binding. Must be a version of bindsMetric."],
// BusinessFunction (1)
["subFunctionOf", "object", "BusinessFunction", "BusinessFunction", null, "0..1", "The function this one sits under, as recorded; Enterprise is meant as the root. Unattributed and undated this cycle, and used by no rule."],
```

Counted from the list: 9 + 1 + 5 + 4 + 6 + 7 + 4 + 4 + 2 + 3 + 2 + 3 + 1 = 51. No property in it marks a claim true, a definition official, a function to blame, or a record verified.

### 4.3 Rules (65 units in 15 node shapes)

**How units are written.**
- Each unit is one `sh:property` node or one `sh:sparql` node in `xfn-shapes.ttl`. Its `sh:message` begins with its ID in brackets, for example `[XR-03a]`.
- No message states or implies immutability (the current file's "an immutable recordedAt timestamp" does), because none is adopted (4.5).
- No ID is used twice, and no message carries an ID that this table does not define (GUARD-02).
- A core unit may hold several constraints on one path. T6 shows each constraint failing alone.
- Every SPARQL unit reports `$this` as its focus node, and every core unit reports the node that breaks it.

**Shapes.** Counted from the table below: 12 + 2 + 9 + 5 + 8 + 11 + 3 + 2 + 2 + 2 + 2 + 4 + 1 + 1 + 1 = 65 units.

| NodeShape | `sh:targetClass` | Units |
|---|---|---|
| `xfn:RecordShape` | AttributedRecord and the 10 attributed classes (11 names) | XR-03a, XR-03b, XR-03c, XR-05a, XR-05b, XR-06, XR-07, XR-08a, XR-08b, XR-08c, XR-16f, XR-20 (12) |
| `xfn:VariableShape` | Variable | XR-01, XR-15d (2) |
| `xfn:OutcomeShape` | Outcome | XR-02a to XR-02f, XR-15a to XR-15c (9) |
| `xfn:DecisionShape` | Decision | XR-12a to XR-12e (5) |
| `xfn:EffectClaimShape` | EffectClaim | XR-09a to XR-09f, XR-10, XR-11 (8) |
| `xfn:CommitmentShape` | Commitment | XR-13a to XR-13i, XR-14a, XR-14b (11) |
| `xfn:TermDeviationShape` | TermDeviation | XR-16a to XR-16c (3) |
| `xfn:EvidenceItemShape` | EvidenceItem | XR-16d, XR-16e (2) |
| `xfn:MetricDefinitionShape` | MetricDefinition | XR-17a, XR-17b (2) |
| `xfn:MetricVersionShape` | MetricVersion | XR-17c, XR-17d (2) |
| `xfn:VariableOperationalisationShape` | VariableOperationalisation | XR-18a, XR-18b (2) |
| `xfn:MetricBindingShape` | MetricBinding | XR-18c to XR-18f (4) |
| `xfn:ExposureGapShape` | ExposureGap | XR-04 (1) |
| `xfn:RefusedClassShape` | the 29 names in 4.1 | XR-19a (1) |
| `xfn:AbstractRecordShape` | AttributedRecord | XR-19b (1) |

**Units.** In the Mechanism column, "min", "max", "class", "nodeKind", "datatype" and "in" are SHACL core constraints, and "SPARQL" is an `sh:sparql` SELECT given below. In the Cases column, the case listed against each constraint is the one that shows that constraint failing alone.

| Unit | Rule in plain words | Mechanism | Cases |
|---|---|---|---|
| XR-01 | No triple has a Variable as its subject and a Variable as its object, except one whose predicate is `xfn:revises`. | SPARQL | R01-a |
| XR-02a | An Outcome with any `hasConstituent` states a `compositionKind`. | SPARQL | R02-d |
| XR-02b | An Outcome with any `hasConstituent` states a `unitDimension`. | SPARQL | R02-c |
| XR-02c | Each constituent that is typed Outcome states a `unitDimension`. | SPARQL | R02-b |
| XR-02d | Where an Outcome with constituents and a constituent typed Outcome both state a `unitDimension`, the two are equal as exact strings. A missing one is XR-02b's or XR-02c's case. | SPARQL | R02-a, R02-f |
| XR-02e | Every `compositionKind` value is "additive", which also limits it to one. | in | R02-e |
| XR-02f | At most one `unitDimension`. | max | R02-f |
| XR-03a | Exactly one `attributedTo`, and it is an IRI. | min, max, nodeKind | min: R03-a to R03-k; max: R03-l; nodeKind: R03-m |
| XR-03b | Exactly one `recordedBy`, and it is an IRI. | min, max, nodeKind | min: R03-a to R03-k; max: R03-n; nodeKind: R03-o |
| XR-03c | Exactly one `recordedAt`, typed `xsd:dateTime`. | min, max, datatype | min: R03-a to R03-k; max: R03-p; datatype: R03-q |
| XR-04 | Any ExposureGap instance is refused. | `rdf:type` as path, maxCount 0 (fallback in T7) | R04-a |
| XR-05a | A record whose `accessClass` is "privileged" names a `privilegeHolder`. | SPARQL | R05-a, R05-b |
| XR-05b | At most one `privilegeHolder`, and it is a Position. | max, class | max: R05-d; class: R05-c |
| XR-06 | Exactly one `accessClass`: open, restricted or privileged. | min, max, in | min: R06-b; max: R06-c; in: R06-a |
| XR-07 | Exactly one `recordStatus`: draft, asserted or withdrawn. | min, max, in | min: R07-b; max: R07-c; in: R07-a |
| XR-08a | At most one `revises`. | max | R08-b |
| XR-08b | A record revises only a node that shares an `rdf:type` with it. | SPARQL | R08-c |
| XR-08c | No record revises itself, directly or through a chain of `revises`. | SPARQL | R08-a, R08-d |
| XR-09a | At least one `claimedCause`, each a Variable. | min, class | min: R09-a; class: R09-i |
| XR-09b | Exactly one `claimedEffect`, a Variable. | min, max, class | min: R09-b; max: R09-h; class: R09-f |
| XR-09c | Exactly one `viaDecision`, a Decision. | min, max, class | min: R09-c; max: R09-j; class: R09-k |
| XR-09d | Exactly one `onBehalfOf`, a BusinessFunction. | min, max, class | min: R09-d; max: R09-l; class: R09-m |
| XR-09e | A `statement` (the claim). | min | R09-e |
| XR-09f | Each `claimedMediator` is a Variable. | class | R09-g |
| XR-10 | For each `claimedCause` typed Variable and each `viaDecision` typed Decision, the decision `intervenesOn` the cause. A missing or mistyped operand is another unit's case. | SPARQL | R10-a, R12-e |
| XR-11 | The `claimedEffect` is not one of the claim's `claimedCause` values. | SPARQL | R11-a |
| XR-12a | Exactly one `decidedBy`, an IRI. | min, max, nodeKind | min: R12-a; max: R12-g; nodeKind: R12-h |
| XR-12b | Exactly one `decidedInCapacityOf`, a Position. | min, max, class | min: R12-b; max: R12-i; class: R12-c |
| XR-12c | Exactly one `decidedOn`, an `xsd:date`. | min, max, datatype | min: R12-d; max: R12-j; datatype: R12-k |
| XR-12d | At least one `intervenesOn`, each a Variable. | min, class | min: R12-e; class: R12-l |
| XR-12e | A `statement` (what was decided). | min | R12-f |
| XR-13a | Exactly one `commitmentDirection`: given or received. | min, max, in | min: R13-a; max: R13-j; in: R13-b |
| XR-13b | Exactly one `promisedBy`, an IRI. | min, max, nodeKind | min: R13-c; max: R13-k; nodeKind: R13-l |
| XR-13c | Exactly one `promisedOn`, an `xsd:date`. | min, max, datatype | min: R13-d; max: R13-m; datatype: R13-n |
| XR-13d | Exactly one `commitmentCounterparty`, an IRI. | min, max, nodeKind | min: R13-e; max: R13-o; nodeKind: R13-p |
| XR-13e | Exactly one `capturedIn`, from the list in 4.2. | min, max, in | min: R13-q; max: R13-r; in: R13-f |
| XR-13f | A `statement` (the promise in the words given). | min | R13-g |
| XR-13g | A commitment whose direction is "given" names a `promisedInCapacityOf`. Its class is XR-13h's case. | SPARQL | R13-h |
| XR-13h | At most one `promisedInCapacityOf`, and it is a Position. | max, class | max: R13-i; class: R13-s |
| XR-13i | A commitment's `attributedTo` is an `hr:Person`. | class | R13-t |
| XR-14a | If `capturedIn` is "contract", the commitment has at least one `evidencedIn`. | SPARQL | R14-a |
| XR-14b | If `capturedIn` is anything else, the commitment has at least one `citesEvidence`. | SPARQL | R14-b, R14-c |
| XR-15a | Exactly one `statedOver`, a Variable. | min, max, class | min: R15-a; max: R15-b; class: R15-c |
| XR-15b | At least one `inRemitOf`, each a BusinessFunction. | min, class | min: R15-d; class: R15-e |
| XR-15c | Each `hasConstituent` is an Outcome. | class | R15-f |
| XR-15d | Exactly one `variableDefinition`. | min, max | min: R15-g; max: R15-h |
| XR-16a | Exactly one `deviationInContract`, an IRI. | min, max, nodeKind | min: R16-a; max: R16-b; nodeKind: R16-c |
| XR-16b | Exactly one `termKind`, from the list in 4.2. | min, max, in | min: R16-e; max: R16-f; in: R16-d |
| XR-16c | Exactly one `deviationDirection`, from the list in 4.2. | min, max, in | min: R16-g; max: R16-i; in: R16-h |
| XR-16d | Exactly one `evidenceSummary`. | min, max | min: R16-j; max: R16-k |
| XR-16e | Exactly one `evidenceSourceSystem`. | min, max | min: R16-l; max: R16-m |
| XR-16f | Each `citesEvidence` is an EvidenceItem. | class | R16-n |
| XR-17a | Exactly one `metricName`. | min, max | min: R17-a; max: R17-b |
| XR-17b | Exactly one `definedByFunction`, a BusinessFunction. | min, max, class | min: R17-c; max: R17-d; class: R17-e |
| XR-17c | Exactly one `versionOf`, a MetricDefinition. | min, max, class | min: R17-f; max: R17-g; class: R17-h |
| XR-17d | Exactly one `definitionText`. | min, max | min: R17-i; max: R17-j |
| XR-18a | Exactly one `operationalises`, a Variable. | min, max, class | min: R18-a; max: R18-b; class: R18-c |
| XR-18b | Exactly one `measuredBy`, a MetricVersion. | min, max, class | min: R18-d; max: R18-e; class: R18-f |
| XR-18c | Exactly one `holder`, a Position. | min, max, class | min: R18-g; max: R18-h; class: R18-i |
| XR-18d | Exactly one `bindsMetric`, a MetricDefinition. | min, max, class | min: R18-j; max: R18-k; class: R18-l |
| XR-18e | Exactly one `boundVersion`, a MetricVersion. | min, max, class | min: R18-m; max: R18-n; class: R18-o |
| XR-18f | When a binding has a `bindsMetric` typed MetricDefinition and a `boundVersion` typed MetricVersion, the version is a `versionOf` that metric. | SPARQL | R18-p (also R17-f, R17-h, R18-k, R18-n) |
| XR-19a | Any instance of the 29 names refused this cycle is refused. | `rdf:type` as path, maxCount 0 (fallback in T7) | R19-01 to R19-29 |
| XR-19b | A node typed AttributedRecord and none of the 10 attributed concrete classes is refused. | SPARQL | R19-30 (also R03-k) |
| XR-20 | At most one `statement`. | max | R20-a |

**Counts, from the table.**
- **SPARQL units: 15.** XR-01, XR-02a, XR-02b, XR-02c, XR-02d, XR-05a, XR-08b, XR-08c, XR-10, XR-11, XR-13g, XR-14a, XR-14b, XR-18f and XR-19b.
- **Core units: 50.** Together they hold 114 core constraints, and with the 15 SPARQL constraints the file has 129 constraints.
- **Core units using `sh:in`: 7.** XR-02e, XR-06, XR-07, XR-13a, XR-13e, XR-16b and XR-16c.
- **Core units using `sh:nodeKind`: 6.** XR-03a, XR-03b, XR-12a, XR-13b, XR-13d and XR-16a.

**SPARQL bodies.** Each `sh:sparql` declares the `xfn` prefix through `sh:prefixes`, as the current file does. Every operand a unit compares appears in its positive pattern, so a missing operand never fires it.

```sparql
# XR-01
SELECT $this ?p ?o WHERE { $this ?p ?o . ?o a xfn:Variable . FILTER (?p != xfn:revises) }
# XR-02a
SELECT DISTINCT $this WHERE { $this xfn:hasConstituent ?c . FILTER NOT EXISTS { $this xfn:compositionKind ?k } }
# XR-02b
SELECT DISTINCT $this WHERE { $this xfn:hasConstituent ?c . FILTER NOT EXISTS { $this xfn:unitDimension ?u } }
# XR-02c
SELECT $this ?c WHERE { $this xfn:hasConstituent ?c . ?c a xfn:Outcome . FILTER NOT EXISTS { ?c xfn:unitDimension ?u } }
# XR-02d
SELECT $this ?c WHERE { $this xfn:hasConstituent ?c ; xfn:unitDimension ?pu . ?c a xfn:Outcome ; xfn:unitDimension ?cu . FILTER (?pu != ?cu) }
# XR-05a
SELECT $this WHERE { $this xfn:accessClass "privileged" . FILTER NOT EXISTS { $this xfn:privilegeHolder ?h } }
# XR-08b
SELECT $this ?r WHERE { $this xfn:revises ?r . FILTER NOT EXISTS { $this a ?t . ?r a ?t } }
# XR-08c
SELECT $this WHERE { $this xfn:revises+ $this }
# XR-10
SELECT $this ?c WHERE { $this xfn:claimedCause ?c ; xfn:viaDecision ?d . ?c a xfn:Variable . ?d a xfn:Decision . FILTER NOT EXISTS { ?d xfn:intervenesOn ?c } }
# XR-11
SELECT $this ?v WHERE { $this xfn:claimedCause ?v ; xfn:claimedEffect ?v . }
# XR-13g
SELECT $this WHERE { $this xfn:commitmentDirection "given" . FILTER NOT EXISTS { $this xfn:promisedInCapacityOf ?s } }
# XR-14a
SELECT $this WHERE { $this xfn:capturedIn "contract" . FILTER NOT EXISTS { $this xfn:evidencedIn ?e } }
# XR-14b
SELECT DISTINCT $this WHERE { $this xfn:capturedIn ?k . FILTER (?k != "contract") FILTER NOT EXISTS { $this xfn:citesEvidence ?e } }
# XR-18f
SELECT $this ?v ?m WHERE { $this xfn:bindsMetric ?m ; xfn:boundVersion ?v . ?m a xfn:MetricDefinition . ?v a xfn:MetricVersion . FILTER NOT EXISTS { ?v xfn:versionOf ?m } }
# XR-19b
SELECT $this WHERE { $this a xfn:AttributedRecord .
  FILTER NOT EXISTS { $this a xfn:Variable } FILTER NOT EXISTS { $this a xfn:Outcome }
  FILTER NOT EXISTS { $this a xfn:Decision } FILTER NOT EXISTS { $this a xfn:EffectClaim }
  FILTER NOT EXISTS { $this a xfn:Commitment } FILTER NOT EXISTS { $this a xfn:TermDeviation }
  FILTER NOT EXISTS { $this a xfn:EvidenceItem } FILTER NOT EXISTS { $this a xfn:MetricVersion }
  FILTER NOT EXISTS { $this a xfn:VariableOperationalisation } FILTER NOT EXISTS { $this a xfn:MetricBinding } }
```

### 4.4 Where the rules live this cycle, and what is not integrated

**Where they live:**
- **`docs/semantic-layer/xfn-shapes.ttl`.** It holds the 65 units of 4.3, written by hand. After approval the file is rewritten in full from 4.3. Its comments carry no legal citation; unit IDs point to this spec. That goes further than D-015, which asks only that the one citation now in the file (line 47, "FRCP 26(b)(3) Work Product Protection") be presented as the VETO persona's concern, so it is logged as a decision (section 7). Verified: today the file holds 7 node shapes implementing an earlier subset. It does not implement this spec, and D-011's mutant results describe only that earlier file.
- **`docs/semantic-layer/xfn-classes.ttl` (new).** It holds the 10 class axioms of 4.1, used by GUARD-01 and T3.
- **`app/api/__tests__/xfnSemanticLayer.test.ts`.** It is rewritten from section 5, on a private engine (D-010).

**Mechanisms the app's compiler cannot write**, counted from 4.3:
- 28 of the 65 units need a construct the compiler does not write: 15 need `sh:sparql`, 7 need `sh:in` and 6 need `sh:nodeKind`.
- The remaining 37 use only `minCount`, `maxCount`, `datatype` or `class`, which the compiler writes.
- The compiler also emits a shape only for an `OntologyClass` row that carries `shaclJson`, with that class as its single `sh:targetClass` (`rdfBridge.ts` lines 428-439). Two consequences follow:
  - XR-04 and XR-19a could reach the product that way only by declaring ExposureGap and the 29 refused names as classes, which contradicts refusing them as vocabulary.
  - `xfn:RecordShape` would be copied into one shape per class, so GUARD-02's single-shape check would need an equivalent.

**Not integrated into the app** (verified by reading the files on 2026-10-14):
- **The seed.** `app/db/seed.ts` holds no `xfn` module, class or property. A search of `app/` for "xfn" finds only the test file. The 51 tuples in 4.2 are not added.
- **The module registry.** `app/src/lib/modules.ts` has no `xfn` entry. `ModuleKey` (line 7) is a closed union of hr, legal, compliance, finance, logistics, twin and custom, and `MODULES` (from line 27) lists six modules. 32 files under `app/src` import from `lib/modules`, counting each file that has at least one import statement whose path ends in `lib/modules` (33 such statements in all; verified 2026-10-14). The README states the same 32-file count.
- **The rules.** `shaclJsonToTurtle` writes no `sh:sparql`, `sh:in` or `sh:nodeKind`. No app code reads `xfn-shapes.ttl` or `xfn-classes.ttl`.
- **Access.** Nothing reads or enforces `accessClass`. There is no API, ingestion, UI page or export for `xfn`.
- **CI.** The `xfn` test file is untracked (git status, 2026-10-14), so no CI run can have included it. After approval it enters by pull request (D-019).

### 4.5 Rules stated in words that no test can check (normative, untested)

- **Claims are never asserted.** `xfn` holds claims and never asserts them. No property records that a claim is true, verified, accepted or settled. XR-07 guards the one status field.
- **No measured values.** No record holds a measured value as data. A figure appears only inside text, in its author's words: `statement`, `magnitudeStatement`, `evidenceSummary`, `variableDefinition`, `definitionText` or `baselineDescription`.
- **Evidence is located, not copied.** An EvidenceItem locates its source and never copies the source's content into the graph.
- **Access is not enforced.** `accessClass` is not enforced anywhere this cycle. No real record may be loaded into any workspace until it is, and until the other conditions of the loading gate in section 7 also hold.
- **The layer records; it does not judge.** It does not judge whether the `attributedTo` person had knowledge, whether `recordedAt` was close enough to the event, or whether a seat carried authority. It records them so that others can judge.
- **No immutability is adopted.**
  - A revision is a new record that names the earlier one with `revises`, and the revision does not change the earlier record.
  - `recordStatus` changes in place: a draft becomes asserted, and an asserted record becomes withdrawn, on the record itself.
  - Any field may be edited in place, `recordedAt` included, and an edit leaves no trace in this layer.
  - Nothing in `xfn` forbids deleting a record. "withdrawn" is the author's retraction, and it disposes of nothing.
- **Remit is the author's statement.** `inRemitOf` is the outcome's author's statement of remit. How a total's bearers follow from its constituents' remits is a query for the propagation layer, as is who bears a claimed effect.
- **Units of measured values are not constrained.** `unitDimension` is the declared kind of quantity of the construct. XR-02 does not constrain the units of measured values; those belong to the measurement layer.

## 5. Test contract

### 5.1 How every test runs

- **T1. Engine.**
  - Each test loads its input into an empty store of the suite's private engine (D-010). Nothing touches the engine on the default port.
  - Refusal tests validate the fixture alone against `xfn-shapes.ttl`.
  - Every run log records the engine binary's SHA-256 and the version the engine reports.
- **T2. Which rule a violation belongs to.**
  - A violation belongs to unit XR-n when its `focusNode` is the named node and its `message` begins with `[XR-n]`.
  - `ShaclViolation` carries `constraint`, `focusNode`, `path`, `severity`, `message` and `value` (`app/api/services/semanticEngine.ts`, lines 62-69).
  - The engine is shown to return `sh:message` for `sh:sparql` constraints (D-011). The probes reported to this cycle on 2026-10-14, with no hash recorded, also returned it for property-shape constraints (T7). What the engine puts in `constraint` is UNVERIFIED.
  - The first implementation step is one probe of both, on the engine whose hash the run log records. If messages are not returned, stop and report to the owner before choosing another way to attribute violations. If `constraint` names the constraint component, each case also asserts it for the constraint the case breaks.
- **T3. Acceptance.** `conforms` is true and `violationCount` is 0, in two runs: the fixture alone, and the fixture plus the axioms of `xfn-classes.ttl` in the same data graph. Both runs must pass.
- **T4. Refusal.**
  - `conforms` is false.
  - The set of (unit, focus node) pairs in the report equals the case's expected set. Several results for one pair are allowed.
  - No refusal test asserts a total count.
- **T5. Clean cases.** Every refusal case is BASE (5.2) with one stated change, and BASE conforms (GUARD-01). With a case's listed units disabled (T6's method), the case must return `conforms: true`. A thrown error or some other violation is a finding.
- **T6. Fail first, per constraint.**
  - **Method.** A refusal case counts only after it has failed against a copy of `xfn-shapes.ttl` with exactly one constraint disabled. The copy is served to the unchanged test and identified by its hash in the run log, as in D-011.
    - A core constraint is disabled by deleting its one triple, for example `sh:maxCount 1`.
    - A SPARQL unit is disabled by adding `FILTER (false)` to its SELECT.
    - Node and message stay, so GUARD-02 passes against every such copy.
  - **What must fail.**
    - Each of the 129 constraints in 4.3 must fail the case listed against it in the Cases column. That case breaks only that constraint within its unit.
    - Removing the `revises` exemption from XR-01 must still fail ACCEPT-01, as it did under V-M2.
    - Each of GUARD-02's 7 structural mutants must fail GUARD-02.
  - A constraint or mutant that fails nothing is a finding, not a pass.
- **T7. Engine features.**
  - **Shown, with a recorded hash (D-011):** `sh:sparql` with `FILTER NOT EXISTS` and `FILTER (!=)`, and `sh:minCount`.
  - **Seen only in the probes reported to this cycle on 2026-10-14, with no hash recorded:** `sh:in` refused "public"; `sh:class` refused an untyped cause; `sh:maxCount` refused two authors; `sh:datatype` refused a plain-string time; `sh:targetClass` follows `rdfs:subClassOf`; and property-shape constraints returned their `sh:message`, for example "accessClass must be one of: open, restricted, privileged." (an `sh:in`) and "Every AttributedRecord must have an immutable recordedAt timestamp." (an `sh:datatype`). Both messages are in the current `xfn-shapes.ttl` (lines 43 and 37).
  - **Not yet shown:**
    - `sh:nodeKind`;
    - `rdf:type` as an `sh:path` with `sh:maxCount 0`;
    - the property path `+` with `$this` at both ends;
    - `SELECT DISTINCT` in `sh:select`;
    - `FILTER (false)` as a disabling device;
    - a SELECT with ten `FILTER NOT EXISTS` clauses.
  - **Procedure for unshown features.** Each unshown feature first appears in a fail-first run. If one is unsupported, report it. A substitute is admitted only if the same case still fails against its mutant. For XR-04 and XR-19a the planned substitute is `sh:sparql` with `SELECT $this WHERE { $this a ?t }`.
  - **Engine builds.** The binary now at `bin/open-ontologies.exe` (modified 2026-09-10) has SHA-256 `431BCD0D7AB94E7C92FEF5A18A60247D7E6DD4585FADF49E3F5BA025A629387D` (computed 2026-10-14). Its version is not recorded. That it is the binary the 2026-10-14 runs used is UNVERIFIED, because `privateEngine.ts` takes `OPEN_ONTOLOGIES_BIN` first. CI pins v1.3.0 with SHA-256 `fbd13aab…dc621b0` (`ci.yml` lines 18-19 and 43-49), and `compose.yaml` line 70 pins image 1.3.0. The full suite must pass in CI on that pinned engine before the pull request is merged.
- **T8. SPARQL form.**
  - **The restrictions.** No constraint uses `MINUS`, `SERVICE` or `VALUES`, or binds with `AS` a potentially pre-bound variable: `this`, `shapesGraph` or `currentShape`, in either the `$` or the `?` spelling (W3C SHACL 5.3.1). A subquery must return `$this`. Source: W3C SHACL, Appendix A and section 5.3.1, read by web fetch on 2026-10-14. A processor "MUST report a failure" for a shapes graph that breaks these.
  - **The probe.** Whether this engine reports that failure is not shown. One probe with a `MINUS`-based constraint is run first, and its result is recorded.
  - **The check.** GUARD-02 check 5 holds every `sh:select` string in the file to these restrictions. It is stricter on subqueries than W3C: it admits none, because no unit in 4.3 needs one, so the rule that a subquery returns `$this` is met by exclusion, not inspected.

### 5.2 Shared fixture text

Every fixture starts with this prefix block, P:

```turtle
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
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
```

**The envelope macro.** The test file expands this macro to Turtle before loading. `t` is a bare `xsd:dateTime` lexical form, and `c` and `s` are bare words.
- `ENV(p, r, t, c, s)` = `xfn:attributedTo per:p ; xfn:recordedBy per:r ; xfn:recordedAt "t"^^xsd:dateTime ; xfn:accessClass "c" ; xfn:recordStatus "s"`
- `ENV(p, t)` = `ENV(p, p, t, open, asserted)`
- `ENV(p)` = `ENV(p, p, 2025-01-15T09:00:00Z, open, asserted)`

**BASE** is P followed by:

```turtle
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
```

BASE holds at least one instance of each of the 13 concrete classes.

**How changes are written.** "Remove X's p" removes every triple with subject X and predicate p. "Remove X entirely" removes every triple whose subject is X.

**Additions that cases name:**
- **V6, V7, V8:** `v:Vn a xfn:Variable ; xfn:variableDefinition "Unit price of component C, version n" ; ENV(A) .`
- **D2:** `d:D2 a xfn:Decision ; xfn:statement "Renew the supply agreement for component C" ; xfn:decidedBy per:A ; xfn:decidedInCapacityOf pos:CPO ; xfn:decidedOn "2024-12-01"^^xsd:date ; xfn:intervenesOn v:V1 ; ENV(A) .`
- **M2:** `md:MD2 a xfn:MetricDefinition ; xfn:metricName "Purchase spend" ; xfn:definedByFunction bf:Quality .` and `mv:MV2 a xfn:MetricVersion ; xfn:versionOf md:MD2 ; xfn:definitionText "Purchase spend as Quality counts it" ; ENV(B) .`

### 5.3 Guards

**GUARD-01: BASE conforms.**
- **Input:** BASE.
- **Expected:** `conforms: true` and 0 violations, both with and without `xfn-classes.ttl` (as in T3).
- **Reason:** every refusal case is BASE with one change (T5). If BASE did not conform, a refusal case could pass on a violation it was not written to show. GUARD-01 runs before the refusal tests.

**GUARD-02: the structure of the rules file.**
- **Input:** `xfn-shapes.ttl` loaded as data into an empty store and read by SPARQL queries and the test's own code.
- **Expected:** all six of the following hold.
  1. `xfn:RecordShape`'s `sh:targetClass` values are exactly the 11 names in 4.3.
  2. `xfn:RefusedClassShape`'s are exactly the 29 names in 4.1.
  3. Each of the 12 every-record unit IDs (XR-03a, XR-03b, XR-03c, XR-05a, XR-05b, XR-06, XR-07, XR-08a, XR-08b, XR-08c, XR-16f, XR-20) begins the message of exactly one constraint node, and that node is attached to `xfn:RecordShape`.
  4. Each of the 65 unit IDs begins exactly one message, and no message begins with an ID that 4.3 does not define.
  5. No `sh:select` string contains, as a whole word in any case, the keyword `MINUS`, `SERVICE` or `VALUES`, or the keyword `AS` followed by `$` or `?` and `this`, `shapesGraph` or `currentShape`; and each contains exactly one `SELECT` keyword, so none holds a subquery (T8).
  6. Each shape in the table in 4.3 exists with the targets shown.
- **Fail first:** seven mutant copies must each fail GUARD-02:
  - (s1) one name dropped from `xfn:RecordShape`'s targets;
  - (s2) one every-record unit moved into a new NodeShape with the same targets;
  - (s3) one name dropped from `xfn:RefusedClassShape`'s targets;
  - (s4) one unit ID given to two constraint nodes;
  - (s5) XR-19b rewritten with `MINUS`;
  - (s6) XR-11 rewritten to bind its focus node with `AS`: `SELECT ?this ?v WHERE { ?x xfn:claimedCause ?v ; xfn:claimedEffect ?v . BIND (?x AS ?this) }`;
  - (s7) XR-05a rewritten to find its focus node in a subquery: `SELECT $this WHERE { { SELECT $this WHERE { $this xfn:accessClass "privileged" } } FILTER NOT EXISTS { $this xfn:privilegeHolder ?h } }`.

  s1 and s3 also fail one refusal case each.
- **Reason:** D-012 found the privilege rule carrying a different target list from the attribution rule, and no test noticed. Per-constraint mutants cannot catch a missing target class. One shared shape, exercised on every target by REFUSE-03 and held in place by this guard, can.

### 5.4 Refusal tests

Each case is BASE with the stated change. "Expected" lists unit @ focus node, and the set must match exactly (T4).

**REFUSE-01: Direct Variable-to-Variable triples.** The reason is BUILDER's invariant that every arrow between two Variables runs through an attributed record. That is also USER's condition that nothing presents a cause as settled fact.

| Case | Change to BASE | Expected |
|---|---|---|
| R01-a | add `v:V1 xfn:causes v:V2 .` | XR-01 @ v:V1 |

*Change from the superseded test:* the fixture was two bare Variables. It is now BASE (attributed Variables, T5), with the same kind of forbidden triple. The meaning is unchanged.

**REFUSE-02: Decompositions in mixed or unstated dimensions.** The reason is that a sum is defined only over quantities of one kind (D-004, Q3).

| Case | Change to BASE | Expected |
|---|---|---|
| R02-a | replace `o:O-b xfn:unitDimension "money"` with `o:O-b xfn:unitDimension "count"` | XR-02d @ o:O-total |
| R02-b | remove o:O-b's `unitDimension` | XR-02c @ o:O-total |
| R02-c | remove o:O-total's `unitDimension` | XR-02b @ o:O-total |
| R02-d | remove o:O-total's `compositionKind` | XR-02a @ o:O-total |
| R02-e | replace o:O-total's `compositionKind "additive"` with `"multiplicative"` | XR-02e @ o:O-total |
| R02-f | add `o:O-total xfn:unitDimension "count" .` | XR-02f @ o:O-total, XR-02d @ o:O-total |

*Change:*
- The property keeps the superseded test's name, `unitDimension`, and now holds a dimension ("money", "count") instead of "USD" (Q3).
- R02-a keeps the superseded meaning: a money total with a count constituent.
- R02-b and R02-c close two gaps; both inputs conformed on 2026-10-14.
- Unit checks now key on the presence of constituents, so leaving out `compositionKind` no longer skips them; R02-d requires the kind to be stated.
- R02-e and R02-f are new.

**REFUSE-03: Unattributed records.** The reason is that no record is anonymous or untimed, and whoever keyed a record in is named apart from its author. This answers VETO's second ground and USER's "who said it and when".

| Case | Change to BASE | Expected |
|---|---|---|
| R03-a | remove v:V1's `attributedTo`, `recordedBy` and `recordedAt` | XR-03a, XR-03b, XR-03c @ v:V1 |
| R03-b | the same on o:O-a | XR-03a, XR-03b, XR-03c @ o:O-a |
| R03-c | the same on d:D1 | XR-03a, XR-03b, XR-03c @ d:D1 |
| R03-d | the same on ec:EC1 | XR-03a, XR-03b, XR-03c @ ec:EC1 |
| R03-e | the same on com:C1 | XR-03a, XR-03b, XR-03c @ com:C1 |
| R03-f | the same on td:TD1 | XR-03a, XR-03b, XR-03c @ td:TD1 |
| R03-g | the same on ev:EV1 | XR-03a, XR-03b, XR-03c @ ev:EV1 |
| R03-h | the same on mv:MV1 | XR-03a, XR-03b, XR-03c @ mv:MV1 |
| R03-i | the same on vo:VO1 | XR-03a, XR-03b, XR-03c @ vo:VO1 |
| R03-j | the same on mb:MB1 | XR-03a, XR-03b, XR-03c @ mb:MB1 |
| R03-k | add `<https://ontos.dev/ontology/xfn/AttributedRecord/R-2> a xfn:AttributedRecord .` | XR-03a, XR-03b, XR-03c, XR-06, XR-07, XR-19b @ R-2 |
| R03-l | add `v:V1 xfn:attributedTo per:B .` | XR-03a @ v:V1 |
| R03-m | replace `v:V1 xfn:attributedTo per:A` with `v:V1 xfn:attributedTo "A"` | XR-03a @ v:V1 |
| R03-n | add `v:V1 xfn:recordedBy per:B .` | XR-03b @ v:V1 |
| R03-o | replace `v:V1 xfn:recordedBy per:A` with `v:V1 xfn:recordedBy "A"` | XR-03b @ v:V1 |
| R03-p | add `v:V1 xfn:recordedAt "2025-01-16T09:00:00Z"^^xsd:dateTime .` | XR-03c @ v:V1 |
| R03-q | replace v:V1's `recordedAt` with the plain literal `"2025-01-15T09:00:00Z"` | XR-03c @ v:V1 |

*Change:*
- The superseded REFUSE-03 named Decision, Commitment, Transfer and Handoff, and the test checked only a Decision, by a count of at least two.
- Decision and Commitment are kept. Transfer and Handoff are refused outright this cycle (R19-09, R19-08).
- Every other attributed class, and the abstract class (R03-k), is added. These cases exercise every target of `xfn:RecordShape`, and so every every-record rule (GUARD-02).
- `recordedBy` is added.
- Results are checked by unit and focus node, not by count.

**REFUSE-04: ExposureGap in this layer** (owner decision D-017). The reason is that a gap is derived, and derived results are not stored in the semantic layer.

| Case | Change to BASE | Expected |
|---|---|---|
| R04-a | add `<https://ontos.dev/ontology/xfn/ExposureGap/EG-1> a xfn:ExposureGap .` | XR-04 @ EG-1 |

*Mechanism.* The mechanism returns a violation, not an empty verdict. BASE in the same store makes sure the engine always has targets, so it always gives a verdict. With XR-04 disabled, R04-a must return `conforms: true`, not a thrown error (T5). That run shows that the refusal comes from the rule.

*Change.*
- The superseded spec expected a "schema validation rejection (class undefined in Layer 1)". There is no check for undefined classes.
- An instance that no shape targets yields no verdict at all: the engine answered `conforms: null` and the client threw (shown; `semanticEngine.ts` line 610).
- This test is new. The test file's current REFUSE-04 (privilege) becomes REFUSE-05.

**REFUSE-05: A privileged record with no holder** (this was the test named REFUSE-04; renumbered by D-017). The reason is VETO's first ground: a record marked privileged must say which seat administers the claim (Q2).

| Case | Change to BASE | Expected |
|---|---|---|
| R05-a | replace ec:EC1's `accessClass "open"` with `"privileged"` | XR-05a @ ec:EC1 |
| R05-b | replace d:D1's `accessClass "open"` with `"privileged"` | XR-05a @ d:D1 |
| R05-c | as R05-a, and add `ec:EC1 xfn:privilegeHolder per:B .` | XR-05b @ ec:EC1 |
| R05-d | add `ec:EC1 xfn:privilegeHolder pos:CPO , pos:GC .` | XR-05b @ ec:EC1 |

*Change:*
- The fixture was a bare `xfn:Claim`, a class refused this cycle. It is now an EffectClaim in BASE.
- R05-b covers a Decision, which conformed when marked privileged with no holder (shown).
- R05-c requires the holder to be a seat.
- R05-d allows one holder.

**REFUSE-06: Access class missing, doubled or outside the list.** The reason is VETO's first ground: every record carries one classification. This also closes V-M6 (the value list was untested).

| Case | Change to BASE | Expected |
|---|---|---|
| R06-a | replace ec:EC1's `accessClass "open"` with `"public"` | XR-06 @ ec:EC1 |
| R06-b | remove ec:EC1's `accessClass` | XR-06 @ ec:EC1 |
| R06-c | add `ec:EC1 xfn:accessClass "restricted" .` | XR-06 @ ec:EC1 |

**REFUSE-07: A verdict status.** The reason is USER's first kill condition (a cause presented as settled fact), and BUILDER's statement that status tracks what was said, not whether it is true.

| Case | Change to BASE | Expected |
|---|---|---|
| R07-a | replace ec:EC1's `recordStatus "asserted"` with `"verified"` | XR-07 @ ec:EC1 |
| R07-b | remove ec:EC1's `recordStatus` | XR-07 @ ec:EC1 |
| R07-c | add `ec:EC1 xfn:recordStatus "draft" .` | XR-07 @ ec:EC1 |

**REFUSE-08: Unbounded revision** (Q6). The reason is that `revises` is the only exemption from XR-01, so if it were left unbounded it could be used to link two Variables.

| Case | Change to BASE | Expected |
|---|---|---|
| R08-a | add V6 and V7; add `v:V6 xfn:revises v:V7 . v:V7 xfn:revises v:V6 .` | XR-08c @ v:V6, XR-08c @ v:V7 |
| R08-b | add V6, V7 and V8; add `v:V8 xfn:revises v:V6 , v:V7 .` | XR-08a @ v:V8 |
| R08-c | add V6; add `v:V6 xfn:revises d:D1 .` | XR-08b @ v:V6 |
| R08-d | add V6; add `v:V6 xfn:revises v:V6 .` | XR-08c @ v:V6 |

**REFUSE-09: Effect claim without its parts.** The reason is USER's need to see what each VP is asserting, in whose name, for which function, and in their own words. This also closes V-M7 (the EffectClaim shape was untested).

| Case | Change to BASE | Expected |
|---|---|---|
| R09-a | remove ec:EC1's `claimedCause` | XR-09a @ ec:EC1 |
| R09-b | remove ec:EC1's `claimedEffect` | XR-09b @ ec:EC1 |
| R09-c | remove ec:EC1's `viaDecision` | XR-09c @ ec:EC1 |
| R09-d | remove ec:EC1's `onBehalfOf` | XR-09d @ ec:EC1 |
| R09-e | remove ec:EC1's `statement` | XR-09e @ ec:EC1 |
| R09-f | replace `ec:EC1 xfn:claimedEffect v:V2` with `ec:EC1 xfn:claimedEffect ev:EV1` | XR-09b @ ec:EC1 |
| R09-g | add `ec:EC1 xfn:claimedMediator ev:EV1 .` | XR-09f @ ec:EC1 |
| R09-h | add `ec:EC1 xfn:claimedEffect v:V5 .` | XR-09b @ ec:EC1 |
| R09-i | replace `ec:EC1 xfn:claimedCause v:V1` with `ec:EC1 xfn:claimedCause ev:EV1` | XR-09a @ ec:EC1 |
| R09-j | add D2; add `ec:EC1 xfn:viaDecision d:D2 .` | XR-09c @ ec:EC1 |
| R09-k | replace `ec:EC1 xfn:viaDecision d:D1` with `ec:EC1 xfn:viaDecision ev:EV1` | XR-09c @ ec:EC1 |
| R09-l | add `ec:EC1 xfn:onBehalfOf bf:Procurement .` | XR-09d @ ec:EC1 |
| R09-m | replace `ec:EC1 xfn:onBehalfOf bf:Quality` with `ec:EC1 xfn:onBehalfOf pos:CPO` | XR-09d @ ec:EC1 |

XR-10 stays silent in R09-c, R09-i and R09-k, because its operands are missing or mistyped (4.3).

**REFUSE-10: A cause the decision did not set** (Q4). The reason is that chaining claims by different authors produces an arrow nobody asserted, which is USER's settled-fact kill condition.

| Case | Change to BASE | Expected |
|---|---|---|
| R10-a | replace `ec:EC1 xfn:claimedCause v:V1` with `ec:EC1 xfn:claimedCause v:V4` | XR-10 @ ec:EC1 |

**REFUSE-11: Cause equals effect** (Q5). This input conformed on 2026-10-14.

| Case | Change to BASE | Expected |
|---|---|---|
| R11-a | replace `ec:EC1 xfn:claimedEffect v:V2` with `ec:EC1 xfn:claimedEffect v:V1` | XR-11 @ ec:EC1 |

**REFUSE-12: A decision without who, seat, date, lever or words.** The reason is USER's question: who approved the vendor change, in what office, and when.

| Case | Change to BASE | Expected |
|---|---|---|
| R12-a | remove d:D1's `decidedBy` | XR-12a @ d:D1 |
| R12-b | remove d:D1's `decidedInCapacityOf` | XR-12b @ d:D1 |
| R12-c | replace `d:D1 xfn:decidedInCapacityOf pos:CPO` with `d:D1 xfn:decidedInCapacityOf per:A` | XR-12b @ d:D1 |
| R12-d | remove d:D1's `decidedOn` | XR-12c @ d:D1 |
| R12-e | remove d:D1's `intervenesOn` | XR-12d @ d:D1, XR-10 @ ec:EC1 |
| R12-f | remove d:D1's `statement` | XR-12e @ d:D1 |
| R12-g | add `d:D1 xfn:decidedBy per:B .` | XR-12a @ d:D1 |
| R12-h | replace `d:D1 xfn:decidedBy per:A` with `d:D1 xfn:decidedBy "A"` | XR-12a @ d:D1 |
| R12-i | add `d:D1 xfn:decidedInCapacityOf pos:GC .` | XR-12b @ d:D1 |
| R12-j | add `d:D1 xfn:decidedOn "2024-11-21"^^xsd:date .` | XR-12c @ d:D1 |
| R12-k | replace d:D1's `decidedOn` with the plain literal `"2024-11-20"` | XR-12c @ d:D1 |
| R12-l | add `d:D1 xfn:intervenesOn ev:EV1 .` | XR-12d @ d:D1 |

R12-e lists XR-10: EC1's cause is then a variable its decision did not set.

**REFUSE-13: A commitment without promisor, office, date, party, place or individual author.** The reason is VETO's second ground: who gave the promise, in what office, when, and whose account the record is.

| Case | Change to BASE | Expected |
|---|---|---|
| R13-a | remove com:C1's `commitmentDirection` | XR-13a @ com:C1 |
| R13-b | replace com:C1's `commitmentDirection "given"` with `"promised"` | XR-13a @ com:C1 |
| R13-c | remove com:C1's `promisedBy` | XR-13b @ com:C1 |
| R13-d | remove com:C1's `promisedOn` | XR-13c @ com:C1 |
| R13-e | remove com:C1's `commitmentCounterparty` | XR-13d @ com:C1 |
| R13-f | replace com:C1's `capturedIn "email"` with `"fax"` | XR-13e @ com:C1 |
| R13-g | remove com:C1's `statement` | XR-13f @ com:C1 |
| R13-h | remove com:C1's `promisedInCapacityOf` | XR-13g @ com:C1 |
| R13-i | add `com:C1 xfn:promisedInCapacityOf pos:GC .` | XR-13h @ com:C1 |
| R13-j | add `com:C1 xfn:commitmentDirection "received" .` | XR-13a @ com:C1 |
| R13-k | add `com:C1 xfn:promisedBy per:B .` | XR-13b @ com:C1 |
| R13-l | replace `com:C1 xfn:promisedBy per:A` with `com:C1 xfn:promisedBy "A"` | XR-13b @ com:C1 |
| R13-m | add `com:C1 xfn:promisedOn "2024-11-19"^^xsd:date .` | XR-13c @ com:C1 |
| R13-n | replace com:C1's `promisedOn` with the plain literal `"2024-11-18"` | XR-13c @ com:C1 |
| R13-o | add `com:C1 xfn:commitmentCounterparty pty:P2 .` | XR-13d @ com:C1 |
| R13-p | replace `com:C1 xfn:commitmentCounterparty pty:P1` with `com:C1 xfn:commitmentCounterparty "P1"` | XR-13d @ com:C1 |
| R13-q | remove com:C1's `capturedIn` | XR-13e @ com:C1 |
| R13-r | add `com:C1 xfn:capturedIn "verbal" .` | XR-13e @ com:C1 |
| R13-s | replace `com:C1 xfn:promisedInCapacityOf pos:CPO` with `com:C1 xfn:promisedInCapacityOf per:A` | XR-13h @ com:C1 |
| R13-t | replace `com:C1 xfn:attributedTo per:A` with `com:C1 xfn:attributedTo <https://ontos.dev/ontology/hr/OrgUnit/Procurement>` | XR-13i @ com:C1 |

**REFUSE-14: A commitment without evidence.** The reason is VETO's second ground: `evidencedIn` is absent whenever the promise is not in an executed contract, so the record must then cite evidence that has its own author.

| Case | Change to BASE | Expected |
|---|---|---|
| R14-a | replace com:C1's `capturedIn "email"` with `"contract"` | XR-14a @ com:C1 |
| R14-b | remove `com:C1 xfn:citesEvidence ev:EV2` | XR-14b @ com:C1 |
| R14-c | replace com:C1's `capturedIn "email"` with `"verbal"`, and remove `com:C1 xfn:citesEvidence ev:EV2` | XR-14b @ com:C1 |

**REFUSE-15: Outcome and Variable without their defining content.** The reason is USER's need to see which departments are absorbing the fallout: an outcome must say what it is about and whose remit it is in.

| Case | Change to BASE | Expected |
|---|---|---|
| R15-a | remove o:O-a's `statedOver` | XR-15a @ o:O-a |
| R15-b | add `o:O-a xfn:statedOver v:V5 .` | XR-15a @ o:O-a |
| R15-c | replace `o:O-a xfn:statedOver v:V4` with `o:O-a xfn:statedOver ev:EV1` | XR-15a @ o:O-a |
| R15-d | remove o:O-a's `inRemitOf` | XR-15b @ o:O-a |
| R15-e | replace `o:O-a xfn:inRemitOf bf:Procurement` with `o:O-a xfn:inRemitOf pos:CPO` | XR-15b @ o:O-a |
| R15-f | add `o:O-total xfn:hasConstituent v:V4 .` | XR-15c @ o:O-total |
| R15-g | remove v:V1's `variableDefinition` | XR-15d @ v:V1 |
| R15-h | add `v:V1 xfn:variableDefinition "Supplier of record for component C" .` | XR-15d @ v:V1 |

*Change:* the earlier draft of this spec had a remit rule here (a total's remit must cover its constituents' remits). It is withdrawn as rollup logic (Q7). The superseded ACCEPT-06's placement of total cost in Procurement's remit is therefore no longer refused.

**REFUSE-16: Term deviation and evidence without their content.** The reason is USER's two points: the missing clause is a fact tied to the signed document, and every number must trace to where it came from.

| Case | Change to BASE | Expected |
|---|---|---|
| R16-a | remove td:TD1's `deviationInContract` | XR-16a @ td:TD1 |
| R16-b | add `td:TD1 xfn:deviationInContract ctr:K2 .` | XR-16a @ td:TD1 |
| R16-c | replace `td:TD1 xfn:deviationInContract ctr:K1` with `td:TD1 xfn:deviationInContract "K1"` | XR-16a @ td:TD1 |
| R16-d | replace td:TD1's `termKind "indemnity"` with `"goodwill"` | XR-16b @ td:TD1 |
| R16-e | remove td:TD1's `termKind` | XR-16b @ td:TD1 |
| R16-f | add `td:TD1 xfn:termKind "warranty" .` | XR-16b @ td:TD1 |
| R16-g | remove td:TD1's `deviationDirection` | XR-16c @ td:TD1 |
| R16-h | replace td:TD1's `deviationDirection "absent"` with `"worse"` | XR-16c @ td:TD1 |
| R16-i | add `td:TD1 xfn:deviationDirection "less-favourable" .` | XR-16c @ td:TD1 |
| R16-j | remove ev:EV1's `evidenceSummary` | XR-16d @ ev:EV1 |
| R16-k | add `ev:EV1 xfn:evidenceSummary "Inspection results, January" .` | XR-16d @ ev:EV1 |
| R16-l | remove ev:EV1's `evidenceSourceSystem` | XR-16e @ ev:EV1 |
| R16-m | add `ev:EV1 xfn:evidenceSourceSystem "Supplier portal" .` | XR-16e @ ev:EV1 |
| R16-n | replace `ec:EC1 xfn:citesEvidence ev:EV1` with `ec:EC1 xfn:citesEvidence v:V2` | XR-16f @ ec:EC1 |

**REFUSE-17: A metric definition or version without an owner or words.** The reason is USER's need to see both definitions side by side, each with an owner's name on it.

| Case | Change to BASE | Expected |
|---|---|---|
| R17-a | remove md:MD1's `metricName` | XR-17a @ md:MD1 |
| R17-b | add `md:MD1 xfn:metricName "Spend" .` | XR-17a @ md:MD1 |
| R17-c | remove md:MD1's `definedByFunction` | XR-17b @ md:MD1 |
| R17-d | add `md:MD1 xfn:definedByFunction bf:Quality .` | XR-17b @ md:MD1 |
| R17-e | replace `md:MD1 xfn:definedByFunction bf:Procurement` with `md:MD1 xfn:definedByFunction pos:CPO` | XR-17b @ md:MD1 |
| R17-f | remove mv:MV1's `versionOf` | XR-17c @ mv:MV1, XR-18f @ mb:MB1 |
| R17-g | add M2; add `mv:MV1 xfn:versionOf md:MD2 .` | XR-17c @ mv:MV1 |
| R17-h | replace `mv:MV1 xfn:versionOf md:MD1` with `mv:MV1 xfn:versionOf bf:Procurement` | XR-17c @ mv:MV1, XR-18f @ mb:MB1 |
| R17-i | remove mv:MV1's `definitionText` | XR-17d @ mv:MV1 |
| R17-j | add `mv:MV1 xfn:definitionText "Paid amount for component C" .` | XR-17d @ mv:MV1 |

R17-f and R17-h list XR-18f: MB1 is then pinned to a version that is not a version of its metric.

**REFUSE-18: Operationalisation and binding.** This closes V-M8 and V-M9: removing either shape used to fail no refusal test. It also pins a scorecard to a version of its own metric (critique issues L2.10 and L3.12).

| Case | Change to BASE | Expected |
|---|---|---|
| R18-a | remove vo:VO1's `operationalises` | XR-18a @ vo:VO1 |
| R18-b | add `vo:VO1 xfn:operationalises v:V5 .` | XR-18a @ vo:VO1 |
| R18-c | replace `vo:VO1 xfn:operationalises v:V4` with `vo:VO1 xfn:operationalises ev:EV1` | XR-18a @ vo:VO1 |
| R18-d | remove vo:VO1's `measuredBy` | XR-18b @ vo:VO1 |
| R18-e | add M2; add `vo:VO1 xfn:measuredBy mv:MV2 .` | XR-18b @ vo:VO1 |
| R18-f | replace `vo:VO1 xfn:measuredBy mv:MV1` with `vo:VO1 xfn:measuredBy md:MD1` | XR-18b @ vo:VO1 |
| R18-g | remove mb:MB1's `holder` | XR-18c @ mb:MB1 |
| R18-h | add `mb:MB1 xfn:holder pos:GC .` | XR-18c @ mb:MB1 |
| R18-i | replace `mb:MB1 xfn:holder pos:CPO` with `mb:MB1 xfn:holder per:A` | XR-18c @ mb:MB1 |
| R18-j | remove mb:MB1's `bindsMetric` | XR-18d @ mb:MB1 |
| R18-k | add M2; add `mb:MB1 xfn:bindsMetric md:MD2 .` | XR-18d @ mb:MB1, XR-18f @ mb:MB1 |
| R18-l | replace `mb:MB1 xfn:bindsMetric md:MD1` with `mb:MB1 xfn:bindsMetric mv:MV1` | XR-18d @ mb:MB1 |
| R18-m | remove mb:MB1's `boundVersion` | XR-18e @ mb:MB1 |
| R18-n | add M2; add `mb:MB1 xfn:boundVersion mv:MV2 .` | XR-18e @ mb:MB1, XR-18f @ mb:MB1 |
| R18-o | replace `mb:MB1 xfn:boundVersion mv:MV1` with `mb:MB1 xfn:boundVersion md:MD1` | XR-18e @ mb:MB1 |
| R18-p | add M2; replace `mb:MB1 xfn:boundVersion mv:MV1` with `mb:MB1 xfn:boundVersion mv:MV2` | XR-18f @ mb:MB1 |

**REFUSE-19: Classes outside this cycle's vocabulary.** The reason is that nothing is accepted silently. D-012 recorded that an unattributed DecisionRight or InterventionSetting got no verdict at all.

- **R19-01 to R19-29.** For the name N with that number in the list below, add `<https://ontos.dev/ontology/xfn/N/X-1> a xfn:N ; ENV(A) .` Expected: XR-19a @ that node. The numbers are 01 ControlledTerm, 02 AnalyticAgent, 03 Deliberation, 04 BoundaryObject, 05 LegalEntity, 06 Perspective, 07 PerspectiveCorrespondence, 08 Handoff, 09 Transfer, 10 AccountabilityAssertion, 11 DecisionRight, 12 Answerability, 13 DecisionDomain, 14 DimensionBinding, 15 GrainDimension, 16 Claim, 17 ProxyClaim, 18 DivergenceClaim, 19 ForecastClaim, 20 Appraisal, 21 Reading, 22 InterventionSetting, 23 VariableCorrespondence, 24 BoundaryConcept, 25 BoundaryInstance, 26 BoundaryMedium, 27 SeatOccupancy, 28 SeatRelation, 29 DecisionQuestion.
- **R19-30.** Add `<https://ontos.dev/ontology/xfn/AttributedRecord/R-1> a xfn:AttributedRecord ; ENV(A) .` Expected: XR-19b @ R-1.

**REFUSE-20: Two statements on one record.** The reason is that where a structured field and the words disagree, the statement is the record, so a record has one.

| Case | Change to BASE | Expected |
|---|---|---|
| R20-a | add `ec:EC1 xfn:statement "The supplier change did not affect part quality" .` | XR-20 @ ec:EC1 |

**Count of refusal cases:** 1 + 6 + 17 + 1 + 4 + 3 + 3 + 4 + 13 + 1 + 1 + 12 + 20 + 3 + 8 + 14 + 10 + 16 + 30 + 1 = 168.

### 5.5 Acceptance tests

Each fixture is P followed by the Turtle shown, with ENV expanded. The expected result of every acceptance test is T3: conforms, 0 violations, in both runs.

**ACCEPT-01: Definitional lineage through `xfn:revises`.** The reason is that a revised definition is the one link allowed between two Variables, and it claims no effect.

```turtle
v:V-unit-cost-v1 a xfn:Variable ;
  xfn:variableDefinition "Unit price paid for component C, before freight" ; ENV(CPO) .
v:V-unit-cost-v2 a xfn:Variable ;
  xfn:variableDefinition "Unit price paid for component C, before freight and after volume rebates" ;
  xfn:revises v:V-unit-cost-v1 ; ENV(CPO, 2025-02-01T09:00:00Z) .
```

*Change:* both Variables now carry the envelope and a definition (Q7, XR-03, XR-15d), and the `rdfs:label`s are dropped. The meaning is unchanged. Removing the `revises` exemption from XR-01 must still fail this test (T6).

**ACCEPT-02: An attributed n-ary effect claim.**

```turtle
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
```

*Change:*
- The Variables and the Decision now carry the envelope.
- The Decision now carries its own content: decider, seat, date, the Variable it sets, and its words. Its seat is typed.
- The claim now has a statement and a record status.
- The meaning is unchanged.

**ACCEPT-03: A privileged record with its holder seat.** The fixture is ACCEPT-02's Turtle followed by:

```turtle
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
```

*Change:*
- `xfn:Claim` becomes `xfn:EffectClaim`, because Claim is refused this cycle (R19-16).
- The record is now a complete arrow from ACCEPT-02's decision.
- The holder seat is typed Position.

**ACCEPT-04: A Variable operationalised by a metric version.**

```turtle
bf:Quality a xfn:BusinessFunction .
v:V-defect-rate a xfn:Variable ; xfn:variableDefinition "Rate of field defects on product P" ; ENV(LeadAnalyst) .
md:MET-defects a xfn:MetricDefinition ; xfn:metricName "Defect rate" ; xfn:definedByFunction bf:Quality .
mv:MV-defect-monthly-v2 a xfn:MetricVersion ; xfn:versionOf md:MET-defects ;
  xfn:definitionText "Confirmed field defects per 1,000 units shipped, by calendar month" ; ENV(LeadAnalyst) .
vo:VO-01 a xfn:VariableOperationalisation ;
  xfn:operationalises v:V-defect-rate ; xfn:measuredBy mv:MV-defect-monthly-v2 ;
  ENV(LeadAnalyst, 2025-01-20T14:00:00Z) .
```

*Change:* the MetricVersion now names its MetricDefinition, which Quality owns, and states what a value means. The Variable is attributed.

**ACCEPT-05: A scorecard binding pinned to a version** (kept pending the owner's decision on MetricBinding, 6 Q1).

```turtle
bf:Procurement a xfn:BusinessFunction .
pos:CPO a xfn:Position .
md:MET-savings a xfn:MetricDefinition ; xfn:metricName "Savings" ; xfn:definedByFunction bf:Procurement .
mv:MV-savings-2025 a xfn:MetricVersion ; xfn:versionOf md:MET-savings ;
  xfn:definitionText "Annualised reduction in unit price against last-paid price, times forecast volume" ; ENV(CPO) .
mb:MB-cpo-2025 a xfn:MetricBinding ;
  xfn:holder pos:CPO ; xfn:bindsMetric md:MET-savings ; xfn:boundVersion mv:MV-savings-2025 ;
  ENV(CEO, HR-Analyst, 2025-01-05T09:00:00Z, restricted, asserted) .
```

*Change:*
- The MetricBinding is now attributed (Q1) and names its holder seat.
- The version states what a value means, and the definition has an owner.
- This resolves D-012's contradiction: with `xfn-classes.ttl` loaded, the fixture still conforms (T3).

**ACCEPT-06: The anchor scenario from end to end.** The fixture holds the CPO's decision and claims from Procurement (unit price), Quality (part quality, which the RMA teardowns show, and cost of poor quality), Support (field tickets) and Finance (warranty provision). It also holds Legal's privileged claim and Legal's record that the indemnity is missing. A total cost of supply has constituents that are all amounts of money, and every claimed effect has a bearer.

```turtle
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
```

Following the path in Q10, the bearers are:
- EC-0101 (V-unit-cost): Procurement.
- EC-0102 (V-part-quality): Quality.
- EC-0106 (V-copq): Quality.
- EC-0103 (V-field-tickets): Support.
- EC-0104 (V-warranty-exp): Finance.
- EC-0105 (V-uncovered-liability): Legal.

*Changes from the current test fixture, each with its reason.* Items 1-5 and 12 change meaning and need the owner's approval as such:
1. **Meaning changes for EC-0103, EC-0104 and EC-0106.** The superseded fixture recorded mid-chain claims, "lower part quality raised X" (`xfnSemanticLayer.test.ts` lines 364, 374 and 384). Each author now asserts the whole arrow from the supplier switch, with part quality named as a mediator. This cycle cannot hold a mid-chain claim (Q4, XR-10; section 3, trade-off 3).
2. **Meaning changes for TD-0042's marking.** It is now `restricted`, not `privileged`, and its holder is removed. Whether the clause is in the contract can be checked in the signed document. The privileged record is Legal's assessment, EC-0105. USER and VETO both drew that line, and no rule forbids marking a TermDeviation privileged.
3. **Meaning changes for O-purchase-cost.** It is stated over a new Variable, `V-purchase-spend` ("Purchase spend on component C"), instead of `V-unit-cost`. A unit price is not a summand of a total cost. The superseded label "Direct Purchase Spend" had hidden that, and `V-unit-cost` is kept as EC-0101's effect.
4. **Meaning changes for O-liability-cost.** It is stated over a new incurred-cost Variable, `V-liability-cost`, instead of the exposure `V-uncovered-liability`. An exposure is contingent and needs estimation; it is not a summand of a cost. The exposure stays as EC-0105's effect.
5. **Meaning changes for O-tco's remit.** It is placed in Enterprise's remit, not Procurement's (`xfnSemanticLayer.test.ts` line 312), the placement D-013 question 7 asked about. That is now its author's statement, and no rule requires it (Q7).
6. Four outcomes outside the total are new, O-unit-price, O-part-quality, O-field-tickets and O-uncovered-liability, so that every claimed effect has a bearer (Q10).
7. TD-0042 gains `termKind`, `deviationDirection` and `benchmarkContract`, so the record can be checked against both contracts.
8. Every Variable gains a `variableDefinition`, and the `rdfs:label`s on Variables, the Decision and the Outcomes are dropped. The two Positions' labels are new: "Chief Procurement Officer" on `pos:CPOSeat` and "General Counsel" on `pos:GeneralCounselSeat`. The current fixture declares no Position; it names the General Counsel's seat only as a `privilegeHolder` value (lines 401 and 409).
9. Every record, Variables and Outcomes included, carries the full envelope. The Decision's `recordedBy` differs from its `attributedTo`, which shows delegated recording.
10. The Decision gains its statement, decider, seat, date and the Variable it sets.
11. Every claim gains a statement. EC-0101 and EC-0102 quote their figures in `magnitudeStatement` and cite new evidence items EV-01 and EV-02.
12. **Meaning changes for the outcomes' `unitDimension`.** The values change from "USD" to "money", because the property now holds a dimension (Q3). The fixture therefore no longer states a currency, which belongs to the measurement layer. O-unit-price is "money per unit" and O-field-tickets is "count".
13. The seats are typed `xfn:Position`. The CPO's seat is new (`pos:CPOSeat`).

The superseded spec's statement of ACCEPT-06 still holds: the CPO decision, the unit-price, RMA, ticket and warranty claims, and the missing indemnity, all conforming, with a dimensionally consistent total. Its fixture-level meaning changes as listed above.

**ACCEPT-07 (new): Rival "Savings" definitions side by side.** The reason is USER's central request. Procurement measures savings at unit price, and Operations at landed cost including expedite freight. Both are held on one neutral Variable, each with its owner and author, and nothing makes either one official.

```turtle
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
```

Each version measures a change in that annual cost against its own baseline. They differ on what counts as cost: the unit price alone, or the landed cost with expedite freight. The before/after contrast lives in each version's `definitionText` and `baselineDescription`, never in the Variable. Any statement that the supplier change lowered cost is an EffectClaim through the Decision, as EC-0101 is. This test fails if any rule makes `metricName` unique, limits a Variable to one operationalisation, or requires a definition to be marked official.

**ACCEPT-08 (new): Commitments outside an executed contract, and one inside.** The reason is that the answer to VETO's second ground must not refuse real promises. The fixture shows four things:
- the promisor, the individual author and the person who entered the record as three different people;
- a commitment still in draft;
- a verbal promise resting on a recollection;
- a contract-captured promise given by the counterparty's signatory, citing its contract.

```turtle
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
```

### 5.6 Changes to the test file, each as its own line

1. The test named REFUSE-04 (privilege holder) becomes REFUSE-05, with cases R05-a to R05-d (D-017).
2. A new REFUSE-04 refuses ExposureGap by a rule that returns a violation (D-017).
3. New refusal tests REFUSE-06 to REFUSE-20 cover units that have no test today (V-M6 to V-M9) and the new rules.
4. New acceptance tests ACCEPT-07 and ACCEPT-08, and the guards GUARD-01 and GUARD-02, are added.
5. Refusal results are checked as a set of (unit, focus node) pairs that must equal the expected set. REFUSE-03's assertion "at least 2 violations" is replaced by this stricter check.
6. Every acceptance test runs twice, the second time with `xfn-classes.ttl` (T3).
7. The REFUSE-02 fixture now holds dimension labels ("money", "count") in place of "USD" and "count" (Q3). It still refuses the same mismatch, but like ACCEPT-06's item 12 it no longer states a currency, so it needs the owner's approval with item 12.
8. The ACCEPT-01 to ACCEPT-05 fixtures change as recorded under each test.
9. The ACCEPT-06 fixture changes as recorded in its 13 numbered items. Items 1-5 and 12 change meaning and need the owner's approval as such.
10. No expected result of any kept test is loosened. Every kept refusal still expects `conforms: false`, and every kept acceptance still expects `conforms: true` with 0 violations.
11. The suite logs the engine binary's hash and version on every run (T1). The mutant campaign (T6) runs outside the suite, and its logs go with the pull request.

## 6. Decisions on the open questions

**1. Are MetricBinding, the other AccountabilityAssertions, InterventionSetting and VariableCorrespondence attributed records?**
*Decided, with one part pending the owner.*
- **VariableOperationalisation** is an attributed record and in scope.
- **MetricBinding** is an attributed record, and ENGINEER recommends keeping it. That needs the owner's decision on the layer boundary, because "who is scored on this metric" is how the owner described the incentive layer (memory, five-layer scope). ENGINEER's reasons:
  - It holds only the attributed statement that a seat is evaluated on a metric version, with no target, weight, threshold, period or payout.
  - It is the key the incentive layer binds its own terms to.
  - USER needs it to weigh a figure: Procurement's $2.4 million is the metric the CPO is evaluated on.
  - Critique 2 (layer purity) kept "MetricBinding without weights, targets or payouts" (`xfn-draft-critiques.json` line 307, keepUnchanged item 5).
  - ACCEPT-05 is a kept test.
- **The boundary**, stated in 4.0 and section 8: `xfn` holds the binding fact; the incentive system holds terms and scoring and is authoritative for them.
- **If the owner declines,** MetricBinding joins XR-19a's refused list (30 names). Removed would be:
  - the `holder`, `bindsMetric` and `boundVersion` tuples;
  - XR-18c to XR-18f;
  - cases R18-g to R18-p and R03-j, plus mb:MB1 from BASE and the XR-18f expectations of R17-f and R17-h;
  - ACCEPT-05, which needs the owner's approval as the withdrawal of a kept test.

  Case R19-31 would be added. The counts would then be 13 classes, 48 properties, 61 units (27 needing constructs the compiler cannot write), 119 constraints, 158 refusal cases and 7 acceptance tests.
- **AccountabilityAssertion, DecisionRight, Answerability, InterventionSetting and VariableCorrespondence** are deferred and refused (XR-19a). When one is admitted, it will be an attributed record.
- **Why attribute the binding:** a binding is something someone said about a seat, and USER needs every figure traced to whoever said it.

**2. Must every attributed record marked privileged name a holder, or only claims?**
*Decided:* every record, across all 10 attributed classes (XR-05a).
- XR-05a is a node of `xfn:RecordShape`, which REFUSE-03 exercises on every target and GUARD-02 holds in place.
- R05-b tests a Decision, which conformed with no holder (shown).
- The holder is one seat (XR-05b).
- The reason: a claim of privilege needs someone to administer it, whatever kind of record it sits on.

**3. Must an additive outcome and each constituent state a unitDimension, and is it a unit label or a dimension?**
*Decided:*
- Any outcome with constituents, and each constituent, must state one (XR-02b, XR-02c, XR-02f).
- It is a dimension label, compared as an exact string ("money", "count", "money per unit"), and keeps the name `unitDimension` (D-004, the current test).
- Currency and unit of measured values belong to the measurement layer. A total whose parts are reported in USD and EUR is the same kind of quantity, and its conversion is measurement's job.
- A per-unit quantity names its denominator, so a unit price ("money per unit") can never be a constituent of a total ("money").
- XR-02 cannot tell whether an author labelled a per-unit Variable correctly; it reads labels, not definitions.
- Every decomposition must be additive this cycle (XR-02e), and its kind must be stated (XR-02a).
- This follows all three critiques, which asked for a shared unit dimension or family, and it reverses the earlier draft of this spec, which chose a unit label.

**4. Is `viaDecision` only context, or must `claimedCause` be a variable the decision set?**
*Decided:* the cause must be a variable the decision sets (XR-10), and `viaDecision` is required this cycle (XR-09c).
- This follows the draft and critique L2.4.
- ACCEPT-06's chained claims become claims anchored to the decision, with the intermediate variable named as a mediator.
- The reason: chaining claims by different authors would produce "the vendor change caused the defect surge" without anyone having said it, which is USER's first kill condition.
- The cost is in section 3, trade-off 3.

**5. Do `claimedSign` and "cause differs from effect" belong in this layer's rules?**
*Decided for "cause differs from effect":* enforced (XR-11, R11-a).
*Deferred for `claimedSign`:* it belongs in this layer, because the author's stated direction is part of what was said. It is deferred because nothing consumes it this cycle, the statement already carries the direction in words, and a sign cannot be read as good or bad without `preferredDirection`, which is also deferred.

**6. Bounds on `xfn:revises`.**
*Decided:*
- One per record (XR-08a).
- Only between nodes that share a type (XR-08b).
- No cycles, including a record revising itself (XR-08c). A two-way pair conformed on 2026-10-14 and is now R08-a.
- Attributed: the revising record carries its own envelope (XR-03).

*Declined as a machine rule:* "same construct". Whether a new definition describes the same construct is a judgment. It is recorded in the new Variable's `variableDefinition` under its author's name. Two records may revise the same earlier one, so rival definitions can coexist.

**7. Are Variable and Outcome attributed? Whose remit is a shared outcome?**
*Decided:* both are attributed (XR-03 covers them).
- A shared outcome's remit is whatever its author records. No rule relates it to its constituents' remits.
- An earlier draft of this spec required a total's remit to cover its parts' remits, along `subFunctionOf`. That draft is withdrawn for three reasons:
  - It is rollup logic, which the owner's scope keeps out of this layer.
  - It refused an attributed statement on structural grounds, so an organisation that assigns a total to Finance could not record that.
  - It rested on `subFunctionOf`, which is unattributed and undated, so a reorganisation would change which recorded totals conform.
- How bearers follow from constituents is a query for the propagation layer (4.5).
- ACCEPT-06 places total cost of supply in the Enterprise's remit, as data.
- The risk that a page hands the CEO one name moves to the page, which must show constituents' remits next to the total's (section 3, trade-off 6).

**8. The draft's `recordStatus` and its ordinal-only magnitude.**
*Decided:*
- `recordStatus` is carried forward, narrowed to draft, asserted and withdrawn, and required (XR-07).
- "superseded" is dropped as a stored value: it is read from `xfn:revises`, so superseding a record never changes the earlier one.
- `magnitudeBand` is dropped on purpose, because "relative to the effect variable's normal range" needs the measurement layer (critique C1, smuggled item 3).
- `magnitudeStatement` is carried as a quotation.

**9. VETO's conditions still unmet.**
The conditions recorded in D-013 come from the superseded cycle's VETO: tombstones and retention, evidence citations, and capacity.
- *Evidence citations: decided in.* EvidenceItem, `citesEvidence`, XR-14 and XR-16d to XR-16f.
- *Capacity: decided in.* `decidedInCapacityOf`, `promisedInCapacityOf`, XR-12b, XR-13g and XR-13h.
- *Tombstones and retention: deferred.* No record is loaded anywhere this cycle, no rule forbids deletion, and the draft's freeze-on-assert and `contentDigest` are not adopted.

This is the "smaller feature with tombstoning deferred and put back to VETO" that D-013 anticipated. Section 7 states the status of each of this cycle's three VETO grounds and of the three conditions approved in D-016.

**10. Untriaged items.**
- *Delegated authorship: decided in.* `recordedBy` is separate from `attributedTo`, and `recordStatus` "draft" marks a record entered by someone else and not yet confirmed by its author.
- *A draft or submitted state: decided,* "draft" only. "Submitted" is declined, because one unconfirmed state is enough to show that an encoding is not yet the author's.
- *Decision ingestion: deferred.* It needs the app.
- *The seven layer-purity items with no proposal.* The critiques' `smuggledLayerViolations` hold 12 entries (verified 2026-10-14). Five have proposals: ExposureGap (C1.S1, C2.S1, C3.S2) and the additive breakdown of total cost (C2.S2, C3.S1). The other seven are:
  - C1.S2, `DimensionBinding.rollupRule` and EP5's "comparable-after-restatement". The rollup rule is deferred with DimensionBinding, which is refused this cycle. The EP5 clause falls with the declined extension-point contracts.
  - C1.S3, the magnitude band's "normal range": dropped (question 8).
  - C2.S3, `impactedFunction`: dropped. Who bears a claimed effect is read by query, from `claimedEffect` to an Outcome's `statedOver` and then its `inRemitOf`, so a claimant's own list of bearers cannot contradict the remit record. The cost is section 3, trade-off 4.
  - C2.S4, within-band: excluded. `preferredDirection` is deferred, and when it is admitted it will not include "within-band" while band limits belong to the incentive layer.
  - C2.S5, the rollup rule's procedure values: deferred with DimensionBinding.
  - C2.S6, EP9's depth justification: declined with the extension-point contracts. There is no propagation contract this cycle.
  - C3.S3, the rollup rule's declaration: deferred with DimensionBinding.
- *The 13 extension-point contracts: declined this cycle.* None is in force. Each will be rewritten against the vocabulary then in force when a consuming layer is named.

**11. Where `xfn` rules live in the product.**
*Deferred, with a gate.* This cycle the rules live only in `xfn-shapes.ttl` and its tests (4.4). Integration requires two things:
- every unit in 4.3 enforced on the product's validation path, with the same mutant matrix failing there;
- `accessClass` enforced on every read path.

Integration alone lets no real record be loaded. Loading waits on the loading gate in section 7, which also requires VETO to have cleared grounds 1 and 2 in a later cycle and the designs that ground 3 needs to exist.

There are two routes, and the choice between them is deferred. One is to extend the compiler to write `sh:sparql`, `sh:in` and `sh:nodeKind`, to refuse rather than drop any key it cannot write, and to handle multi-target and refused-class shapes (4.4). The other is to load the hand-written file for `xfn`.

*Correction to the record.*
- D-013 question 11 says the stored form cannot hold `sh:sparql`. In fact `ShaclConstraintJson` has `sparql?: string` (`rdfBridge.ts` line 21, and the UI type in `studio-utils.ts` line 73), and `seed.ts` line 314 sets it on `hr:EmploymentContractShape`. The stored form cannot hold `sh:in` or `sh:nodeKind`.
- D-002 is accurate: it says only that the compiler does not write `sh:sparql` or `sh:in`, which is still true.
- The correcting entry is proposed in section 7. It is not yet appended, because this cycle's work was read-only.

**12. Upstream additions `xfn` depends on.**
*Deferred:* no rule in section 4 needs `log:orderLineItem`, an `lgl` `contractSide`, or a `status` property on `lgl:Contract`, and this cycle changes no other module. Verified 2026-10-14:
- The legal `PROP_DEFS` (`seed.ts` lines 253-262) have no `status` or `contractSide`, and the logistics ones (lines 286-298) have no `orderLineItem`.
- The generated Contract nodes do carry a `status` value in their properties (`seed.ts` lines 804 and 812) without a declared property.

These additions return when a rule needs them, for example a TermDeviation check that the contract was in force.

## 7. Not in this cycle

**VETO's grounds, stated honestly.** ENGINEER does not clear VETO. VETO kills or clears in the next cycle.

1. **Privilege (ground 1).**
   - *Designed:* `accessClass` on every record; a named holder seat on every record marked privileged; and the fact (TermDeviation) kept in a separate record from the assessment (EffectClaim), so marking the assessment never marks the fact.
   - *Not done:* enforcing access anywhere; recording the basis claimed (attorney-client or work product); producing a privilege log; and restricting who can read a privileged record's content.
   - *Gate (the loading gate):* no real record of any class, commitments included, is loaded into any workspace until three things hold: `accessClass` is enforced on every read path; VETO has cleared grounds 1 and 2 in a later cycle; and the designs listed under ground 3 exist.
   - Whether this answers ground 1 is VETO's call.
2. **Commitments and contracts (ground 2).**
   - *Designed for commitments:* the promisor; the seat, for promises the company gives; the date of the promise; the counterparty; where the promise is written down; evidence whenever it is not in an executed contract; an individual author (`hr:Person`, XR-13i), named apart from the person who entered the record; and a draft state.
   - *Other records:* on records other than commitments the author may be an org unit, which names no person with knowledge, and its class is not checked.
   - *Knowledge and timing.* The layer records but does not certify whether the author had knowledge, or whether the record was made at or near the time. Those are the FRE 803(6)(A) points VETO raised, and others judge them from `attributedTo`, `recordedAt` and `promisedOn`. `recordedAt`, like every field, can be rewritten in place without trace (4.5), so this layer cannot show that it is the original entry time; an edit history is part of ground 3's open design.
   - *Authority.* Whether the seat carried authority to bind the company is not checked, because DecisionRight is deferred.
   - *Contracts.* Contract records are `lgl:Contract` nodes, outside `xfn`. This cycle changes neither their authorship nor their evidence. Only TermDeviation, the record about a contract, is attributed.
   - *Workspace data.* Whether workspace people carry `rdf:type hr:Person` is shown for seeded nodes (`rdfBridge.ts` line 295), not for every ingestion path (UNVERIFIED).
   - Whether this answers ground 2 is VETO's call, and the loading gate under ground 1 waits on it.
3. **Disposal (ground 3).** VETO stated that this ground is not met today. It will recur in either of two cases:
   - the graph holds personal data that GDPR Article 17(1) obliges the company to erase, subject to exceptions such as 17(3)(e);
   - a record copies a document produced in discovery and the producer gives notice under FRCP 26(b)(5)(B).

   This cycle loads only invented fixtures, adopts no prohibition on deletion and no immutability, and has EvidenceItem locate sources rather than copy them. *Not designed:* erasure, tombstones, edit history, retention references and sequestration. They must be designed before any real data is loaded (the loading gate under ground 1), because every record names people (`attributedTo`, `recordedBy`, `decidedBy`, `promisedBy`). Any later immutability or edit-history norm must be reconciled with erasure and sequestration before it is adopted.
4. **The conditions approved in D-016** (superseded spec, lines 30-33):
   - "privileged and protected by access classifications": the marking is designed, the protection is not;
   - "commitments and contracts ... attributed authorship and evidence citations": commitments are designed, contracts are unchanged;
   - "formally tombstoned under legal retention rules": not designed.

   All three recur.

**Vocabulary deferred.**
- *Classes:* the 29 names refused this cycle (4.1). Among them:
  - Appraisal, so there are no verdicts or disputes;
  - Transfer and Handoff, so there are no risk or work handovers;
  - Perspective and LegalEntity;
  - DecisionRight, so authority is not checked.
- *Draft properties not carried:*
  - claim content: `claimedSign`, `preferredDirection`, `dependencyKind`, `orientation`, the onset lags, `statedCredence` and `statedLikelihoodTerm` (a likelihood stays in the statement's words);
  - decision scope: `causeContrast` (which means claims with no decision), `decisionStatus` (which means proposed decisions), `decidingFunction`, `consultedFunction`, and the baseline and intervention states;
  - commitments and contracts: `isContractual` (which can be derived from `capturedIn`), `exitTerms`, `bindsUntil`, `judgedBy`, `deviatingClause`, `benchmarkClause` and `deviationApprovedBy`;
  - evidence: `evidenceClass`, the observation window and `selectionCriteria`;
  - metrics and variables: the Variable's `valueType`; the MetricVersion's unit, scale, lifecycle and supersession fields; `bindingPurpose` and `bindingPeriod`;
  - functions and seats: `functionKey`, `headedBy`, and Position's links to `hr:Role`, `hr:OrgUnit` and the people who hold it;
  - record lifecycle: `contentDigest`, `withdrawnAt` and `generatedIn`.
- Any other property of the draft is out of scope unless 4.2 lists it.

**Stated but not checked.** Declarations in 4.1 and 4.2 that no unit enforces:
- **`subFunctionOf`:** at most one; range BusinessFunction; acyclic; rooted at Enterprise.
- **Cardinality 0..1 with no unit:** `magnitudeStatement`, `sourceLocator`, `baselineDescription` and `benchmarkContract`.
- **Text datatypes.** The declared datatype `xsd:string` is not checked on `statement`, `variableDefinition`, `magnitudeStatement`, `evidenceSummary`, `evidenceSourceSystem`, `sourceLocator`, `metricName`, `definitionText`, `baselineDescription` or `unitDimension`. Whether language-tagged text (`rdf:langString`) is admitted for an author's verbatim words is open.
- **Cross-module range classes,** except a commitment's `attributedTo`. That covers `attributedTo` elsewhere, `recordedBy`, `decidedBy`, `promisedBy`, `commitmentCounterparty`, `deviationInContract`, `benchmarkContract`, `evidencedIn` and `evidenceSource`. The last three are not even checked to be IRIs.
- **The kind of `promisedBy`:** the company's person for a given commitment, the counterparty's individual for a received one.
- **Per-unit labels:** that a per-unit quantity carries a per-unit `unitDimension`.
- **No copying:** that no record copies a source.
- **Edits after entry,** which leave no trace.

**Integration.**
- The gaps listed in 4.4 remain: no seed tuples applied, no module-registry entry, no compiler support or product loading of the rules, no access enforcement, and no API, ingestion, export or UI. So USER's page does not exist yet.
- **IRI collision.** The scenario's contract IRIs `ctr:ACME-CTR-0042` and `ctr:ACME-CTR-0017` are the IRIs the seed generates for demo contracts: `seed.ts` lines 802-812 create `lgl:Contract/ACME-CTR-0001` to `0095`, and 0042 is "active". Before any `xfn` record is loaded into a seeded workspace, the scenario IRIs must not collide with seeded contracts; the draft's walkthrough used ACME-CTR-0101. Nothing is loaded this cycle, so no fixture changes now.

**Publishing.** The spec stays PROPOSED, and nothing of `xfn` is committed until the owner approves (D-019). D-015's list still applies: say plainly that the scenario is invented, present legal citations as the VETO persona's concerns, and decide whether D-001 belongs in the public record. The one legal reading that is not VETO's, the reviewer's note in 4.0, is a further publication decision for the owner, beside D-001: publish it as marked, or drop it. In addition:
- **The superseded spec.** `docs/specs/2026-10-14-xfn-semantic-layer.md` names BUILDER personally (line 13), against D-016. It also states legal claims as fact: line 27, "that triple is discoverable"; line 56, "privilege will be waived"; line 54, a SOX citation that no ground rests on; and line 58, an unsourced "financial reporting standards" claim.
  - The whole `docs/specs/` directory is untracked (git status, 2026-10-14), so the old file would go in with the D-019 commit. Specs are append-only, so it cannot be rewritten.
  - Before the D-019 pull request, the owner decides between two options: keep the old file out of the public commit (for example, on a local-only branch), or publish it with an owner-approved superseding notice in this spec.
  - Until then it is an open publication decision, listed next to D-001.
- **Notice placement.** The Notice at the top of section 3 must also stand above section 1 and in section 2's heading, ahead of the transcript and its legal citations. Sections 1 and 2 are added when the document is assembled, and placing the Notice there is part of that assembly; this spec does not move it.

**A finding outside `xfn`, reported and not fixed.**
- `seed.ts` line 314 declares `sparql: "endDate >= startDate"` on `hr:EmploymentContractShape`. The string is not a SPARQL query.
- The server's compiler drops it silently (`rdfBridge.ts` lines 449-470), and every validation path goes through that compiler (`ontologyRouter.ts` line 760, `actions/service.ts` line 240, `mappingSync.ts` line 282).
- The UI's read-only Turtle does show it, as `sh:sparql` (`studio-utils.ts` line 219; `library/lib.ts` line 174).
- So the HR rule looks present in the UI and is never enforced. This goes to the owner.

**Entries to append to `docs/DECISIONS.md`** (not appended: this cycle's work was read-only; each is `APPROVED BY: nobody — pending`):
1. A correction of D-013 question 11, with evidence `rdfBridge.ts` line 21, `studio-utils.ts` line 73 and `seed.ts` line 314: the stored form holds `sparql` and the compiler drops it; it cannot hold `sh:in` or `sh:nodeKind`. D-002 stands.
2. The MetricBinding layer boundary (6, Q1), for the owner.
3. The rewritten `xfn-shapes.ttl` carries no legal citation, which goes further than D-015.
4. Whether the superseded spec is published, for the owner.

## 8. State carryforward

**What was built or declined.**
- **Built:** nothing. This spec is PROPOSED.
- **ENGINEER's choice:** (b). If the owner approves, the code is `xfn`'s cycle-1 contract as hand-written rules and tests, not seeded and not loaded anywhere: 14 classes, 51 properties, 65 rule units in 15 node shapes with 129 constraints, 20 refusal tests with 168 cases, 8 acceptance tests and 2 guards.
- **Declined:** BUILDER's seeded module drawn from the draft (35 classes, 247 properties), in the form proposed.
- **Rule 4:** no pivot, because USER's page is read as the same feature from its reader's side. The owner may read it otherwise, in which case the page is (c) and this contract is BUILDER's reframe (section 3).

**Invariants preserved.**
- No triple links two Variables except `xfn:revises` (XR-01).
- `xfn` holds claims and never asserts them; status records the speech act only (XR-07).
- **Layer purity.**
  - `xfn` holds no values, estimates, scores, rollup or propagation, and ExposureGap is refused (XR-04).
  - A total's bearers and a claimed effect's bearers are read by query, not stored or enforced.
  - If the owner admits MetricBinding, `xfn` holds only the attributed fact that a seat is evaluated on a metric version, and the incentive system holds terms and scoring.
- `xfn` links point from `xfn` records into other modules, never back, and no other module changes.

**Invariants newly introduced.**
- Every record names one author, one recorder, one time, one access class, one speech-act status and at most one statement (XR-03, XR-06, XR-07, XR-20). Every such rule sits in one shape whose target list is exercised class by class (GUARD-02).
- Any record marked privileged names one holder seat (XR-05).
- A claim's cause is a variable its decision set (XR-10), and its effect is not its cause (XR-11).
- `revises` is bounded (XR-08).
- Every decomposition is additive, and a total and each of its parts state one shared kind of quantity (XR-02).
- Every metric definition names its owning function (XR-17b).
- A scorecard binding is pinned to a version of its own metric (XR-18f).
- A commitment names:
  - its individual author (XR-13i);
  - its promisor;
  - its seat, when the company gives it;
  - its date, its counterparty, and where it is written down;
  - evidence, when it is not in a contract (XR-13, XR-14).
- Nothing outside the vocabulary is accepted silently (XR-19a, XR-19b).
- No rule in `xfn` forbids deletion, and no immutability is adopted.

**Open VETO conditions that will recur.**
- **Ground 1:**
  - the loading gate (section 7): no real record is loaded until `accessClass` is enforced on every read path, VETO has cleared grounds 1 and 2 in a later cycle, and ground 3's designs exist;
  - privilege basis and privilege log.
- **Ground 2:**
  - the loading gate waits on VETO clearing this ground;
  - authority to bind (DecisionRight);
  - authors that are org units on records other than commitments;
  - whether the author had knowledge and whether the record was made at or near the time (FRE 803(6)(A)) are recorded, not certified, and `recordedAt` can be rewritten without trace (4.5);
  - contract records (`lgl:Contract`) keep their authorship and evidence unchanged and unaddressed.
- **Ground 3:** the designs listed in section 7 ground 3 (erasure, tombstones, edit history, retention references and sequestration), once personal data or documents produced in discovery could enter. They must be designed before any real data is loaded.
- **D-016's approved condition** that records can be formally tombstoned under legal retention rules: not designed.

**USER's stated priority for the next cycle.** USER did not name a next cycle. What USER said they needed is carried forward as the next cycle's feature: one page to hand across the table, showing:
- who approved the vendor change, and when;
- what each VP is asserting, under whose name, and when;
- where every number came from;
- which departments' remits the claimed effects land in, and, for any total, its constituents' remits beside it;
- Procurement's unit-price savings and Operations' landed-cost savings side by side, each with its owner, and neither official;
- the missing indemnity clause as a fact that can be checked, kept apart from opinions.

USER's kill conditions stand as acceptance criteria for that cycle:
- no causal claim presented as settled fact;
- no single name to blame;
- no number that cannot be traced to who said it and when;
- no lock-up;
- no silent choice of a winner when departments define a term differently.

---

## Appendix A. How this spec was produced

- **The cycle.** Run on 2026-10-14 under the author's Adversarial Persona Loop protocol, kept outside this repository. Each persona was a separate agent, in the protocol's order, and spoke once. An independent checker judged each turn against the protocol's rules for that persona and its anti-patterns, and a rejected turn was written again from scratch. BUILDER and USER passed at the first attempt. VETO's first attempt was rejected because its disposal objection rested on a retention schedule it did not identify; the second attempt names an authority for each ground and was accepted.
- **The briefs.** BUILDER was briefed by role, as D-016 requires. USER and VETO were briefed with the role, concerns and veto conditions of section 1 in paraphrase. USER's brief added that the scenario is invented. VETO's brief stated concern 1 as an assertion that "may be sought in discovery", where section 1 says it "is discoverable", so that the persona would not be handed an overstated rule.
- **The spec.** Four independent checkers (protocol, coherence, layer purity, honesty) raised 45 issues on ENGINEER's first spec. The first revision resolved 44 and left the Notice's placement to assembly. A check of that revision found 6 new problems; with the orchestrator's 3 notes, ENGINEER's second revision resolved all 10, and its check confirmed nothing else had changed in substance. That check found 5 further low-severity problems, which the orchestrator fixed in six edits (the first problem needed two):
  1. Section 3: "VETO's two grounds" became "VETO's grounds ... the two it kills on", since ground 3 is also a condition of the loading gate.
  2. Section 8, ground 3: points to section 7's list of the missing designs instead of a shorter list of its own.
  3. Section 7, Publishing: names the reviewer's note in 4.0 as a publication decision for the owner, beside D-001.
  4. Section 4.3: no rule message may state or imply immutability.
  5. Section 5.6, item 7: REFUSE-02's change from "USD" to "money" needs the owner's approval, like ACCEPT-06's item 12.
  6. ACCEPT-07: the neutral Variable reads "Annual cost to Acme of obtaining component C", so that it covers landed cost as well as unit price.
- **Evidence.** The facts the spec cites from live runs are recorded in `docs/DECISIONS.md` (D-010 to D-012). Facts about the code were read from the files on 2026-10-14; nothing in this spec was run.

---

## Status record (appended 2026-10-14; nothing above is changed)

- **Approved** as written by the owner on 2026-10-14 (`docs/DECISIONS.md`, D-022). The status line at the top records the state when this spec was written.
- **Implemented** from sections 4 and 5 (D-026): `docs/semantic-layer/xfn-shapes.ttl`, `docs/semantic-layer/xfn-classes.ttl`, `app/api/__tests__/xfnFixtures.ts` and `app/api/__tests__/xfnSemanticLayer.test.ts`.
- **Shown failing first** (D-027): every one of the 129 constraints, the `revises` exemption and GUARD-02's seven structural mutants, each against the unchanged suite (T6); and every refusal case conforms with its listed units disabled (T5).
- **Where the runs differ from this spec's wording**, recorded in D-027 and not changed here: s1 fails 11 refusal cases, not one; the XR-06 and XR-07 `minCount` copies also fail R03-k; the copy without the `revises` exemption also fails R08-a, R08-b and R08-d.
- **Tests that check more than this spec asks** (pending the owner, D-026 item 5 and D-027): the Fixtures group, check 5's count of 15 `sh:select` strings, and exact (unit, focus node, component) result sets in every refusal case.

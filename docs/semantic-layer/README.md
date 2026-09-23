# Cross-Functional Core (`xfn`) — draft

**Status: unfinished design. Not implemented.**

`xfn` is the proposed semantic layer for cross-functional decision modelling: how a
decision in one business function lands as a consequence in another. It relates the
existing modules (`hr`, `lgl`, `cmp`, `fin`, `log`) without editing them, and it holds
*claims* about cross-boundary effects — with their claimant and evidence — without ever
asserting that a claim is true. Causal inference, measurement, incentive design and
roll-up are separate systems meant to bind to it through its extension points.

| File | Contents |
|---|---|
| [`xfn-draft-spec.json`](xfn-draft-spec.json) | The synthesis draft: 35 classes, 247 properties, 13 extension points, 23 cross-module links, 17 reconciled terminology conflicts, and a walkthrough of the anchor scenario |
| [`xfn-draft-critiques.json`](xfn-draft-critiques.json) | The three adversarial critiques of that draft — ontology rigour, layer purity, executive realism — raising 56 issues |

## Why it is a draft

The design ran as a multi-agent workflow: eight domain agents, five architecture agents,
one synthesis agent, then four critics and a final pass meant to fold their findings in.
Three critics ran. The fourth, integration against this codebase, and the final pass both
failed when the run hit a usage limit.

So none of the 56 issues has been applied. Twelve of them are places where the draft
still carries logic belonging to the causal, measurement, incentive or propagation
layers — exactly what the layer is meant to exclude. Resolve those before implementing,
and check the prefix, tuple shapes and cross-module class names against `app/db/seed.ts`,
since the integration critique never ran.

See [`AI_AGENT_ARCHITECTURE.md`](../../AI_AGENT_ARCHITECTURE.md) for how the workflow was
set up.

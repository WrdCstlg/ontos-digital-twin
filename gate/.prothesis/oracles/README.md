# `.prothesis/oracles`

Oracle definitions. One YAML file per oracle, one oracle per file.

Everything in this directory is content-hashed into `.prothesis/lock`.
Changing, adding or removing anything here moves the digest, and a run whose
digest does not match the lock exits **4** (`ORACLE_DRIFT`) — the one
exit code an agent loop must never resolve on its own. Re-baseline it
deliberately:

    thesis oracles lock --reason "why this changed"

## The definition format — `prothesis.oracle_def/v1`

    version: prothesis.oracle_def/v1
    name: linearizable.kv
    class: consistency
    valid_phases: [ASSERT]
    cmd: "./bin/linearizable-kv"
    timeout: 120s

| key | required | meaning |
|---|---|---|
| `version` | yes | always `prothesis.oracle_def/v1` |
| `name` | yes | the identity in the verdict and in the lock; unique across the directory |
| `class` | yes | one of `crash`, `consistency`, `liveness`, `convergence`, `resource`, `safety`, `differential`, `metamorphic` |
| `valid_phases` | yes | lifecycle phases in which **evaluating** the oracle is meaningful (invariant I5) |
| `cmd` | yes | the executable and its arguments; relative to the project directory |
| `timeout` | yes | wall-clock bound on one evaluation, e.g. `120s` |

Unknown keys are an error, not a default. A file that does not parse fails the
run rather than being skipped: an oracle that silently disappears would let a
gate go green over a property nobody checked.

Files whose names do not end in `.yaml` or `.yml` are ignored,
so a README, a checker's source, or a committed helper script can live here too.

## The executable contract (directive 4.5)

An oracle is a separate process. It may be written in any language and may carry
its own dependencies — that is the reason the contract exists.

* **stdin** — `prothesis.oracle_input/v1`: the paths to this world's
  history, final state, telemetry and `.thesis` file, plus the
  **measured** phase windows in milliseconds relative to DRIVE start.
* **stdout** — `prothesis.oracle_output/v1`: `schema`,
  `status` (`ok` / `violated` / `inconclusive`),
  `witness` and `explanation`. Echoing `oracle`,
  `class` and `valid_phases` is optional; if you do echo them
  they must match this file.
* **exit code** — `0` ok, `1` violated, `2` inconclusive.

### The rules that decide whether your oracle is believed

1. **The exit code and the reported status must agree.** They are two
   independent channels and a disagreement is a defect in the oracle, so
   *neither* reading is adopted: the finding becomes `inconclusive` and
   says which channel said what.
2. **Anything that is not a clean answer is `inconclusive`, never
   `ok`.** A crash, a hang that hits the timeout, an unparseable
   document, an empty stdout, an exit code outside 0/1/2, or more than 1 MiB of
   stdout all land there. Exit 2 means "retry once, then escalate to a human".
3. **Report `inconclusive` when you could not check.** A checker handed
   an empty history has checked nothing; one that exhausted its budget has
   checked part of something. Saying `ok` there is the single most
   damaging thing an oracle can do, because the gate goes green precisely
   because nothing happened.
4. **Only report `violated` with a witness.** A false positive destroys
   the value of every other verdict this tool emits.

### Placing a finding on the timeline

`prothesis.oracle_output/v1` carries no timestamp, so two **optional**
witness members are read (additive — see `OPEN_QUESTIONS.md` OQ-030):

    "witness": {
      "op_ids": [90002, 90117],
      "key": "k/42",
      "first_seen_ms": 11084,
      "phase": "DRIVE"
    }

* `first_seen_ms` — milliseconds relative to DRIVE start. The engine
  derives the observed phase from it against the measured windows.
* `phase` — pins the observed phase directly, for evidence with no
  usable timestamp.

Both describe where the **evidence** lies. That is
`violations[].phase`, which is a *different field* from this file's
`valid_phases` and is routinely outside it: a stale read found by an
ASSERT-only consistency oracle is observed in DRIVE. Nothing checks one against
the other.

### stderr

Captured into the run bundle at
`<run>/world-NNNN/oracles/<name>.stderr.log` and excerpted into the
explanation when the finding is not `ok`. Write diagnostics there
freely; stdout is the contract channel and must carry only the document.

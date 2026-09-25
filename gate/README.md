# Ontos under the PRO-THESIS gate

[PRO-THESIS](https://github.com/WrdCstlg/pro-thesis) boots Ontos from Docker
Compose, drives it through its HTTP API, injects faults, and asks oracles whether
what happened is something a correct system could have done. This directory
holds everything on the Ontos side of that contract. PRO-THESIS itself is a
pinned tool, not a dependency this repository edits: if it needs to change to
fit Ontos, that is a finding for its maintainers, reported with the world file
and `verdict.json` of the run that showed it.

## Pinned tool

```bash
go install github.com/WrdCstlg/pro-thesis/cmd/thesis@v0.1.0-phase0
thesis version   # thesis 0.1.0-phase0 (spec prothesis/v1)
```

A different version may change verdicts.

## Run it

Docker with Linux containers and Compose v2. From this directory:

```powershell
pwsh -File scripts/build-images.ps1    # ontos-app:<sha>, ontos-gate-db:<sha> for HEAD
pwsh -File scripts/build-tools.ps1     # bin/ontosload and the two oracle checkers
thesis oracles verify                  # the lock matches the committed definitions
$env:ONTOS_GATE_TAG = "<sha>"
thesis run --profile smoke             # three worlds, no faults
```

CI runs the same steps on every push and pull request
([`.github/workflows/gate.yml`](../.github/workflows/gate.yml)): verify the lock,
build the images for the commit, then `smoke` and the pre-registered fault
worlds: the app restarted mid-import, and a worker restarted or frozen under a
backlog.

`build-images.ps1` builds the app image and then a MySQL image that already
holds the demo workspace, migrated, seeded and with the gate admin provisioned,
by running that app image's own bootstrap against a scratch database. Each world
tears down with its volumes, so this is what makes every world start from the
same state with no init service. It also adds gate fixtures. Three copies of the
CSV mapping, because imports of one mapping are deduplicated, so more mappings
are what let both workers be busy at once. Two bulk mappings, `gate-bulk 1` and
`gate-bulk 2`, over a generated 1000-row CSV (`-BulkRows`), each writing its own
subjects: their imports take seconds rather than milliseconds, so a fault on a
worker lands on a job it holds.

## What is here

| Path | What it is |
|---|---|
| `prothesis.yaml` | Nodes (`app`, `engine`, `db`, workers `worker-a` and `worker-b` with their engines), health probes, driver, fault policy, oracles, profiles |
| `compose.gate.yaml` | Images only, `restart: "no"`, every node on a `127.0.0.1` port |
| `cmd/ontosload` | The driver: signs in once, queues imports with `mapping.runSync` and follows each job to its end, writes the history, honours the stdin drain |
| `cmd/oracle-sync-jobs` | The `sync_jobs.settle` oracle: after the world goes quiet, no sync job may still be queued or running |
| `cmd/oracle-job-leases` | The `jobs.lease_lapse` oracle: a worker that recorded it was asked to stop never leaves its job to the lease; it finishes the job or hands it back. Lapses on workers that went silent (frozen, killed) are excused |
| `.prothesis/oracles/` | Oracle definitions, hash-locked with the covered config keys into `.prothesis/lock` |
| `.prothesis/PREREGISTRATION.md` | Expected outcomes, written before the worlds they describe |
| `observations/` | What the worlds showed, against their pre-registration, with each run's `verdict.json` and world files |
| `db/Dockerfile`, `scripts/` | The seeded database image and the build scripts |

## Rules

- The oracle definitions and the covered config keys are locked. Changing them
  without `thesis oracles lock --reason "..."` makes every run exit 4, which
  means "someone changed the test", not "a test failed". The reason is written
  by a person.
- Never edit `.prothesis/` to make a gate pass. Fix Ontos.
- A fix and an oracle change never go in the same commit.
- A new world's expected outcome is written down before it first runs.

## Outcomes

| Exit | Meaning |
|---|---|
| 0 | Pass: every planned world ran and no oracle found a violation |
| 1 | Fail: an oracle proved a violation, with a witness |
| 2 | Nothing proven: an oracle could not evaluate, or the harness hit an error |
| 3 | Budget exhausted before the worlds were done |
| 4 | The locked test definitions moved |
| 5 | Invalid configuration |

## Known limits

- Only `thesis run` is supported. The driver takes the app URL from
  `prothesis.yaml`, so `thesis search` (parallel worlds on per-slot ports) would
  need it to read `PROTHESIS_PORT_APP` first.
- `sync_jobs.settle` reads MySQL by `docker exec` into the container labelled
  `io.prothesis.node=db`, and refuses to judge if more than one is running.
- Node logs land in the run bundle. Ontos logs no secrets, but check a bundle
  before sharing it.

# Pre-registration: a sync job stranded by an app restart

Written on 2026-09-24, before the first `stuckjob` world ran, and committed ahead
of it; the commit that adds this file is the timestamp. Tool: `thesis`
v0.1.0-phase0. System under test: the app code of Ontos commit `eedbf52`, as
images `ontos-app:eedbf52` and `ontos-gate-db:eedbf52` built by
`scripts/build-images.ps1`.

## The world

```powershell
$env:ONTOS_GATE_TAG = "<image tag under test>"
thesis run --profile stuckjob --fault "proc.restart(app)@3000..9000"
```

Driver profile `imports`: two clients run `mapping.runSync` on the seeded
340-row HRIS CSV mapping back to back. In the measurement world
(`r_2026_09_24_c05c`, no faults) that was 10 imports in about 1.5 s of driving,
all `ok`. At 3000 ms into DRIVE the harness runs `docker stop` on the app
container (SIGTERM, then SIGKILL after Docker's default 10 s grace) and then
`docker start`.

`proc.restart` is used rather than `proc.kill` because HEAL never restarts a
killed node: the app would stay down, `availability_after_heal` would fail for
that reason alone, and no fix that runs when the app starts could ever be
observed.

## Prediction on today's code

**FAIL, exit 1**, with exactly one violation:

- `sync_jobs.settle` is `violated`. Its witness lists at least one job still
  `running` 30 s after QUIESCE, begun about 3 s into DRIVE. MySQL stores
  `startedAt` to the second and the database runs on a different clock from the
  host, so `started_ms` is expected between 1000 and 5000.
- `no_crash` is ok (the app's exit falls inside the fault window), and so are
  `no_panic_log`, `no_stuck_op`, and `availability_after_heal` (the app is back
  before HEAL).

Mechanism, from the code:

1. `runSync` takes its database handle once, when it starts
   (`app/api/mappingRouter.ts:322`), and writes the job as `running` before
   importing (`:342-345`).
2. SIGTERM runs `gracefulShutdown` (`app/api/boot.ts:356-386`), which closes the
   MySQL pool (`closeDb`, `:366-372`) *before* it closes the HTTP server, so an
   import in flight loses its database part-way through.
3. The import's next query fails. Its `catch` (`mappingRouter.ts:522-528`) tries
   to mark the job `failed` through the same closed pool, which fails too.
4. The process exits. When it starts again, nothing reconciles jobs left
   `running`.

## The fix, and the prediction after it

The fix: when the app starts, before it serves a request, it marks every job
still `running` as `failed`. That is safe because Ontos runs one app process per
database (README, Known limitations). It is a separate commit from this file and
from the oracle.

- Same world against the fixed images: **PASS, exit 0**, with `sync_jobs.settle`
  ok.
- Same world against images built with the fix reverted: **FAIL, exit 1**, as on
  today's code.

## What would make it come out differently

| Outcome | What it would mean |
|---|---|
| PASS on today's code | No import was in flight when the pool closed, or the graceful path let it finish. Either way the mechanism above is wrong for this world, and the record will say so rather than re-run until it fails. |
| Exit 2 from a harness error | `proc.restart` has never been realized in a recorded PRO-THESIS world. A misbehaviour is a finding for the harness side, reported with the world file and `verdict.json`. |
| `sync_jobs.settle` inconclusive | The oracle could not read MySQL or no import completed. The gate did not test anything, and that is the finding. |
| Another oracle fails as well | For example, the app not healthy by HEAL. That is a second finding, recorded alongside the first. |

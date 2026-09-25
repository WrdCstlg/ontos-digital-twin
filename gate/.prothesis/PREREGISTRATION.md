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

---

# Pre-registration 2: the job queue and its workers (increment 1)

Written on 2026-09-24, before any of these worlds ran, and committed ahead of
them. System under test: the images built from the commit that moves CSV imports
onto a job queue run by worker processes (`mapping.runSync` now queues and
returns; workers lease jobs for 15 s, renew every 5 s, retry up to three
attempts). The gate stack gains two workers, `worker-a` and `worker-b`, each with
its own engine, and three gate-fixture copies of the CSV mapping so both workers
can be busy at once. `sync_jobs.settle` now counts `queued` as well as `running`
as unsettled. Each driver operation queues an import and follows its job: `ok`
only when the job succeeded.

## The worlds and their predictions

| World | Command | Prediction |
|---|---|---|
| Smoke | `thesis run --profile smoke` | PASS, 3 of 3 |
| App restart (the first pre-registration's world) | `thesis run --profile stuckjob --fault "proc.restart(app)@3000..9000"` | PASS: imports no longer live in the app, so restarting it strands nothing. The driver's operations in flight end `info` or `fail` while it is down |
| Worker restart | `thesis run --profile workers --fault "proc.restart(worker-a)@3000..9000"` | PASS: see below |
| Worker frozen past its lease | `thesis run --profile workers --fault "proc.pause(worker-a)@3000..23000"` | PASS: see below |

**Worker restart.** SIGTERM makes worker-a stop claiming and finish its job
within its 5 s grace (an import takes well under a second here), or abort it back
to the queue. Worker-b keeps working throughout. Worker-a comes back under a new
id. Expected: no unsettled job; worker-a healthy after HEAL; `no_crash` ok (its
exit falls inside the fault window).

**Worker frozen past its lease.** The `backlog` profile keeps both workers busy,
so worker-a is holding a job when it is frozen. Its lease lapses about 15 s
later and worker-b reclaims the job: the job ends `succeeded` with attempts of at
least 2 and a `lastError` naming worker-a's lease as expired and worker-b as the
reclaimer. At 23 s worker-a wakes, its next renewal fails, and it abandons the
import; its completion or failure write affects no row, because the job is no
longer its to write. Expected: no unsettled job, at least one job carrying that
reclaim record, worker-a healthy after HEAL.

## Expected, and not judged by any oracle

- The reclaimed import may run twice (at least once is the queue's promise, not
  exactly once): an extra graph snapshot, and possibly a second audit entry for
  that sync job. The record will say whether it happened.
- Two workers finishing imports together can hit the audit writer's deadlock
  (found in OBS-GATE-001). That attempt now fails and is retried, so a job may
  show a `Deadlock found` error with attempts of 2.

## What would make it come out differently

| Outcome | What it would mean |
|---|---|
| The pause world passes with no reclaim record | Worker-a was not holding a job when frozen, so the world did not test leases. The record will say so rather than count it. |
| `sync_jobs.settle` violated | A job never settled: reclaim or fencing is broken. A bug. |
| A worker not healthy after HEAL | A finding about the worker's recovery. |
| Exit 4 | The lock was not re-baselined for these changes. |

# Pre-registration 3: bulk imports, so a fault on a worker lands on a held lease

Written on 2026-09-24, before any of these worlds ran, and committed ahead of
them. System under test: the same application as pre-registration 2 plus
f4d5cca, which makes a worker log each job it takes on a second or later attempt.

## Why pre-registration 2's pause world does not count

Run `r_2026_09_25_4c2f` froze worker-a from 3 s to 23 s and passed, but
worker-a's log holds only its startup line. Had it been holding a job, the lease
would have lapsed during the freeze and on waking it would have logged losing the
lease. It was holding nothing: a fixture import takes well under a second, so a
worker spends most of its time between jobs. By pre-registration 2's own table,
that world did not test leases, and it is recorded as not counted
(OBS-GATE-002).

## What changes in this commit

- Gate fixtures: two bulk CSV mappings, `gate-bulk 1` and `gate-bulk 2`, over a
  generated 1000-row CSV. Each writes its own subjects, so two workers importing
  at once never upsert the same rows. Measured on the build host, on a stack of
  images built from this tree: two bulk imports side by side take 4 to 6 s
  each over six rounds (one round took 8 s).
- The driver gains `sync_bulk`, an import of a bulk mapping, recorded in the
  history as `sync`. The `backlog` driver profile is six clients of `sync_bulk`:
  with imports deduplicated per mapping there are at most two jobs, one per
  worker, and each worker is holding one nearly all the time. At most two jobs
  are unsettled at the drain.
- The pause window grows from `3000..23000` to `3000..38000`. Worker-a's lease
  lapses at most 15 s after its last renewal, so by 18 s. Worker-b reaches it
  once its current import ends (up to 6 s here) and it next polls (1 s): by
  about 25 s here, about 31 s on a runner half as fast. A renewal checks the
  owner and status, not expiry, so if worker-a woke first it would carry on and
  the world would test nothing; 38 s leaves room.
- Nothing under the lock changes. Driver profiles and fault windows are not
  lock-covered; `thesis oracles verify` must pass at the current lock.

## The worlds and their predictions

| World | Command | Prediction |
|---|---|---|
| Smoke | `thesis run --profile smoke` | PASS, 3 of 3 (the `imports` profile still uses the fast mappings) |
| App restart | `thesis run --profile stuckjob --fault "proc.restart(app)@3000..9000"` | PASS, as in pre-registration 2 |
| Worker restart | `thesis run --profile workers --fault "proc.restart(worker-a)@3000..9000"` | PASS: see below |
| Worker frozen past its lease | `thesis run --profile workers --fault "proc.pause(worker-a)@3000..38000"` | PASS, with the evidence below |

**Worker restart.** SIGTERM now lands mid-import. Worker-a stops claiming and
either finishes the import within its 5 s grace or aborts it back to the queue
as `interrupted: worker stopping`, to be retried after 2 s by whichever worker
claims it. `docker stop` waits 10 s before SIGKILL, so the grace always runs.
Worker-a comes back under a new id. Expected: no unsettled job; every node
healthy after HEAL; `no_crash` ok.

**Worker frozen past its lease.** At 3 s worker-a is holding a bulk import. The
lease lapses by 18 s. Worker-b's next claim takes the lapsed job (lowest id
first) and logs `job N (mapping.sync) attempt 2 of 3: lease held by <worker-a>
expired; reclaimed by <worker-b>`, then runs the import to the end. At 38 s
worker-a wakes, its overdue renewal fails, and it logs `lost the lease on job N;
abandoning it` (or, if its import happened to finish first, `job N finished
after its lease was lost; its result was not recorded`). Expected verdict: PASS,
with no unsettled job and every node healthy after HEAL.

This world counts only if both log lines are in the bundle, in worker-b's and
worker-a's logs, naming the same job.

## Expected, and not judged by any oracle

- As in pre-registration 2: the reclaimed import runs twice (an extra snapshot,
  possibly a second audit entry), and imports finishing together can hit the
  audit writer's deadlock and retry. Calibration showed the deadlock once, at
  2000 rows: `insert into audit_log` failed on attempt 1 and the retry
  succeeded. A retry also logs `attempt 2 of 3`, but with the deadlock as its
  reason, so it is not reclaim evidence. The deadlock gets its own oracle-first
  cycle.

## What would make it come out differently

| Outcome | What it would mean |
|---|---|
| The pause world passes without the reclaim line in worker-b's log | Worker-a held nothing when frozen, or woke before worker-b reached the job. Not counted; the fixture or the window is wrong, and the record says which. |
| The reclaim line, but nothing from worker-a after it wakes | Worker-a did not notice it had lost the job. A finding in the worker. |
| `sync_jobs.settle` violated | A job stayed queued or running 30 s after the drain. A bug in reclaim or fencing, unless the witness shows an import simply still running on its first attempt; then the fixture is too slow for that runner, and the record says so. |
| A node not healthy after HEAL | A finding about recovery. |
| Exit 4 | Something lock-covered changed. Nothing in this commit should. |

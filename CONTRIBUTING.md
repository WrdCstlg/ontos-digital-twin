# Contributing to Ontos

Thanks for your interest. This guide covers getting a working environment, the checks every
change must pass, and how to shape a pull request so it can be reviewed quickly.

## Getting set up

The fastest route is Docker — see [Quick start](README.md#quick-start). It gives you MySQL,
the semantic engine and a seeded demo workspace with one command.

For day-to-day development you will usually want the local toolchain instead, because the
Vite dev server gives you hot reload:

```bash
npm run setup                # installs app dependencies (npm ci in ./app)
cp app/.env.example app/.env # set APP_SECRET and DATABASE_URL
npm --prefix app run build:db
npm --prefix app run db:bootstrap
npm run dev                  # http://localhost:3000
```

You need Node.js 20 or newer (CI runs 22 and 24) and a MySQL 8 server. The
[semantic engine](README.md#semantic-engine) binary is optional for most work but required
for the engine integration tests.

Root-level `npm` scripts are thin proxies into `./app`; run anything else with
`npm --prefix app run <script>` or from inside `app/`.

## Checks every change must pass

CI runs these on every push and pull request. Run them before you open a PR:

```bash
npm run check      # TypeScript, strict mode, all four projects (the browser tests included)
npm run lint       # ESLint
npm test           # Vitest
npm run build      # client, server and database bootstrap bundles
npm run test:e2e   # Playwright browser tests, against a running stack (below)
```

A second CI job runs the server tests on a real MySQL 8.4 (`npm --prefix app run
test:mysql`; the README's [Testing](README.md#on-a-real-mysql) section says how to run them
locally). Run them when you change the schema, a migration, the job queue or a query that
groups or counts. A third job builds the Docker image and boots the full compose stack, so
changes to the `Dockerfile`, `compose.yaml` or `db/bootstrap.ts` are exercised end to end. A
fourth boots the same stack with persona login on and runs the browser tests in `app/e2e`
against it.

To run the browser tests locally, start a stack with persona login on: the Docker stack
with `ALLOW_DEMO_LOGIN=true` in the root `.env`, or `npm run dev`, where it is always on.
Install Chromium once with `npx --prefix app playwright install chromium`, then run
`npm run test:e2e`. The tests exercise what the stack serves, so rebuild it after changing
the app, and set `BASE_URL` if it is not on port 3000. See [Testing](README.md#testing) for
what they cover.

**Formatting.** A Prettier config lives in `app/.prettierrc`. The existing codebase is not
uniformly formatted and CI does not enforce it, so please do not reformat files you are not
otherwise changing — it buries the real diff. Formatting the lines you touch is welcome.

## Conventions

**Schema changes need a migration.** Edit `app/db/schema.ts`, then run
`npm --prefix app run db:generate` and commit the generated SQL and the updated `meta/`
files. Do not use `db:push` for anything you intend to commit; it bypasses migration
history. CI fails when `drizzle-kit generate` would still write a migration, and the MySQL
tests fail when the migrations build something other than `schema.ts`. A released migration
never changes (a database that applied it never runs it again): add the new one's hash to
`RELEASED` in `api/__tests__/migrationHistory.test.ts`, whose test tells you the hash.

**A change to the graph is recorded with it.** Whatever writes `kg_nodes`, `kg_edges` or the
ontology tables calls `recordGraphChange` (`api/services/graphChanges.ts`) in the same
transaction, as its last graph write and after its `writeAudit` if it has one. It names the
nodes, classes and properties whose rendering changed, and the nodes that came or went. A
semantic engine that holds a copy of the graph learns of changes only this way. The test in
`api/__tests__/graphChangeWriters.test.ts` counts every write to those tables, and fails on
a new one until it is counted there. A seed that replaces a graph calls
`recordGraphReplaced` instead.

**Seed scripts are destructive.** `db/seed.ts` and `db/seed-twins.ts` clear every table,
including the hash-linked audit chain, before inserting. Never point them at a database
holding data you care about. `db:bootstrap` only seeds an empty database.

**Keep insight rules deterministic.** The rules in `api/insightsRouter.ts` are pure graph
queries so every finding is reproducible and traceable to its evidence. Please keep model
inference out of them.

**Semantic layer scope.** The ontology represents *claims* about how parts of a business
affect one another, with provenance — it does not assert that those claims are true. Causal
inference, measurement, incentive design and roll-up logic belong in separate systems that
bind to it.

**Tests.** Add or update Vitest tests for behaviour you change. Router-level and React
component tests are the largest gap in the suite, so contributions there are especially
welcome.

## How changes land

Every change reaches `master` through a pull request, never a direct push, whoever or
whatever wrote it, a coding agent included. `master` on
[WrdCstlg/ontos-digital-twin](https://github.com/WrdCstlg/ontos-digital-twin) is protected:
a pull request can merge only when it is up to date with `master` and the CI jobs (both Node
versions, the MySQL tests and the Docker stack) and the PRO-THESIS gate have passed. The rule applies to
administrators too.

1. Work on a branch of your own, one topic per branch. Two people or agents never share a
   working tree: each has its own clone or `git worktree`.
2. Open the pull request against WrdCstlg `master` and say how you verified the change.
3. Before it merges, the change gets a review pass focused on what automated checks miss:
   authorization and workspace scoping, secrets in responses, and flows a user takes in a
   browser. The gate and the tests did not catch the defects such a review found in
   September 2026 (see the history of `api/mappingRouter.ts` and `api/searchRouter.ts`).
4. Once merged, the maintainer mirrors `master` to piercepartners:
   `git fetch personal && git push origin personal/master:master`.

## Commits and pull requests

Commit messages follow a Conventional Commits style, as in the existing history:

```
feat(scope): short imperative summary
fix(security): …
docs: …
```

Explain *why* in the body when it is not obvious from the diff. One logical change per
commit; one topic per pull request.

In the PR description, say what changed, why, and how you verified it. If the change
touches authentication, the SPARQL endpoint or anything under `api/lib/`, call that out so
it gets a security-focused review.

## Reporting security issues

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).

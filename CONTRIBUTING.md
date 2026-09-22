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
npm run check   # TypeScript, strict mode, all three projects
npm run lint    # ESLint
npm test        # Vitest
npm run build   # client, server and database bootstrap bundles
```

A second CI job builds the Docker image and boots the full compose stack, so changes to the
`Dockerfile`, `compose.yaml` or `db/bootstrap.ts` are exercised end to end.

**Formatting.** A Prettier config lives in `app/.prettierrc`. The existing codebase is not
uniformly formatted and CI does not enforce it, so please do not reformat files you are not
otherwise changing — it buries the real diff. Formatting the lines you touch is welcome.

## Conventions

**Schema changes need a migration.** Edit `app/db/schema.ts`, then run
`npm --prefix app run db:generate` and commit the generated SQL and the updated `meta/`
files. Do not use `db:push` for anything you intend to commit; it bypasses migration
history.

**Seed scripts are destructive.** `db/seed.ts` and `db/seed-twins.ts` clear every table,
including the hash-linked audit chain, before inserting. Never point them at a database
holding data you care about. `db:bootstrap` only seeds an empty database.

**Keep insight rules deterministic.** The rules in `api/insightsRouter.ts` are pure graph
queries so every finding is reproducible and traceable to its evidence. Please keep model
inference out of them.

**Semantic layer scope.** The ontology represents *claims* about how parts of a business
affect one another, with provenance — it does not assert that those claims are true. Causal
inference, measurement, incentive design and roll-up logic belong in separate systems that
bind to it. See `AI_AGENT_ARCHITECTURE.md` for the reasoning.

**Tests.** Add or update Vitest tests for behaviour you change. Router-level and React
component tests are the largest gap in the suite, so contributions there are especially
welcome.

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

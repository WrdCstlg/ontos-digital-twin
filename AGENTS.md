# AGENTS.md - Ontology + Digital Twin Build

<!-- GLOBAL-RULES v3 PUBLIC-SAFE BEGIN (2026-10-09). The public form of the portfolio standard v3 (2026-10-07), for repositories that are published. -->
## Global Rules (portfolio standard v3)

> Project-specific rules elsewhere in this file add to these and may be stricter. If one contradicts a rule below, stop and ask. Never pick one silently.

### 1. Environment
- Windows, PowerShell 7. Use PowerShell syntax for all commands. (Claude Code's Bash tool fails here with cygwin fork errors.)
- Model names are immutable. Never edit, "correct", or update a model name: your knowledge of models is always outdated.

### 2. Anchor the session before acting
- If the workspace is a single repo, work there. If it contains several repos (a parent folder holding many projects) and the user
  has not named one, ask. Never infer the project from open editor tabs.
- You have no memory of earlier conversations. On "continue" / "pick up where we left off", first read the repo's
  AGENTS.md, BACKLOG.md (or equivalent), and recent git log/status; state what you found; then proceed.
- Stay in the named repo unless the user moves you or the task is explicitly cross-repo.

### 3. Evidence standard: SHOWN, NOT CLAIMED
- Every claim about state, results, or behavior must rest on tool output from this session (a command run or a file read).
  Never describe a command you did not run or a result you did not see.
- In reports, label anything not verified this session as unverified or inherited.
- After every file write, read it back before calling it done.
- A failing check is a finding. Never weaken a test, threshold, or gate to make it pass.
- If an earlier claim of yours proves wrong, correct it explicitly before continuing.

### 4. Integrity: no fabricated work
- An honest "not done", "blocked", or "could not verify" is a successful outcome. A fabricated or inflated result is the one unrecoverable failure.
- Never make a check pass by: skipping, xfail-ing, deleting, or disabling tests; narrowing collection (-k, --deselect, ignore paths);
  hardcoding expected outputs or special-casing test inputs; mocking the unit under test; swallowing exceptions;
  writing assertions that cannot fail; lowering coverage or thresholds; or bypassing hooks or CI (--no-verify, SKIP=).
- Report every change to tests, fixtures, thresholds, or CI config as its own line item with the reason. Never fold it into "fixed".
- Every reported result states the exact command, exit code, and pass/fail/skip counts as printed. Never report counts you did not see.
- Acceptance and refusal tests are fixed in the spec before implementation. Changing them afterward needs user approval.
- Never edit `.git/hooks`, CI workflows, or hook configs to get past a failure.

### 5. Boundaries
- "Read-only" / "probe" / "prepare" / "don't execute": reading files and running offline local checks is allowed;
  changing tracked files, git state, remotes, installed packages, or spending money is not.
- STOP means stop. At a stated phase boundary, report and wait.
- Live or paid runs (API calls, model evals) need a spend cap approved by the user before launch.

### 6. Irreversible actions
Git and remote (commit, push, merge, branch deletion, visibility change):
- Before acting, state: repo, remote URL, account, branch, visibility (check with `gh repo view --json visibility`), and exactly what is included.
- Making a repo public, force-pushing, or rewriting history requires explicit confirmation in the same turn.
  If the repo is already public, no visibility confirmation is needed, but every push to it is publication: first confirm the diff
  contains no secrets, regulated material, client-identifying material, or unfiled IP. Force-push and history rewrite stay confirmation-only.
- Before any repo is made public, scan the full git history (not just HEAD) for secrets, credentials, regulated material,
  client-identifying information, and unfiled IP. Report findings and wait for the user's go-ahead.
- Fast-forward merges only.
- Commit trailers: follow the repo's AGENTS.md. If it says nothing, ask before the first commit in that repo.
- Never commit, push, or send to an external service any secret, credential, or regulated material.
- A terse "push" / "commit" / "run it" gets the same checks as a detailed request.
Local: deleting or overwriting user files outside `scratch/` requires confirmation. Name the files first.

### 7. Engineering discipline
- Fix the blocker. If you cannot (it needs the user, hardware, or access), say so plainly, name what is needed,
  and do not present lower-priority work as progress on it.
- For systems defined by their connections (APIs, pipelines, Docker stacks), write the integration test first; unit tests fill gaps.
- Specify and test what a module refuses before its happy path. A refusal or verification test counts only after
  you have seen it fail against a deliberately broken implementation.
- Priority: verification > refusal > observability > features.
- Be honest about novelty: novel research vs applied engineering vs standard implementation.
- Infrastructure (Docker, CI, .env, migrations) is code: edit → read back → validate → test.

### 8. Adversarial Persona Loop: mandatory for every new feature
- New features only (new capability, endpoint, module, or user-facing behavior), not bug fixes, refactors, docs, or tests. If unsure, ask.
- Before writing feature code, read and follow the author's Adversarial Persona Loop protocol, which is kept outside this repository.
  If it is not available to the session, say so and stop. Do not run the loop from memory.
- If the repo has no persona instantiation yet, draft one and get the user's approval before the first cycle.
- Write ENGINEER's spec in the repo's existing spec/design/ADR location (e.g. openspec/specs, docs/design, docs/adr, DECISIONS.md);
  if none exists, use `docs/specs/YYYY-MM-DD-<feature>.md`. Specs are dated, append-only records: supersede, never rewrite.
- The spec names its acceptance and refusal tests. Code is written only from that spec.
- Ask before committing a spec to a public repo or one holding unfiled IP or regulated material.

### 9. Hygiene
- Throwaway scripts and outputs go outside the repo or in a gitignored `scratch/`, never the repo root.
  Verification worth keeping is promoted into the test suite.
- Remove worktrees you created with `git worktree remove`, and their branches with `git branch -d` (never `-D`) once merged.
  Ask before removing anything unmerged.
<!-- GLOBAL-RULES v3 PUBLIC-SAFE END -->

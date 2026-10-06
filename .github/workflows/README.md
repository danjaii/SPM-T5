# CI workflows

| Workflow | Triggers | What it runs |
|---|---|---|
| `ci.yml` | push to `main`, PRs into `main` | job `test`: migration numbers are unique (`scripts/check-migration-numbers.sh`) → install → Vitest version check (4.1.11) → lint → typecheck → **`pnpm vitest run`** (every workspace's tests, plus a coverage report uploaded as the `coverage` artefact) → build; then job `e2e`: Playwright tests for `apps/web` |
| `c4-diagrams.yml` | `docs/architecture/c4/**` on push to `main` / PRs into `main` | renders `.puml` → SVG, commits rendered output on push, uploads as artifact on PR |

## Why one workflow

`pnpm vitest run` at the repo root is the equivalent of `python -m unittest discover`: the root
`vitest.config.mts` lists the workspaces as Vitest projects, so every workspace's tests are found and
run. Adding a service needs no workflow change.

There are deliberately no `paths:` filters. The whole suite takes seconds, and filters left gaps
(a change to the root lockfile or ESLint config ran nothing) and made required checks hang as "Pending"
whenever a filtered workflow was skipped. If CI gets slow, `pnpm --filter "...[origin/main]"` runs only
the workspaces changed since `main` (plus anything that depends on them) without adding files.

## Recommended branch protection (Settings → Branches)

Protect `main` and require these status checks before merge:

- `CI / test`
- `CI / e2e`

This is what makes "automated testing after each feature implementation" enforced rather
than just available — a PR can't merge until both pass.

## Secrets required

Set these under **Settings → Secrets and variables → Actions** (or as Environment secrets
if you separate `test`/`staging`/`prod`):

- `SUPABASE_TEST_URL`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`

Point these at a disposable Supabase project (or `supabase start` local stack via
`docker-compose.yml`) — never your production project.

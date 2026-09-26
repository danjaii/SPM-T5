# CI workflows

| Workflow | Triggers on changes to | What it runs |
|---|---|---|
| `frontend-ci.yml` | `apps/web/**`, `packages/shared/**` | lint → typecheck → unit/component tests (with coverage) → build → Playwright E2E |
| `_service-ci-template.yml` | (reusable, not triggered directly) | lint → typecheck → unit tests → integration tests → build |
| `service-auth-ci.yml` | `services/auth-service/**` | calls the reusable template scoped to `auth-service`; the unit step runs the US1–US4 auth tests (`tests/unit/auth.test.ts`) with coverage, uploaded as the `auth-service-coverage` artefact |
| `service-event-ci.yml` | `services/event-service/**` | calls the reusable template scoped to `event-service` |
| `service-venue-ci.yml` | `services/venue-service/**` | calls the reusable template scoped to `venue-service` |
| `service-equipment-ci.yml` | `services/equipment-service/**` | calls the reusable template scoped to `equipment-service` |
| `service-notification-ci.yml` | `services/notification-service/**` | calls the reusable template scoped to `notification-service` |
| `c4-diagrams.yml` | `docs/architecture/c4/**` | renders `.puml` → SVG, commits rendered output on push, uploads as artifact on PR |

## Why one workflow per service instead of one big workflow

Each service is tested independently and only when it (or the shared package) actually
changes, via `paths:` filters. This means:

- A PR that only touches `venue-service` doesn't wait on (or fail because of) unrelated
  `notification-service` tests.
- Adding a 6th microservice later is: copy a `service-*-ci.yml` file, change two lines
  (`service_path`, `service_name`), done — the actual pipeline logic stays in
  `_service-ci-template.yml` (a [reusable workflow](https://docs.github.com/actions/using-workflows/reusing-workflows)).

## Recommended branch protection (Settings → Branches)

Protect `main` and require these status checks before merge:

- `Frontend CI (apps/web) / test`
- the `ci` job from whichever `service-*-ci.yml` workflows are relevant to the PR
  (GitHub only requires checks that actually ran for that PR's changed paths)

This is what makes "automated testing after each feature implementation" enforced rather
than just available — a PR can't merge until its scoped tests pass.

## Secrets required

Set these under **Settings → Secrets and variables → Actions** (or as Environment secrets
if you separate `test`/`staging`/`prod`):

- `SUPABASE_TEST_URL`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`

Point these at a disposable Supabase project (or `supabase start` local stack via
`docker-compose.yml`) — never your production project.

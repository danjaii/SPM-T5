# ADR 0001: Split the backend into domain microservices

**Status**: Accepted
**Date**: 2026-09-18
**Sprint**: 1

## Context

ConnectSphere's first release covers five functionality areas with distinct owners and
lifecycles (auth, event requests, venue booking, coordinator assignment, notifications). The
team wants each area independently testable and deployable, and CI feedback scoped to what a
developer actually changed.

## Decision

Split the backend into five Node/TypeScript microservices (`auth-service`, `event-service`,
`venue-service`, `equipment-service`, `notification-service`), each with its own tests,
Dockerfile, and CI workflow. Shared code (Supabase client, role types, validation) lives in
`packages/shared`. All services share one Supabase Postgres instance for the first release,
with Row-Level Security enforcing per-role access rather than each service owning its own
database.

## Alternatives considered

- **Monolith** — simpler to stand up, but every feature branch would run the full test suite
  and the team can't work on separate services without merge conflicts in one codebase.
- **Microservices with a database per service** — better isolation, but event↔venue↔equipment
  workflows need consistent joins/transactions that are hard to do well in a single term project;
  revisit post-MVP if a service's data model diverges enough to need it.

## Consequences

- CI runs per-service (`.github/workflows/service-*-ci.yml`), so a change to `venue-service`
  doesn't trigger or block on `notification-service` tests.
  *Amended 2026-09-27: CI is now a single workflow, `.github/workflows/ci.yml`, that runs every
  workspace's tests on each push to `main` and PR (no path filters), which is simpler for a repo this
  size. Per-service scoping can be added back with `pnpm --filter "...[origin/main]"`.*
- Shared schema in one Postgres instance means schema changes in `supabase/migrations/` can
  affect multiple services — coordinate migrations via PR review, not per-service ownership.
- Adds operational overhead (5 services to run locally) — mitigated by `docker-compose.yml`.

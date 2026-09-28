# Event review: ER-01/AC2, AC3 and AC4

GET `/review/requests/:id`
authenticates the existing `cs_session` cookie and uses the caller's token for
the SQL detail projection. Only an assigned, active coordinator receives the
submitted request's details, including the organiser and layout names.
Denied and nonexistent requests both return 404; missing/invalid sessions return 401.
Responses are not cached. List navigation (AC1) remains pending.

The browser route `/event-review/requests/:id` displays AC2's required fields,
with dates in Singapore time, or a denial/sign-in message. Error responses never
render request details. Missing values display "Not provided", including blank
optional text and nullable attendance/dates. A provided attendance of zero remains zero.

## Running

The database needs migrations 01–07. Migration 07 replaces the detail projection's
return type while retaining caller-scoped permissions. Apply migrations through the project's
normal migration process; tests apply them only to disposable local Postgres.
The new migrations restrict event reads and profile writes and therefore affect
other consumers of these tables. Organisers retain reads of their own events.
Broader permissions for other workflows must be added explicitly in their stories.

With the existing root environment configured, run these in separate terminals:

```sh
pnpm --filter @spm-t5/auth-service run dev
pnpm --filter @spm-t5/event-review-service run dev
pnpm --filter @spm-t5/web run dev
```

The review service listens on port 4006 and uses `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY`; it does not use a secret key. `WEB_ORIGIN` defaults
to `http://localhost:3000`. The browser's `NEXT_PUBLIC_EVENT_REVIEW_SERVICE_URL`
defaults to `http://localhost:4006`. Docker Compose also includes the service.

## Verification

```sh
pnpm vitest run -t AC4
pnpm vitest run -t AC2
pnpm vitest run -t AC3
pnpm vitest run
pnpm --filter @spm-t5/web run test:e2e
```

Database tests require Docker and create/remove their own local Postgres container.
For browser tests while an older Docker web build occupies port 3000, set
`PLAYWRIGHT_PORT=3106` in the test process environment. This starts a fresh server
without stopping the existing container. Browser tests simulate API responses;
service integration tests use real Postgres behind a simulated Supabase HTTP transport.
Live hosted Supabase is not needed for these tests.

Existing AC1 list, empty-state and retry tests remain enabled and fail until implemented.
Report the focused AC2/AC3/AC4 results separately from the full project suite.

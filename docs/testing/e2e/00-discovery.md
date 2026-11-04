# E2E discovery

Read-only findings that the E2E plan ([01-e2e-test-plan.md](01-e2e-test-plan.md)) is built on. Written on 2026-11-04
against `main` at `05b5875`. Nothing here was run; it comes from reading the repo.

## 1. How the stack runs

| Part | Fact | Where |
| ----- | ----- | ----- |
| Database | Supabase CLI stack (`supabase start`): API 54321, DB 54322. 80 migrations, newest `84_update_registration_settings.sql`. `supabase db reset` applies them and then `seed.sql`. | `supabase/config.toml`, `supabase/migrations/` |
| Seed | `supabase/seed.sql` (1,138 lines). Every account has the password `ConnectSphere2026!`. The role is `public.users.role`; login needs the chosen role to match and `is_active`. | `supabase/seed.sql` |
| Services | auth 4001, event 4002, venue 4003, equipment 4004, notification 4005. Run with `pnpm dev` (tsx watch) or from `dist/` after `pnpm run build:all` (`node --env-file=../../.env dist/index.js`). They read the root `.env`. | `services/*/package.json`, `docker-compose.yml` |
| Web | Next.js on 3000. The browser reaches services through `NEXT_PUBLIC_{AUTH,EVENT,VENUE,EQUIPMENT,NOTIFICATION}_SERVICE_URL` (default `http://localhost:4001`..`4005`). Server components use the non-public `*_SERVICE_URL` variables. | `apps/web/src/lib/api.ts` |
| CORS | Services allow only `WEB_ORIGIN` (`http://localhost:3000`), so the web must run on port 3000. | root `.env` |
| `.env` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `WEB_ORIGIN`. `pnpm env:local` / `env:hosted` switches sets. | `scripts/use-env.mjs` |

## 2. Authentication

- `/login` renders `LoginForm`: "Work email", "Password", a "Continue as" role combobox (a custom Select, not a native
  `<select>`), and a "Sign in" button.
- It posts `POST {AUTH}/auth/login` with `{ email, password, role }`. The auth-service sets the cookie `cs_session`
  (the Supabase access token; `httpOnly`, `sameSite=lax`, one hour) and returns `redirectTo: /dashboard/<role>`.
- There is no `@supabase/ssr` and no localStorage. Cookies ignore ports, so a cookie set by `:4001` is also sent to
  `localhost:3000`. That is why `users-contact-privacy.spec.ts` can log in with `fetch` and `context.addCookies`, and why a
  per-role `storageState` will work.
- `middleware.ts` calls `GET /auth/me` for guarded paths. No cookie goes to `/login` (with `?next=` only for
  `/events/:id/register`); the wrong role goes to `/access-denied`.
- Sign-in rate limit: `sign_in_sign_ups = 300` per 5 minutes in `config.toml`. Earlier sessions hit it with two full runs
  back to back, so logging in once per role in a setup project matters.

### Seeded accounts (password `ConnectSphere2026!`)

| Role | Accounts |
| ----- | ----- |
| `event_organiser` | jason.chua, weiling.ong (`@techconnect.example.com`), adrian.foo, nurul.huda, benjamin.teo, cheryl.lim, muthu.raman, isabelle.cruz |
| `event_coordinator` | rachel.tan (Lead Helen), marcus.lim (Helen), priya.nair (Samuel), daniel.goh (Samuel), siti.aminah (no Lead), kelvin.ho (inactive). All `@connectsphere.example.com` |
| `event_coordinator_lead` | helen.ong, samuel.tay |
| `venue_staff` | kenneth.wong, farah.ibrahim, joel.ng, michelle.yeo |
| `technical_support_staff` | aaron.koh, vanessa.lee, hafiz.rahman, clara.sim |
| `safety_officer` | farah.ismail, jonathan.lee |
| `attendee` | 30 accounts, alicia.fernandez through dylan.heng (`@example.com`) |

The README names one main account per role: rachel.tan, helen.ong, kenneth.wong, jason.chua, aaron.koh, farah.ismail,
alicia.fernandez.

## 3. Routes each role can open

Sidebar items come from `apps/web/src/lib/nav.ts`; hard guards from `lib/roleAccess.ts` and `middleware.ts`. Every role also
has "Home" (`/dashboard/<role>`).

| Role | Sidebar | Hard-guarded paths |
| ----- | ----- | ----- |
| organiser | `/events/new`, `/my-event-requests`, `/registrations-overview` | `/my-event-requests` |
| coordinator | `/events/review`, `/venue-bookings`, `/venues`, `/venue-calendar`, `/registrations-overview` | `/venue-calendar` (shared rule) |
| lead | `/lead/queue`, `/lead/coordinators` | `/lead/*` |
| venue staff | `/booking-queue`, `/venues`, `/venue-calendar` | `/booking-queue*` |
| technical support | `/equipment-requests`, `/equipment-inventory`, `/equipment-availability`, `/equipment-reservation`, `/venue-calendar` | the `/equipment-*` family |
| safety officer | `/safety-checks` | `/safety-checks*` |
| attendee | `/dashboard/attendee/browse`, `/registrations` | `/events/:id/register` needs a session |

Everything else has no middleware guard. The pages and the database's row-level security decide. So "direct URL" access
tests have two layers: the guarded paths redirect to `/access-denied`; the unguarded ones render but show no data or an error.

## 4. Existing tests

- **Unit and integration:** Vitest, 5,111 tests (`docs/traceability.md`, 2026-11-02). Unit coverage about 93.7% of
  statements (`docs/testing/coverage.md`).
- **Playwright:** `apps/web/playwright.config.ts`, `testDir ./tests/e2e`, one `chromium` project, `retries: 2` in CI,
  `webServer` is `next dev`. 25 spec files, about 3,300 lines, about 90 tests. All but `smoke.spec.ts` start with
  `test.skip(!process.env.E2E_FULL_STACK, ...)`.
- **No** shared fixtures, global setup, storageState or page objects. Each spec has its own `signIn`, `rest()` (service-role
  REST) and hydration wait (polling for `__reactProps$`). About 20 write screenshots to the hard-coded
  `C:\dev\SPM-T5-screenshots\SCRUM-<n>`.
- **Probably broken:** 10 specs sign in with `label.role-option`, the radio UI that SCRUM-177 (`604aa31`) replaced with the
  combobox: event-change-request, notifications, replacement-venue, venue-buffer-conflicts, venue-padding,
  venue-request-suitability, venue-suitability, venue-timing, venue-unavailability, venue-unavailability-flags.
  This comes from reading the code; none of them has been run.
- **`data-testid`:** 9 uses in 7 files (`affected-booking`, `affected-item`, `registration-scroll`,
  `needs-attention-banner`, `needs-reply-banner`, `status-icon`, `expired-hold`, `venue-booking-card`, `hold-countdown`).
  Labels are good (`<label htmlFor>`, about 146 `aria-label`s), so `getByRole` and `getByLabel` cover most screens.
  Caveats: required labels end in " *"; Select, RadioGroup and Dialog are custom components.

### Existing specs by story

smoke; sign-in (122, 177); logout (17); app-shell (121); event-change-request (66); notifications (46);
users-contact-privacy (154); equipment-catalogue (182); layout-types (181); lead-system-wide (184); registration-settings
(185 AC4); replacement-confirmed-notice (185 AC3); replacement-venue (107); suggest-alternative (40); venue-add (57);
venue-edit (58); venue-block-lifting (185 AC2); venue-block-reverts-event (185 AC1); venue-buffer-conflicts (104);
venue-padding (103); venue-suitability (109); venue-request-suitability (110); venue-timing (101);
venue-unavailability (105); venue-unavailability-flags (106).

## 5. CI

`.github/workflows/ci.yml`, workflow `CI`, on push to `main` and PRs into `main`. Jobs have no `name:`, so the status check
names are the job IDs. Branch protection requires `test`, `integration` and `e2e`
(`.github/workflows/README.md`).

- `test` (Node 20): migration number check, install, lint, typecheck, `pnpm vitest run` with coverage, build.
- `integration` (Node 22): `supabase/setup-cli@v1` 2.119.0, `supabase start`, exports `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY` to `$GITHUB_ENV`, runs the service integration tests.
- `migrate`: push to `main` only.
- `e2e` (`needs: test`, Node 20, 15 minutes): installs Chromium and runs `test:e2e`. It starts **no** database and **no**
  service, and does not set `E2E_FULL_STACK`, so only `smoke.spec.ts` runs. It uploads `playwright-report` only, not
  `test-results/`.

## 6. Time control

- **Hold expiry is not built.** No `hold_expires_at` column, sweeper, pg_cron job or timer. `apps/web/src/lib/holds.ts`
  (`holdCountdown`) and `VenueBookingCard` show a countdown only if a booking carries `holdExpiresAt`, and no service
  supplies it. The calendar shows pending requests as "Tentatively Held".
  `docs/specs/venue-booking-request.md` lines 104-106 treat a Pending request as the hold, with no expiry. That follows
  the Week 4 answer that auto-expiry is not required, but it is **not** recorded in `docs/scope-decisions.md`.
- Other time rules (registration window, future-only booking flags) are evaluated with Postgres `now()` when read.
  Seed and spec data use far-future dates (2030/2031).
- No `NODE_ENV=test` branches and no clock hooks exist. `page.clock` would only affect browser `new Date()`, not server
  components or Postgres.

## 7. Traceability tooling

`scripts/traceability/generate.mjs` + `lib.mjs`. It reads Vitest JSON only (no Playwright) and refuses to write when any
test is not "passed", skipped tests included. `refsOf` matches `SCRUM-<n>[/AC<n>[,AC<n>]]` and `<n>-S<n>`. A scenario ID
is mapped to ACs through the spec's table. A title such as `AC5/AC1: ...` without `SCRUM-` earns no AC credit.
`docs/traceability.md` was generated 2026-11-02 and has nothing for SCRUM-182 to 185.

## 8. Stories mapped to the 20 core features

| # | Feature | Stories | Spec | UI |
| ----- | ----- | ----- | ----- | ----- |
| 1 | Auth | 12, 13, 14, 17, 122, 15 (RLS 91, 153-156, 183) | **none for login, register, reset, logout** | `/login`, `/register`, `/forgot-password`, `/reset-password` |
| 2 | Event request creation | 49, 52 | yes | `/events/new`, `/my-event-requests` |
| 3 | Drafts | 53, 54, UI 124 | 53/54 backend only; **124 none** | form + organiser home |
| 4 | Review and approval | 24, 44, 45 | **none** | `/events/review`, event page |
| 5 | Coordinator assignment | 75-81, 184 | yes | `/lead/*` |
| 6 | Status machine | 6, 7, 8 | **none** (guards out of scope) | event page |
| 7 | Info management | 111, 112, 113 | yes | `/events/[id]/edit` |
| 8 | Venue catalogue | 29, 57, 58, 181, 101 | **none for 29** | `/venues*` |
| 9 | Availability calendar | 84, UI 130 | API only | `/venue-calendar` |
| 10 | Venue search | 65 | yes | `/venues` filters |
| 11 | Suitability | 109, 110 | yes | booking form |
| 12 | Booking requests | 32, 33, 35, 59, 60, 98, 102 | yes | `/events/[id]/venue-request`, `/venue-bookings` |
| 13 | Booking approval | 37, 38, 39, 40 | yes | `/booking-queue*` |
| 14 | Conflict detection | 36, 103, 104 | 36 inside the request spec | refusals and flags |
| 15 | Equipment request | 86, 87, 88 | yes | event page equipment tab, `/equipment-requests` |
| 16 | Equipment availability | 18, 137 | yes (18) | `/equipment-availability` |
| 17 | Equipment reservation | 19, 138 | yes (19) | `/equipment-reservation` |
| 18 | Attendee registration | 71-74, 83, 169, 170 | **none** (185 AC4 only) | `/events/[id]/register`, `/registrations` |
| 19 | Change requests | 66, 67, 176 | yes | event page, `/change-requests/[id]` |
| 20 | Notifications | 46, 47, 172, 20 | yes | bell, `/notifications`; **no email** |

## 9. Week 7 customer changes

| Change | Stories / specs | State |
| ----- | ----- | ----- |
| C1 setup and turnaround | 101, 103, 104 | built, specs |
| C2 venue unavailable | 105, 106, 107, 185 AC1-AC4 | built, specs |
| C3 several bookings per event | 98, 102 (and parts of 110, 112) | built, specs |
| C4 hold expiry | none | **not built, no spec**; no UI to create a hold |
| C5 Lead role | 75, 77, 78, 79, 81, 184, 156, 183 | built, specs |
| C6 Safety Officer | 99, 100, 171; 116 (sign-in) | built; 116 has no spec |

### Status flow and the safety check

`EVENT_STATUSES` (`packages/shared/src/eventStatus.ts`): draft, submitted, under_review, returned, approved, planning,
awaiting_arrangements, confirmed, completed, cancelled, rejected. **There is no "Preparation" status.**
`operational-safety-check.md` says Preparation is `confirmed`.

- An event waits in `awaiting_arrangements` until every active venue booking is approved and every equipment request is
  arranged. The last approval moves a `planning` event there by itself (171), and it then shows in `/safety-checks`.
- Approve records "Safety Approved" (a decision, not a status). Trigger `events_safety_gate` (SC001, HTTP 409) blocks
  `confirmed` until the latest decision is Approve.
- Reject or Request changes returns the event to `planning`. An important change revokes the approval. A venue block sends a
  Confirmed event back to `planning` (185 AC1).

## 10. Features with no UI, and UI with no matching AC

- **No UI:** creating or confirming a tentative hold; email and SMS notifications; a dedicated conflict view (conflicts show
  as refusals and flags).
- **UI without a spec or AC set:** the login/register/reset/logout screens, drafts UI (124), the coordinator review actions
  (24/44/45), the status stepper (6/7/8), the venue catalogue (29), attendee registration (71-74, 83, 169, 170).
  These have Jira stories but their ACs are not written down in `docs/specs/`.

## 11. Manual test-case template

None found. No `.xlsx`, `.csv`, `.docx` or `.pdf` anywhere in the repo; `scope-decisions.md` mentions customer Q&A
spreadsheets and `Project Brief.pdf` that are not committed. The plan uses the fallback columns: Test ID, Story/AC refs,
Scenario, Preconditions, Steps, Test data, Expected results (plus Automated spec).

## 12. Open questions

1. **Course template.** If the course template turns up, `02-test-cases` gets re-mapped to its columns. Path or column list?
2. **"Number of manual E2E cases".** The submission asks for it. Are manual cases separate from the automated catalogue, or
   is the catalogue itself the manual script too? The plan treats every catalogue row as a manual case (the template columns
   are filled in) and reports the automated count next to it. Tell me if the course wants a different split.
3. **C4.** Raise "hold expiry not built" with the team. It is logged as defect D-001 and is not in `scope-decisions.md`.
4. **Specs missing for features 1, 4, 6, 8, 18.** E2E for them will cite the Jira story and what the UI does, because there
   are no written ACs. If you can give me the Jira ACs I will cite those instead.
5. **Windows `webServer`.** An earlier session found Playwright's `webServer` command fails on Windows. The plan uses
   `pnpm exec`; if that still fails, the README documents starting the stack by hand.
6. **Stale `docs/traceability.md`.** Not regenerated on purpose (the full local run runs out of memory). E2E docs do not
   depend on it.

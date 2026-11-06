# End-to-end tests (SCRUM-191)

Browser tests of the whole stack: the web app, the five services and a local Supabase database, signed in as each of the seven
roles. The plan and the reasons are in [01-e2e-test-plan.md](01-e2e-test-plan.md); what the last run found is in
[metrics.md](metrics.md).

| File | What it is | Written by |
| ----- | ----- | ----- |
| `apps/web/tests/e2e/catalogue.ts` | The one list of cases: ID, priority, type, the stories and ACs each checks | By hand |
| `apps/web/tests/e2e/specs/<area>/E2E-<AREA>-nn-<slug>.spec.ts` | One spec per case | By hand |
| `apps/web/tests/e2e/manual/` | The manual script of every case (preconditions, steps, test data, expected results) and the shared set-ups | By hand |
| `02-test-cases.md` / `.csv` | Every case as a script a person can follow in the browser, with the accounts and set-ups | `pnpm run e2e:docs` |
| `03-traceability-matrix.md` / `.csv` | Story, AC, E2E cases, spec file, last result; ACs with no case are listed | `pnpm run e2e:docs` |
| `04-execution-log.md` | One row per case per run; manual rows are left blank for the person who ran them | `pnpm run e2e:docs` appends |
| `05-review-log.md` | Who reviewed each test and what they checked | By hand; the generator only adds rows for new cases |
| `defects.md` | Problems the tests found in the product | By hand |
| `metrics.md` | Totals, counts, coverage, open defects | `pnpm run e2e:metrics` |

## Run it locally

You need Docker Desktop, the Supabase CLI and a root `.env` (see the README, Getting started).

1. `pnpm install`, then once `pnpm --filter @spm-t5/web exec playwright install chromium`.
2. `supabase start`, then `supabase migration list --local` to check every migration is applied. A missing one fails tests in
   confusing ways.
3. Free port 3000 (the web app must be there: it is the one origin the services allow). Your own dev servers on 4001 to 4005 can
   keep running: the tests start their own services on **4101 to 4105**.
4. `pnpm run test:e2e`. Playwright starts the services and `next dev` itself. A full run takes about 15 minutes.

Useful variations (all from the repo root):

| Want | Command |
| ----- | ----- |
| One case | `pnpm run test:e2e E2E-CONF-02` |
| One priority | `pnpm run test:e2e --grep @P0` |
| One week 7 change | `pnpm run test:e2e --grep @C2` |
| Watch it in a browser | `pnpm run test:e2e --headed` |
| Step through it | `pnpm run test:e2e --debug E2E-AUTH-02` |
| Playwright's UI mode | `pnpm run test:e2e:ui` |
| Fewer parallel workers | `E2E_WORKERS=1 pnpm run test:e2e` |
| Reuse a web server you started on port 3000 | `E2E_REUSE_WEB=1` (start it with the E2E service ports 4101 to 4105) |
| Run as CI does (steadier and about three times faster) | `pnpm run e2e:build` once, then `E2E_BUILT=1 pnpm run test:e2e` |

**Built mode.** By default the web app is `next dev`, which compiles each page when it is first opened. With several parallel workers it
can stall for a minute or more, and a test then fails on a timeout (a full dev-mode run failed 6 tests this way that had passed in the
run before). `pnpm run e2e:build` builds the services and the web app with the E2E service ports baked in (it replaces `apps/web/.next`,
so stop your own `next dev` first); `E2E_BUILT=1` then runs them the way CI does: the bundled services, `next start`, tighter timeouts
and one retry, so a test that needed a retry is reported as flaky. A full run takes about 7 minutes.

Every test creates the rows it needs (named `E2E-<ID> ...`) and removes them afterwards, and asserts only on those rows, so the
database does not have to be fresh. For an official run start from `supabase db reset`, which wipes your local data, so do it on
purpose. Sign-in is rate limited (300 per 5 minutes locally): do not start two full runs inside five minutes.

## How the suite is built

```
apps/web/playwright.config.ts   starts the 5 services and the web app; projects: setup, then chromium
apps/web/tests/e2e/
  catalogue.ts                  every case (the source for the generated docs)
  setup/auth.setup.ts           signs each persona in once through auth-service and saves the session (.auth/, git-ignored)
  fixtures/
    accounts.ts                 personas: a named seeded account per role, plus homePath(role)
    env.ts                      ports (4101-4105 locally, 4001-4005 in CI), seeded password, Supabase URL
    test.ts                     the `as(persona)` and `data` fixtures every spec imports instead of Playwright's test
    data.ts                     TestData: creates venues, events, bookings, equipment with the service-role key, deletes them after
    scenarios.ts                shared set-ups, such as a venue held by another event
    tc.ts                       title and annotations of a case, read from the catalogue
    api.ts, hydration.ts        a service call as the signed-in person; waits so a click is not lost before React attaches
  pages/                        page objects: one class per screen or flow, hold locators and the steps to drive them
  specs/<area>/                 one file per case
```

- **Sign-in.** `setup` logs the 14 personas in once; `as("coordinator")` opens a page in a new browser context carrying that
  session. A case that spans people calls `as` once per person. Only AUTH-01 to AUTH-04 and AUTH-06 use the real sign-in form.
- **Data.** The `data` fixture creates rows with the service-role key (which bypasses row-level security, so it can arrange an event
  already Confirmed) and removes them after the test, newest first. The action under test always goes through the screen.
  `data.rest(...)` reads the database to prove what a screen cannot, such as "nothing was created".
- **Ports and origin.** The web app must be on port 3000: it is the only origin the services allow. The services get 4101-4105
  locally so your own dev servers are left alone; CI uses 4001-4005, where the production build already points.
- **Local versus CI.** By default the services run from source (`tsx`) and the web app is `next dev`, with 3 workers and long timeouts
  because `next dev` compiles a page on its first visit. In CI, and locally with `E2E_BUILT=1`, they are the bundles from
  `pnpm run build:all` and `next start`, with one retry, so a flaky test is reported as flaky (CI uses 2 workers).
- **Dates.** Cases book far-future days (2031) so nothing depends on today's date, with two exceptions that need the real clock:
  registration windows (set relative to now) and E2E-VEN-06 (the calendar only opens on today and steps a day at a time).
- **Defects.** A test whose assertion the product breaks stays as the AC states it, is marked `test.fail()`, and has a row in
  `defects.md`. Today that is E2E-ACL-05 (D-002). The tentative hold expiry change (C4, D-001) has no test because nothing is built.

## See why a test failed

- `pnpm --filter @spm-t5/web exec playwright show-report` opens the HTML report (`apps/web/playwright-report`).
- A failed test keeps a trace, a screenshot and a video under `apps/web/test-results/<test>/`. Open the trace with
  `pnpm --filter @spm-t5/web exec playwright show-trace apps/web/test-results/<test>/trace.zip`: it shows every action, the page
  before and after, and the network calls.
- In CI the same files are the `playwright-report` artifact of the run, kept for 14 days, and the run's summary page shows the metrics.

## Regenerate the documents

After a run, `apps/web/test-results/results.json` holds the results.

```bash
pnpm run e2e:docs      # 02, 03, 04, new rows of 05, and metrics.md
pnpm run e2e:metrics   # metrics.md only (also printed; CI appends it to the job summary)
pnpm run test:scripts  # the generator's own tests
```

The generator never fills a reviewer, a date or a human check, and never marks a manual case as run. `04` gets one automated row
per test per run (a run ID already in the file is not added twice) and one blank manual row per case. The numbers in `metrics.md`
come from the run and the catalogue, not from typing. Defects are counted from the **Open** rows of `defects.md`.

The generator stops, and writes nothing, if a catalogue case has no script in `apps/web/tests/e2e/manual`, a script has no
preconditions, data, steps or expected results, or one names a set-up that does not exist. No course template for manual test cases
was found, so `02` uses the plan's fallback fields.

A manual script is what a person does and sees; the automated test also reads the database. Where the test arranges a state with
the service-role key, the script names a **set-up** (S0 to S9, printed at the top of `02`) that reaches the same state through the
screens, and says so when a state cannot be made by hand (E2E-ACL-04's registrant with no form details).

## Add or change a case

1. Add a row to `catalogue.ts` and, with the same ID, its manual script to a file in `apps/web/tests/e2e/manual/` (the set-ups it
   needs, preconditions, test data, steps and expected results). Refs in the catalogue are written as the specs write them: `103-S1` (a spec scenario), `SCRUM-99/AC7` (an AC) or
   `SCRUM-65` (a whole story, only where there is no spec); a trailing `?` means the AC is still to be confirmed against Jira.
2. Add `specs/<area>/E2E-<AREA>-nn-<slug>.spec.ts` that starts with `const t = tc("E2E-...")` and uses `t.title` and `t.annotation`.
   The title carries the ID, the story tags and the priority, so `--grep` works.
3. Arrange data with the `data` fixture and open pages with `as("<persona>")` (one browser context per person). Use the UI for the
   action under test; use the database only to arrange and to prove what the screen cannot (that a row was not created).
4. If the product contradicts an acceptance criterion, keep the assertion the AC asks for, mark the test `test.fail()` and add a row
   to `defects.md`. A defect is never fixed by weakening the test.
5. Run `pnpm run e2e:docs`.

A test is human-reviewed only when a named person fills **Reviewer** and **Date** in `05-review-log.md`.

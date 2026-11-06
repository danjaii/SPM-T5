# End-to-end tests (SCRUM-191)

Browser tests of the whole stack: the web app, the five services and a local Supabase database, signed in as each of the seven
roles. The plan and the reasons are in [01-e2e-test-plan.md](01-e2e-test-plan.md); what the last run found is in
[metrics.md](metrics.md).

| File | What it is | Written by |
| ----- | ----- | ----- |
| `apps/web/tests/e2e/catalogue.ts` | The one list of cases: ID, priority, type, the stories and ACs each checks | By hand |
| `apps/web/tests/e2e/specs/<area>/E2E-<AREA>-nn-<slug>.spec.ts` | One spec per case | By hand |
| `02-test-cases.md` / `.csv` | Every case as a manual script (steps come from the spec's `test.step` names) | `pnpm run e2e:docs` |
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

Every test creates the rows it needs (named `E2E-<ID> ...`) and removes them afterwards, and asserts only on those rows, so the
database does not have to be fresh. For an official run start from `supabase db reset`, which wipes your local data, so do it on
purpose. Sign-in is rate limited (300 per 5 minutes locally): do not start two full runs inside five minutes.

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

Limits worth knowing: no course template for manual test cases was found, so `02` uses a fallback set of columns; the expected
result of a manual script is the catalogue's scenario sentence, and the assertions are in the spec.

## Add or change a case

1. Add a row to `catalogue.ts`. Refs are written as the specs write them: `103-S1` (a spec scenario), `SCRUM-99/AC7` (an AC) or
   `SCRUM-65` (a whole story, only where there is no spec); a trailing `?` means the AC is still to be confirmed against Jira.
2. Add `specs/<area>/E2E-<AREA>-nn-<slug>.spec.ts` that starts with `const t = tc("E2E-...")` and uses `t.title` and `t.annotation`.
   The title carries the ID, the story tags and the priority, so `--grep` works.
3. Arrange data with the `data` fixture and open pages with `as("<persona>")` (one browser context per person). Use the UI for the
   action under test; use the database only to arrange and to prove what the screen cannot (that a row was not created).
4. If the product contradicts an acceptance criterion, keep the assertion the AC asks for, mark the test `test.fail()` and add a row
   to `defects.md`. A defect is never fixed by weakening the test.
5. Run `pnpm run e2e:docs`.

A test is human-reviewed only when a named person fills **Reviewer** and **Date** in `05-review-log.md`.

# Mutation testing: what we tested and what it found

Coverage tells us a line ran during a test. It does not tell us a test would fail if that line were wrong. Mutation
testing checks that second part, so we ran it on our shared business rules to find edge cases we had missed (SCRUM-187).

**Result: our tests detect 3,555 of 3,647 small deliberate changes, and 92 are undetected.** Every undetected change has a
reason [below](#the-92-undetected-changes). The work added 118 test cases and found one real bug, since fixed in SCRUM-190.
These figures were measured before that fix. They show how well the tests notice changes to these rules. It does not prove the rules are free of bugs.

## How it works

The tool, [Stryker](https://stryker-mutator.io/), makes one small change to the code at a time and runs the tests that
reach it.

- If a test fails, the change was **detected**, which is what we want.
- If every test still passes, the change was **undetected**, which means no test would notice that mistake.

A real example from [eventImpact.ts](../../packages/shared/src/eventImpact.ts), which warns a coordinator when an event
change affects a venue booking:

```ts
return Date.parse(start) < Date.parse(newStart) || Date.parse(end) > Date.parse(newEnd);
```

Stryker replaced `Date.parse(end) > Date.parse(newEnd)` with `false`, and every test still passed. So if that check had
ever broken, a booking running past the event's new end time would have got no warning, and nothing would have told us.
We now have a test for it, and that change is detected.

An undetected change is not always a problem. If another check gives the same answer anyway, nothing goes wrong for a
user. That is why each one needs judging, and why the score is not expected to reach 100%.

## What was tested

| | |
| :-- | :-- |
| **Code changed by Stryker** | 30 files in `packages/shared/src`, the rules that both the web app and the services use |
| **Tests used to detect the changes** | The unit tests of `packages/shared` and the five services |

## What was not tested

- **Web pages and service routes.** Stryker did not change this code, so these results say nothing about it.
- **Database rules** (RLS policies, triggers and functions). Stryker cannot change SQL. The integration tests cover these.
- **`index.ts` and `supabaseClient.ts`** in `packages/shared`. They hold no business rules.

Two kinds of test were not used to detect changes:

- **Web page tests.** They went past Stryker's 5-minute limit for its first pass.
- **Integration tests.** They need a database.

## The bug it led to

**Four rules accepted a date that does not exist.** Change requests, event edits, venue bookings and technical assignments
all accepted 31 February 2031 and saved 3 March 2031 with no warning, because JavaScript rolls the extra days into the next
month. The date pickers on the change request and booking forms should stop people choosing such a date, but someone
calling the API directly could still send one. A month such as 13 also crashed the technical assignment check.

The report pointed to this by showing that the "Enter a valid date" check on change requests was never reached. Trying
the date by hand showed why. Fixing it changed what the app accepts, so the fix had its own ticket, SCRUM-190. All four
rules now refuse these dates with a message on the date.

## The results, run by run

| Run | What changed before it | Detected | Undetected |
| :-- | :-- | --: | --: |
| 1 | Only the tests in `packages/shared` (769 tests) | 3,115 of 3,640 | 525 |
| 2 | Added the services' unit tests | 3,362 of 3,640 | 278 |
| 3 | Added the first 26 test cases | 3,394 of 3,642 | 248 |
| 4 | Added 87 test cases | 3,550 of 3,647 | 97 |
| 5 | Added the last 5 test cases | 3,555 of 3,647 | 92 |

Run 5 re-ran only the 4 files those last tests cover, so the figure combines it with run 4 for the other 26 files. The
report's screenshot from the full run 4 shows 3,550. The totals differ slightly because Stryker counted two changes as
invalid in the first two runs, and the rules themselves gained a little code from `main` between runs.

Run 1 looked worse than it was. `registration.ts` scored 17.2% because the event service tests its form rules, and that
file reached 96.6% in run 2.

## The gaps we closed

Every new test name cites the story it belongs to. All 118 passed without changing any rule.

| Kind of case that had no test | Example | Stories |
| :-- | :-- | :-- |
| Limits at the exact value | Attendance exactly equal to capacity, text exactly at its limit, a quantity of 10 | SCRUM-18, 20, 32, 46, 57, 65, 66, 67, 98, 111, 112, 182, 185 |
| The edges of an event's new time | A booking that runs past a new, earlier end time | SCRUM-112 |
| Times compared with now | An event edited to an earlier time today, or a start of exactly now | SCRUM-18, 32, 49, 66, 111 |
| Input that is missing, empty or the wrong type | A booking whose requirements are a number, which could have crashed if the check broke | SCRUM-40, 49, 53, 66, 98, 102, 111, 113, 181, 182, 185 |
| Partial information | A venue with an opening time but no closing time, or an event with no end time | SCRUM-66, 109 |
| Values that are close but wrong | A file type of `video/mp4x` or `imagery/png` | SCRUM-28 |
| Whether a value really changed | Stored text compared with the request, and an attendance that stays the same | SCRUM-66, 67, 112 |
| Rules with nothing else to catch them | Registration details being cleared when registration is off | SCRUM-49 |
| Message wording | Each error message on the draft, venue and equipment forms | SCRUM-53, 57, 109, 170, 182 |

## The 92 undetected changes

We went through all of them by reading the code, and did not write a test to prove each one harmless. So these reasons
are our judgement, not proof. `:` gives the line in that file, and `×` how many changes are on that line if more than one.

| Reason | Count | Where |
| :-- | --: | :-- |
| **A type check next to a rule that refuses the value anyway.** For example, `typeof x === "string"` beside a list that only holds text | 31 | `eventChangeRequest:119 ×2`, `eventChangeRequest:222`, `eventRequest:56`, `venueBooking:183`, `venueBookingFlags:19`, `venueUnavailability:33`, `venueUnavailability:37`, `equipmentCatalogue:31`, `equipmentCatalogue:69`, `eventDetails:214 ×2`, `eventDraft:79`, `eventDraft:85`, `eventDraft:97 ×4`, `eventStatus:19`, `layoutType:21`, `notifications:122 ×3`, `registration:38`, `registrationSettings:24 ×4`, `registrationSettings:54`, `roles:15`, `venueSuitability:200` |
| **Roll-over checks that overlap.** 31 February becomes 3 March, so the day and month both change, and removing one check changes nothing. Impossible dates are tested in these rules | 15 | `equipmentAvailability:17 ×6`, `venueSearch:13 ×6`, `registrationSettings:31 ×3` |
| **A second check that repeats the first.** The first check has already given the same result | 13 | `eventRequest:109`, `eventRequest:116`, `eventRequest:119`, `equipmentCatalogue:93`, `venueCatalogue:99`, `venueCatalogue:140`, `venueCatalogue:182`, `venueBooking:204`, `coordinatorClash:37`, `eventDetails:235`, `venueSearch:48 ×2`, `changeRequestReview:61` |
| **A looser number or date pattern.** The value is still refused when it is converted, or the change only matters with spaces before a date, which no form sends | 9 | `eventChangeRequest:119 ×2`, `eventDetails:214 ×2`, `notifications:122 ×2`, `registrationSettings:28 ×2`, `registrationSettings:53` |
| **"Not a real date" checks that could not run.** JavaScript rolled the date over instead of failing. This was the [bug above](#the-bug-it-led-to). SCRUM-190 replaced these checks, so a new run will count them differently | 6 | `eventChangeRequest:160 ×2`, `eventChangeRequest:161 ×2`, `venueBooking:230 ×2` |
| **A value left out or set to undefined.** The result looks the same to the code that reads it | 5 | `venueBooking:235`, `venueBooking:236`, `venueBooking:341`, `venueUnavailability:212`, `venueUnavailability:214` |
| **The default for a value that is not text.** The value is refused either way | 5 | `venueBooking:189`, `venueUnavailability:189`, `equipmentCatalogue:57`, `venueCatalogue:57`, `venueTiming:25` |
| **A fallback that cannot run.** The input never reaches it | 4 | `eventChangeRequest:241`, `venueBooking:323`, `venueBookingFlags:78`, `venueUnavailability:173` |
| **`eventRequestSchema`.** It says it is for `apps/web` to reuse, but only one test uses it, and the app never runs its date checks. The route uses `parseEventRequest`, which has its own tests | 4 | `eventRequest:85`, `eventRequest:86`, `eventRequest:87 ×2` |

## Results by file

| File | Detected | Undetected | Score |
| :-- | --: | --: | --: |
| `attachments.ts` | 31 | 0 | 100.0% |
| `equipmentRequest.ts` | 130 | 0 | 100.0% |
| `eventImpact.ts` | 110 | 0 | 100.0% |
| `profile.ts` | 44 | 0 | 100.0% |
| `safetyCheck.ts` | 48 | 0 | 100.0% |
| `sentBack.ts` | 43 | 0 | 100.0% |
| `technicalAssignment.ts` | 91 | 0 | 100.0% |
| `venueCalendar.ts` | 88 | 0 | 100.0% |
| `venueOccupancy.ts` | 27 | 0 | 100.0% |
| `venueSuitability.ts` | 192 | 1 | 99.5% |
| `changeRequestReview.ts` | 107 | 1 | 99.1% |
| `layoutType.ts` | 70 | 1 | 98.6% |
| `roles.ts` | 63 | 1 | 98.4% |
| `venueCatalogue.ts` | 247 | 4 | 98.4% |
| `registration.ts` | 57 | 1 | 98.3% |
| `eventDetails.ts` | 265 | 5 | 98.1% |
| `venueTiming.ts` | 47 | 1 | 97.9% |
| `venueUnavailability.ts` | 248 | 6 | 97.6% |
| `venueBooking.ts` | 308 | 9 | 97.2% |
| `eventChangeRequest.ts` | 303 | 10 | 96.8% |
| `equipmentCatalogue.ts` | 118 | 4 | 96.7% |
| `venueBookingFlags.ts` | 57 | 2 | 96.6% |
| `equipmentAvailability.ts` | 167 | 6 | 96.5% |
| `coordinatorClash.ts` | 26 | 1 | 96.3% |
| `venueSearch.ts` | 193 | 8 | 96.0% |
| `eventDraft.ts` | 131 | 6 | 95.6% |
| `eventRequest.ts` | 132 | 8 | 94.3% |
| `registrationSettings.ts` | 157 | 11 | 93.5% |
| `eventStatus.ts` | 13 | 1 | 92.9% |
| `notifications.ts` | 42 | 5 | 89.4% |

## How to run it again

```bash
pnpm install
pnpm run test:mutation
```

It needs no database and changes none of your files, because Stryker works on a temporary copy. Allow up to an hour and
keep the laptop plugged in. Its early time estimate can be far too high, and it comes down as the run goes on.

When it finishes, open `reports/mutation/shared.html` in a browser to see every change it made. Git ignores that folder.

It is run by hand and is not part of CI, because it would slow every pull request. No score fails it, for the same
reason CI has no coverage threshold (SCRUM-173). The settings are in `stryker.config.mjs` and `vitest.stryker.config.mts`.

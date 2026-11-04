# Mutation testing: what we tested and what it found

Coverage tells us a line ran during a test. It does not tell us a test would fail if that line were wrong. Mutation
testing checks that second part, so we ran it once on our shared business rules to find edge cases we had missed
(SCRUM-187).

**Result: 93.19%.** The tests caught 3,394 of 3,642 small deliberate changes. The run led to 26 new test cases. It found
no bugs: all 26 passed the first time, so the code was already right and only the tests were missing.

## How it works

The tool, [Stryker](https://stryker-mutator.io/), makes one small change to the code at a time and runs the tests that
reach it.

- If a test fails, the change was **caught**, which is what we want.
- If every test still passes, the change **survived**, which means no test would notice that mistake.

A real example from [eventImpact.ts](../../packages/shared/src/eventImpact.ts), which warns a coordinator when an event
change affects a venue booking:

```ts
return Date.parse(start) < Date.parse(newStart) || Date.parse(end) > Date.parse(newEnd);
```

Stryker replaced `Date.parse(end) > Date.parse(newEnd)` with `false`, and every test still passed. So if that check had
ever broken, a booking running past the event's new end time would have got no warning, and nothing would have told us.
We now have a test for it, and that change is caught.

A surviving change is not always a problem. If it only rewords an error message, or another check gives the same answer
anyway, nothing goes wrong for a user. That is why each survivor needs a person to judge it, and why the score is not
expected to reach 100%.

## What was tested

| | |
| :-- | :-- |
| **Code changed by Stryker** | 30 files in `packages/shared/src`, the rules that both the web app and the services use |
| **Tests used to catch the changes** | The unit tests of `packages/shared` and the five services |

## What was not tested

- **Web pages and service routes.** Stryker did not change this code, so this score says nothing about it.
- **Database rules** (RLS policies, triggers and functions). Stryker cannot change SQL. The integration tests cover these.
- **`index.ts` and `supabaseClient.ts`** in `packages/shared`. They hold no business rules.

Two kinds of test were not used to catch changes:

- **Web page tests.** They went past Stryker's 5-minute limit for its first pass.
- **Integration tests.** They need a database.

A rule tested only in one of those places shows as survived here, so the real figure may be a little higher.

## The score, run by run

| Run | Tests used | Caught | Score |
| :-- | :-- | --: | --: |
| 1 | `packages/shared` only (769 tests) | 3,115 of 3,640 | 85.58% |
| 2 | Added the services' unit tests (2,667 tests) | 3,362 of 3,640 | 92.36% |
| 3 | Added the 26 new test cases | 3,394 of 3,642 | 93.19% |

Run 1 looked worse than it was. `registration.ts` scored 17.2% because the event service tests its form rules, and that
file reached 96.6% in run 2. Stryker also counted two changes as invalid in runs 1 and 2 but not in run 3, which is why
the total changes.

## The gaps we found

These are the cases that had no test. Every new test name cites the story it belongs to.

| Case that had no test | What could have broken unnoticed | Story |
| :-- | :-- | :-- |
| A venue booking runs past the event's new, earlier end time | The coordinator gets no warning | SCRUM-112/AC3 |
| A booking starts or ends exactly at the event's new start or end | A booking that fits gets a warning | SCRUM-112/AC3 |
| Attendance exactly equals the venue's capacity | The warning says a venue that fits may be unsuitable | SCRUM-112/AC2 |
| An equipment quantity of two or more digits, such as 10 | Valid quantities are refused | SCRUM-18/AC1 |
| Equipment end time equal to its start time, or a start of exactly now | A period with no length is accepted, or a valid one refused | SCRUM-18/AC7 |
| An event edited to an earlier time today, or to exactly now | A past start is accepted, or a valid one refused | SCRUM-111/AC3 |
| An attendance of 1, or typed as digits, on the event edit form | Valid attendance is refused | SCRUM-111/AC3 |
| An attendance of 1 on a booking or a venue search | Valid attendance is refused | SCRUM-98/AC2, SCRUM-65/AC3 |
| A booking that starts exactly now | A valid booking is refused | SCRUM-32 (32-S5) |
| A registration capacity of 1, or a notification limit of 1 | A valid value is refused or replaced | SCRUM-185/AC4, SCRUM-46/AC1 |
| A venue capacity of 1 or of exactly 100,000 | A valid capacity is refused | SCRUM-57/AC2 |
| Text exactly at its length limit: venue name and location | Valid text is refused | SCRUM-57/AC2 |
| Text exactly at its length limit: change request requirements, rejection reason | Valid text is refused | SCRUM-66/AC8, SCRUM-67/AC4 |
| Text exactly at its length limit: assignment note, cancellation reason | Valid text is refused | SCRUM-20/AC1, SCRUM-20/AC3 |
| Text exactly at its length limit: equipment type, description and location | Valid text is refused | SCRUM-182/AC1 |

## The 248 survivors that remain

We sorted these by reason from the report, and read the code behind the ones we thought could matter. We did not write a
test to prove each one harmless, so read these groups as our judgement, not as proof.

| Reason | Count | Why we left it |
| :-- | --: | :-- |
| Checks that guard against unusual input | 107 | Another check usually gives the same answer, such as `typeof x === "string"` next to a pattern that only matches text |
| Wording of a message or label | 67 | A person would notice the text. Some of these are field names, which could put a message beside the wrong field |
| Worth a later look | 25 | See the list below |
| Empty-text defaults | 18 | Changing `""` usually gives the same result, because the value is checked afterwards |
| Date roll-over checks | 16 | 31 February becomes 3 March, so the day and the month both change. Removing one check changes nothing, and impossible dates are already tested |
| Removing spaces (`trim`) | 15 | Mostly a space-only value that another check handles. A few could matter in a form |

### Worth a later look

These could be real gaps. We did not add tests for them in this story:

- **`eventRequestSchema`** in `eventRequest.ts` (lines 85-87) says it is for `apps/web` to reuse, but only a test uses it,
  and its date checks have no test. The route uses `parseEventRequest`. It may be leftover code, so the team should decide
  whether to use it or remove it.
- **Exactly now:** `eventChangeRequest.ts:172` and `eventRequest.ts:68`.
- **Dates that cannot be read:** `eventChangeRequest.ts:160-161`.
- **An event with registration turned off:** `eventRequest.ts:125`.
- **Venues with only part of their opening hours:** `venueSuitability.ts:86`, `venueSuitability.ts:127-128`,
  `venueSuitability.ts:147` and `venueCatalogue.ts:99`.
- **Attachment file types:** `attachments.ts:29`.
- **Smaller checks:** `eventImpact.ts:62`, `eventImpact.ts:107`, `venueBookingFlags.ts:78`, `venueOccupancy.ts:49` and
  `venueSearch.ts:48`.

## Scores by file (run 3)

| File | Caught | Survived or not reached | Score |
| :-- | --: | --: | --: |
| `equipmentRequest.ts` | 130 | 0 | 100.0% |
| `profile.ts` | 44 | 0 | 100.0% |
| `safetyCheck.ts` | 48 | 0 | 100.0% |
| `technicalAssignment.ts` | 91 | 0 | 100.0% |
| `venueCalendar.ts` | 88 | 0 | 100.0% |
| `roles.ts` | 58 | 1 | 98.3% |
| `eventImpact.ts` | 108 | 2 | 98.2% |
| `venueTiming.ts` | 47 | 1 | 97.9% |
| `layoutType.ts` | 69 | 2 | 97.2% |
| `registration.ts` | 56 | 2 | 96.6% |
| `venueBookingFlags.ts` | 57 | 2 | 96.6% |
| `venueUnavailability.ts` | 245 | 9 | 96.5% |
| `coordinatorClash.ts` | 26 | 1 | 96.3% |
| `venueOccupancy.ts` | 26 | 1 | 96.3% |
| `venueCatalogue.ts` | 238 | 13 | 94.8% |
| `venueSearch.ts` | 190 | 11 | 94.5% |
| `changeRequestReview.ts` | 102 | 6 | 94.4% |
| `venueBooking.ts` | 297 | 20 | 93.7% |
| `eventStatus.ts` | 13 | 1 | 92.9% |
| `equipmentAvailability.ts` | 160 | 13 | 92.5% |
| `equipmentCatalogue.ts` | 112 | 10 | 91.8% |
| `venueSuitability.ts` | 177 | 16 | 91.7% |
| `attachments.ts` | 28 | 3 | 90.3% |
| `notifications.ts` | 42 | 5 | 89.4% |
| `eventDraft.ts` | 122 | 15 | 89.1% |
| `eventDetails.ts` | 240 | 30 | 88.9% |
| `registrationSettings.ts` | 149 | 19 | 88.7% |
| `sentBack.ts` | 38 | 5 | 88.4% |
| `eventChangeRequest.ts` | 274 | 39 | 87.5% |
| `eventRequest.ts` | 119 | 21 | 85.0% |

## How to run it again

```bash
pnpm install
pnpm run test:mutation
```

It took about 25 minutes on a laptop, needs no database and changes none of your files, because Stryker works on a
temporary copy. Keep the laptop plugged in. Its early time estimate can be far too high, and it comes down as the run goes on.

When it finishes, open `reports/mutation/shared.html` in a browser to see every change it made. Git ignores that folder.

It is run by hand and is not part of CI, because it would add about 25 minutes to every pull request. No score fails it,
for the same reason CI has no coverage threshold (SCRUM-173). The settings are in `stryker.config.mjs` and
`vitest.stryker.config.mts`.

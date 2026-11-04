# Test coverage: figures and reasons

The course rubric expects 100% test coverage unless a reason is stated. ConnectSphere is below 100%, and this document
gives the reason for every file that falls short. Some reasons are acceptable as they stand. Others just mean a test is
missing, and those files are marked as such (reason G) rather than explained away.

CI deliberately has no coverage threshold: a drop in coverage does not fail a build. That makes this document the record
of what is not covered, so it has to be kept up to date by hand (see [Keeping this up to date](#keeping-this-up-to-date)).

## Figures

| Statements | Branches | Functions | Lines |
| --: | --: | --: | --: |
| 94.23% (8894 of 9438) | 90.50% (7445 of 8226) | 92.13% (2331 of 2530) | 95.09% (7517 of 7905) |

Of the 479 files measured, 242 are at 100% on all four measures and 237 are not.

Measured on 4 November 2026 at commit `adbdd6c` of `main`, the same way as CI's `test` job, with no database configured:

```bash
TZ=UTC pnpm vitest run   # with SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY unset
```

CI runs in UTC. The report is in `coverage/index.html`, and CI uploads it as the `coverage` artefact of each run. Branches
can differ by a few hundredths between runs of the same code, so a change that small means nothing.

## What the figures leave out

The figures count unit tests only, so they understate what is tested in some places and say nothing about others.

- **Integration tests are not counted.** They run in CI's `integration` job with coverage turned off. Measured once
  against a local database at commit `4354b95` (the previous measurement), with all 642 passing, adding them moved the
  totals only slightly: statements 93.90% against 93.66%, branches 89.78% against 89.50%, functions 91.88% against
  91.54%. So they are not the explanation for most gaps. That check has not been repeated at `adbdd6c`.
- **Playwright tests are not counted.** They also do most of their work outside CI: 24 of the 25 spec files skip unless
  `E2E_FULL_STACK` is set, and CI does not set it, so only `smoke.spec.ts` runs there.
- **Database code is not counted.** Functions, triggers and row-level security policies in `supabase/migrations/` are
  SQL, which this tool cannot measure. The integration tests are what check them.

## Files excluded from coverage

| Excluded | Why |
| --- | --- |
| `**/*.d.ts` | Type declarations only. They produce no code when built, so there is nothing to run. |

That is the only exclusion, set in [`vitest.config.mts`](../../vitest.config.mts). No file uses a `v8 ignore` comment to
hide lines from the report.

Only source code is measured: `apps/web/src`, `services/*/src` and `packages/shared/src`. Test files, config files,
`scripts/` and `supabase/` are outside that list, because they are not application code that runs in this tool.

## Reasons

Each file below 100% has one main reason, the one that accounts for most of what is not run.

| Reason | Files | Meaning | Is it acceptable? |
| --- | --: | --- | --- |
| **A. Startup wiring** | 14 | `server.ts`, which starts listening on a port, and `supabase.ts`, `app.ts` and `supabaseClient.ts`, which connect to the real database, plus the default clock or database a route file uses when no test passes one in. Unit tests pass in a fake database instead, so the real connection is not made. | Yes. There is almost no logic here, and a mistake stops the service starting. Each of the five `server.ts` files is three statements. |
| **B. Next.js route files** | 44 | Files in `src/app`: pages, layouts and `loading.tsx` skeletons, plus the `AuthLayout` and `AppShell` wrappers and the toast host (`ui/sonner.tsx`), loaded only by a layout. They arrange components and show a load failure. | Mostly. The components they show are tested. The risk is a page wired up wrongly, which only Playwright would catch, and CI skips most of Playwright. |
| **C. Server-side data loaders** | 24 | `*Server.ts`, `getEvent.ts`, `getVenues.ts` and similar, which read the session cookie through Next.js and call a service. Many pages that use them are never loaded in unit tests, and the rest only reach the success path. | Partly. Each one repeats the same shape, but the redirect to sign in and the load-failure messages are behaviour no test checks. |
| **D. Fallback branches** | 84 | Code runs, but one side of a choice does not: a placeholder for a missing value (`?? "Unknown"`), a default message when a service sends none (`data.error ?? "..."`), `data ?? []`, singular or plural wording, a guard on a malformed request. | Yes for now. These are small and low risk. Some can occur in real use, so this means "not worth a test yet", not "impossible". |
| **E. Small UI callbacks** | 23 | Closing a dialog, clearing a select, typing in a field, plus the unused parts of the shadcn/ui components in `components/ui`. | Yes. Mostly one-line handlers, and the shadcn/ui code is third-party code copied into the repo. |
| **F. Development-only or unused** | 4 | The `/styleguide` page and its component, used to view the design tokens, and code nothing calls: `RolePicker.tsx` and `unauthenticated()` in the venue service's `domain/errors.ts`. | Styleguide yes. The unused code should be deleted rather than tested. |
| **G. Missing test** | 44 | Real behaviour that no test runs. There is no good reason; a test should be written. Each file's missing behaviour is named in the [file list](#every-file-below-100). | **No.** |

## Why, per area

| Area | Files | Below 100% | Statements | Branches | Functions | Lines | Reasons (files) |
| --- | --: | --: | --: | --: | --: | --: | --- |
| apps/web: routes | 82 | 42 | 79.2% | 85.5% | 66.0% | 78.6% | B 41, F 1 |
| apps/web: components | 160 | 84 | 95.6% | 91.4% | 92.5% | 96.6% | B 3, D 45, E 23, F 2, G 11 |
| apps/web: browser and server helpers | 89 | 46 | 85.9% | 81.4% | 89.2% | 87.9% | C 24, D 11, G 11 |
| apps/web: middleware | 1 | 1 | 96.2% | 100.0% | 100.0% | 95.7% | G 1 |
| packages/shared | 32 | 11 | 99.3% | 97.6% | 99.6% | 99.6% | A 1, D 5, G 5 |
| services/auth-service | 10 | 7 | 90.1% | 80.0% | 77.1% | 91.7% | A 2, D 2, G 3 |
| services/equipment-service | 27 | 9 | 98.4% | 95.6% | 97.3% | 99.2% | A 2, D 4, G 3 |
| services/event-service | 23 | 13 | 98.6% | 91.7% | 98.1% | 98.8% | A 2, D 9, G 2 |
| services/notification-service | 12 | 4 | 97.1% | 93.1% | 94.9% | 98.2% | A 2, D 1, G 1 |
| services/venue-service | 43 | 20 | 94.7% | 89.5% | 93.4% | 95.9% | A 5, D 7, F 1, G 7 |

- **`apps/web` routes** are the lowest figure, and the main cause of the web totals being low. Most of these files are
  the page wrappers and loading skeletons of reason B.
- **`apps/web` components** are well covered. The gaps are mostly the fallback text and small handlers of reasons D and
  E. The ones that matter are in reason G, chiefly assigning a coordinator from the Lead's queue (`QueueAssignCell.tsx`),
  the events open for registration on the attendee's Home (`AttendeeDashboardOverview.tsx`), and the Find venue task on
  the coordinator's Home (`CoordinatorDashboardOverview.tsx`).
- **`apps/web` helpers** have the lowest branch figure in `apps/web`, because the data loaders of reason C are barely run.
  The rest is the "couldn't reach the server" message, repeated in several files and never tested.
- **`apps/web` middleware** misses one line: sending the user to sign in when auth-service cannot be reached.
- **`packages/shared`** is the best covered. What is left is mostly rejecting unusual input. It still matters, because
  the browser and the services both rely on these rules.
- **`auth-service`** is the lowest of the services, and has the lowest branch figure of any area. Its role dashboards are only partly tested, and so is refusing a
  signed-in user whose profile is inactive.
- **`equipment-service`** is close to complete. It is missing one refusal on closed events, one session check and two
  small cases in the availability count.
- **`event-service`** has high statement coverage and lower branch coverage, because of many `data ?? []` fallbacks after
  database reads. A few error answers in `routes/events.ts` and `routes/lead.ts` are untested.
- **`notification-service`** is close to complete. It is missing one race: a notification disappearing mid-update.
- **`venue-service`** has the most reason G files among the services. Unit tests replace the database with fakes, and
  the integration tests barely reach the database readers either, so `venueSearchReader.ts` is only 50% run even with
  them. Turning database refusals into answers (`venueUnavailabilityStore.ts`), a failed read in `venueEditReader.ts`,
  two readers in `supabaseBookingRepository.ts` and some permission refusals in `bookingService.ts` are also untested.

## Keeping this up to date

CI will not flag new gaps, so a PR that adds a file below 100%, or moves one to a different reason, should update this
document. A later full re-measure should replace the figures and the list below, along with the date and commit.

## Every file below 100%

Paths are relative to each area's source folder. The figures are percentages, and "Not run" lists at most six line
numbers of statements and branches that did not run.

### apps/web: routes

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `app/(auth)/forgot-password/page.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/(auth)/layout.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/(auth)/login/page.tsx` | 100 | 50 | 100 | 100 | B | 10 |
| `app/(auth)/register/page.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/(auth)/reset-password/page.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/booking-queue/[id]/page.tsx` | 100 | 91.66 | 100 | 100 | B | 52 |
| `app/booking-queue/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/booking-queue/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/dashboard/attendee/[id]/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/dashboard/attendee/browse/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/dashboard/attendee/page.tsx` | 100 | 87.5 | 100 | 100 | B | 25 |
| `app/dashboard/safety_officer/page.tsx` | 100 | 66.66 | 100 | 100 | B | 20, 29 |
| `app/equipment-availability/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/equipment-requests/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/equipment-reservation/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/events/[id]/page.tsx` | 100 | 97.4 | 100 | 100 | B | 138, 170 |
| `app/events/[id]/register/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/events/[id]/registrations/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/events/[id]/venue-request/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/events/review/page.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/layout.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/lead/coordinators/[id]/page.tsx` | 100 | 87.5 | 100 | 100 | B | 19 |
| `app/lead/coordinators/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/lead/events/[id]/reassign/page.tsx` | 100 | 90.9 | 100 | 100 | B | 40, 48 |
| `app/lead/queue/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/lead/queue/page.tsx` | 100 | 80 | 100 | 100 | B | 20, 35 |
| `app/notifications/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/registrations-overview/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/registrations-overview/page.tsx` | 100 | 95 | 100 | 100 | B | 48 |
| `app/registrations/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/safety-checks/[id]/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/safety-checks/[id]/page.tsx` | 100 | 81.25 | 100 | 100 | B | 53, 58, 59 |
| `app/safety-checks/loading.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `app/styleguide/page.tsx` | 0 | 100 | 0 | 0 | F | whole file |
| `app/venue-bookings/[id]/amend/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/venue-bookings/[id]/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/venue-bookings/[id]/replacement/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/venue-bookings/page.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `app/venues/[id]/edit/page.tsx` | 100 | 72.22 | 100 | 100 | B | 48 |
| `app/venues/new/page.tsx` | 100 | 91.66 | 100 | 100 | B | 40 |
| `app/venues/page.tsx` | 100 | 96.15 | 100 | 100 | B | 52 |
| `app/venues/search/page.tsx` | 0 | 100 | 0 | 0 | B | whole file |

### apps/web: components

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `components/AppShell.tsx` | 0 | 100 | 0 | 0 | B | whole file |
| `components/AttendeeDashboardOverview.tsx` | 88.88 | 75 | 83.33 | 88.88 | G: The events open for registration on the attendee's Home, and the message when they cannot be loaded. | 27, 44, 80, 83, 85, 90 |
| `components/AuthLayout.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `components/BfcacheGuard.tsx` | 77.77 | 0 | 75 | 85.71 | E | 9 |
| `components/BookingQueueDetail.tsx` | 100 | 79.41 | 100 | 100 | D | 31, 48, 50, 73, 75, 79, +1 more |
| `components/BookingQueueList.tsx` | 100 | 94.44 | 100 | 100 | D | 51 |
| `components/ChangeRequestReview.tsx` | 100 | 96.07 | 100 | 100 | D | 46, 58 |
| `components/CoordinatorAssignment.tsx` | 100 | 81.25 | 100 | 100 | D | 27, 61, 63 |
| `components/CoordinatorDashboardOverview.tsx` | 100 | 77.77 | 100 | 100 | G: The Find venue task for a booking whose venue became unavailable. | 40, 81, 82, 83, 86, 102 |
| `components/DashboardView.tsx` | 100 | 96.77 | 100 | 100 | D | 92 |
| `components/equipment/EquipmentCatalogueManager.tsx` | 97.46 | 96.42 | 92.85 | 96.87 | E | 102, 114, 125, 134 |
| `components/equipment/EquipmentItemEditor.tsx` | 97.77 | 93.02 | 93.75 | 100 | E | 95, 110 |
| `components/equipment/InventoryTable.tsx` | 100 | 90.9 | 100 | 100 | D | 48 |
| `components/EquipmentAvailabilityForm.tsx` | 100 | 96.29 | 100 | 100 | D | 64 |
| `components/EquipmentRequestReview.tsx` | 100 | 95 | 100 | 100 | E | 73 |
| `components/EquipmentReservationForm.tsx` | 91.78 | 88.7 | 88.23 | 93.75 | G: The browser check that stops an invalid reservation being sent. | 56, 82, 83, 84, 85, 128, +5 more |
| `components/event-request/EventRequestForm.tsx` | 98.55 | 94.23 | 100 | 100 | D | 95, 105 |
| `components/event-request/RequestStepper.tsx` | 80 | 100 | 66.66 | 80 | E | 33 |
| `components/event-request/StepFields.tsx` | 84.78 | 95.65 | 82.05 | 100 | E | 34, 45, 57, 61, 84, 92, +2 more |
| `components/EventChangeHistory.tsx` | 100 | 94.11 | 100 | 100 | D | 30 |
| `components/EventChangeRequestForm.tsx` | 97.95 | 64.81 | 100 | 100 | G: Filling the form from an event with missing values. | 21, 22, 24, 25, 26, 27, +12 more |
| `components/EventChangeRequestList.tsx` | 100 | 94.11 | 100 | 100 | D | 53 |
| `components/EventDetailsForm.tsx` | 98.24 | 85.71 | 94.11 | 98.03 | E | 76, 109, 114, 125 |
| `components/EventImpactWarning.tsx` | 80 | 57.14 | 75 | 80 | E | 31 |
| `components/EventRegistrationForm.tsx` | 92.85 | 90 | 80 | 96 | G: Ignoring a second press of Register (SCRUM-83/AC16), and a failed registration. | 43, 56, 72, 117 |
| `components/EventReviewActions.tsx` | 92.68 | 84.21 | 88.88 | 97.29 | E | 69, 92, 108 |
| `components/EventSafetyDecisions.tsx` | 100 | 78.56 | 100 | 100 | D | 19, 21 |
| `components/EventStatusPanel.tsx` | 100 | 96.07 | 100 | 100 | D | 51, 82 |
| `components/Field.tsx` | 100 | 83.33 | 100 | 100 | D | 11, 19 |
| `components/ForgotPasswordForm.tsx` | 100 | 87.5 | 100 | 100 | D | 23 |
| `components/LayoutTypeManager.tsx` | 93.75 | 81.15 | 95.83 | 96.05 | G: A rename the server refuses for a reason other than the name. | 95, 100, 114, 115, 116, 120, +4 more |
| `components/LeadAssignForm.tsx` | 96.29 | 90 | 100 | 100 | D | 92, 100 |
| `components/LeadCoordinatorEvents.tsx` | 100 | 66.66 | 100 | 100 | D | 43, 45 |
| `components/LeadDashboardOverview.tsx` | 100 | 93.75 | 100 | 100 | D | 44 |
| `components/LeadEventSummary.tsx` | 100 | 60 | 100 | 100 | D | 15, 16, 17, 18 |
| `components/LeadQueueList.tsx` | 100 | 94.44 | 100 | 100 | D | 57 |
| `components/LeadWorkloadPanel.tsx` | 100 | 50 | 100 | 100 | D | 16 |
| `components/LoginForm.tsx` | 95.83 | 84.21 | 87.5 | 95.65 | E | 46, 70 |
| `components/MyEventRequestsList.tsx` | 100 | 70 | 100 | 100 | D | 26, 27 |
| `components/NeedsAttentionBanner.tsx` | 100 | 66.66 | 100 | 100 | D | 17, 30 |
| `components/NotificationBell.tsx` | 94 | 87.23 | 94.44 | 97.5 | E | 58, 81, 82, 83, 89, 154, +1 more |
| `components/NotificationList.tsx` | 100 | 95.34 | 100 | 100 | D | 30, 47 |
| `components/OrganiserHome.tsx` | 100 | 95.23 | 100 | 100 | D | 77, 171 |
| `components/PageFrame.tsx` | 33.33 | 100 | 33.33 | 33.33 | E | 44, 52 |
| `components/ProfileForm.tsx` | 100 | 96.87 | 100 | 100 | D | 43 |
| `components/QueueAssignCell.tsx` | 42.1 | 35.71 | 66.66 | 43.75 | G: Assigning a coordinator from the Lead's queue, including the failure message. | 19, 20, 21, 22, 23, 24, +7 more |
| `components/RegisterForm.tsx` | 100 | 92.85 | 100 | 100 | D | 29 |
| `components/ReplacementPicker.tsx` | 92 | 94.44 | 83.33 | 91.66 | E | 31, 54, 55 |
| `components/ResetPasswordForm.tsx` | 100 | 90 | 100 | 100 | D | 31 |
| `components/ReviewQueue.tsx` | 93.22 | 82.05 | 95 | 95.74 | G: The access-denied view, and a request cancelled part-way. | 49, 51, 66, 71, 74, 107 |
| `components/RolePicker.tsx` | 0 | 0 | 0 | 0 | F | whole file |
| `components/SafetyCheckActions.tsx` | 100 | 96.29 | 100 | 100 | D | 56 |
| `components/SafetyCheckQueue.tsx` | 100 | 66.66 | 100 | 100 | D | 14, 56 |
| `components/SafetyCheckReview.tsx` | 90.47 | 86.95 | 85.71 | 93.75 | G: Showing the equipment and venues on the safety review. | 32, 118, 127, 130 |
| `components/SafetyOfficerHome.tsx` | 100 | 94.44 | 100 | 100 | D | 58 |
| `components/shell/NeedsAction.tsx` | 100 | 90.47 | 100 | 100 | D | 10, 11 |
| `components/shell/ShellFrame.tsx` | 96.66 | 95 | 91.66 | 100 | E | 20, 111 |
| `components/styleguide/Styleguide.tsx` | 0 | 0 | 0 | 0 | F | whole file |
| `components/SuitabilityCheck.tsx` | 100 | 93.75 | 100 | 100 | D | 36 |
| `components/SuitabilityReport.tsx` | 100 | 87.5 | 100 | 100 | D | 35 |
| `components/ui/card.tsx` | 85.71 | 100 | 85.71 | 85.71 | E | 59 |
| `components/ui/dialog.tsx` | 90.9 | 83.33 | 90 | 90.9 | E | 23, 112 |
| `components/ui/nav-item.tsx` | 100 | 65 | 100 | 100 | D | 29, 30, 31, 40, 50, 51, +1 more |
| `components/ui/popover.tsx` | 57.14 | 100 | 50 | 57.14 | E | 50, 60, 73 |
| `components/ui/select.tsx` | 72.72 | 100 | 66.66 | 72.72 | E | 11, 101, 142 |
| `components/ui/sonner.tsx` | 0 | 0 | 0 | 0 | B | whole file |
| `components/ui/status-badge.tsx` | 100 | 83.33 | 100 | 100 | D | 56 |
| `components/ui/table.tsx` | 77.77 | 100 | 75 | 77.77 | E | 42, 97 |
| `components/UnsuitableConfirm.tsx` | 92.3 | 91.66 | 100 | 100 | G: Refusing a missing override reason. | 24 |
| `components/venue-calendar/VenueCalendar.tsx` | 100 | 95.83 | 100 | 100 | D | 48 |
| `components/VenueBookingActions.tsx` | 96.87 | 100 | 90.9 | 96.29 | E | 76 |
| `components/VenueBookingCancel.tsx` | 100 | 95.65 | 100 | 100 | D | 44 |
| `components/VenueBookingCard.tsx` | 100 | 95.55 | 100 | 100 | D | 30, 105 |
| `components/VenueBookingChangeForm.tsx` | 97.72 | 100 | 90.9 | 97.56 | E | 112 |
| `components/VenueBookingDetail.tsx` | 100 | 81.08 | 100 | 100 | D | 11, 17, 67, 114, 116 |
| `components/VenueBookingList.tsx` | 100 | 88.88 | 100 | 100 | D | 54 |
| `components/VenueBookingRequestForm.tsx` | 94.44 | 91.54 | 80 | 93.75 | E | 93, 115, 117, 128, 141, 142, +3 more |
| `components/VenueCatalogue.tsx` | 95.5 | 87.64 | 96.96 | 100 | G: Search failures, and toggling a facility or layout filter. | 56, 57, 75, 77, 86, 99, +5 more |
| `components/VenueDetail.tsx` | 100 | 94.44 | 100 | 100 | D | 91, 151 |
| `components/VenueForm.tsx` | 96.73 | 88.46 | 93.75 | 98.7 | D | 60, 125, 145, 166, 197, 244, +2 more |
| `components/VenueStaffDashboardOverview.tsx` | 100 | 91.66 | 100 | 100 | D | 70, 97, 121 |
| `components/VenueStaffDecision.tsx` | 96.87 | 90.62 | 90.9 | 96.42 | E | 124, 140 |
| `components/VenueTimingForm.tsx` | 100 | 95 | 100 | 100 | D | 54 |
| `components/VenueUnavailabilityForm.tsx` | 100 | 96.77 | 100 | 100 | D | 81 |

### apps/web: browser and server helpers

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `lib/attendeeDashboard.ts` | 95.65 | 82.35 | 90.9 | 100 | G: Picking the events still open for registration. | 30, 43 |
| `lib/bookingQueueServer.ts` | 40.61 | 52.17 | 37.5 | 44 | C | 40, 41, 42, 44, 45, 54, +9 more |
| `lib/contrast.ts` | 90 | 75 | 100 | 100 | D | 10 |
| `lib/coordinatorDashboard.ts` | 100 | 92.15 | 100 | 100 | D | 35, 61, 94 |
| `lib/coordinatorDashboardServer.ts` | 0 | 0 | 0 | 0 | C | whole file |
| `lib/dashboard.ts` | 0 | 0 | 0 | 0 | C | whole file |
| `lib/equipmentAvailabilityServer.ts` | 0 | 0 | 0 | 0 | C | whole file |
| `lib/equipmentCatalogueServer.ts` | 92.3 | 100 | 66.66 | 100 | C | 34 |
| `lib/equipmentInventoryServer.ts` | 93.33 | 100 | 50 | 100 | C | 30 |
| `lib/equipmentRequestsServer.ts` | 100 | 96.42 | 100 | 100 | C | 33 |
| `lib/equipmentReservationServer.ts` | 100 | 90 | 100 | 100 | C | 15 |
| `lib/eventRegistration.ts` | 95.65 | 100 | 100 | 95.23 | G: The "couldn't reach the server" message. | 104 |
| `lib/eventRegistrationServer.ts` | 89.47 | 40 | 100 | 100 | C | 12, 18, 26, 33, 44, 51 |
| `lib/eventRequestForm.ts` | 98.27 | 90.66 | 100 | 100 | D | 79, 142, 155, 156, 181, 190, +1 more |
| `lib/eventRequests.ts` | 0 | 100 | 0 | 0 | G: Tests replace this file with a mock, so submitting a request is never run. | whole file |
| `lib/eventRequestsServer.ts` | 54.16 | 55.55 | 50 | 52.94 | C | 9, 10, 13, 14, 19, 21, +2 more |
| `lib/events.ts` | 91.48 | 100 | 100 | 91.11 | G: The "couldn't reach the server" message. | 76, 110, 129, 145 |
| `lib/eventsApi.ts` | 100 | 90 | 100 | 100 | D | 31 |
| `lib/getEvent.ts` | 48.93 | 41.17 | 50 | 50 | C | 28, 33, 34, 36, 40, 41, +15 more |
| `lib/getUpcomingEvents.ts` | 100 | 87.5 | 100 | 100 | C | 43 |
| `lib/getVenues.ts` | 100 | 83.33 | 100 | 100 | C | 33, 42 |
| `lib/http.ts` | 90.47 | 78.56 | 80 | 100 | G: A cancelled request, and a failure response with no readable body. | 31, 37, 40 |
| `lib/layoutTypesServer.ts` | 92.3 | 100 | 66.66 | 100 | C | 34 |
| `lib/lead.ts` | 75 | 100 | 100 | 75 | G: The "couldn't reach the server" message. | 18 |
| `lib/leadServer.ts` | 96 | 70 | 100 | 100 | C | 29, 37, 67, 74, 91, 106, +1 more |
| `lib/nav.ts` | 88.88 | 100 | 75 | 100 | G: Choosing the longest matching menu link. | 87 |
| `lib/notificationDisplay.ts` | 83.33 | 66.66 | 100 | 100 | G: The "2 min ago", "3 h ago" and "Yesterday" wording. | 73, 74, 76, 78, 79, 98 |
| `lib/notifications.ts` | 94.73 | 50 | 100 | 100 | G: A failed or malformed unread count. | 21, 23 |
| `lib/organiserHomeServer.ts` | 0 | 0 | 0 | 0 | C | whole file |
| `lib/registrationSettingsServer.ts` | 100 | 75 | 100 | 100 | C | 13 |
| `lib/roles.ts` | 100 | 50 | 100 | 100 | D | 16 |
| `lib/safetyCheck.ts` | 75 | 100 | 100 | 75 | G: The "couldn't reach the server" message. | 29 |
| `lib/safetyCheckServer.ts` | 68.75 | 50 | 75 | 78.56 | C | 21, 27, 35, 81, 114, 115, +1 more |
| `lib/safetyFactors.ts` | 100 | 91.66 | 100 | 100 | D | 57 |
| `lib/shellServer.ts` | 100 | 94.44 | 100 | 100 | C | 52 |
| `lib/tokens.ts` | 90 | 66.66 | 100 | 100 | D | 8, 67 |
| `lib/venueAvailabilityServer.ts` | 92.85 | 88.88 | 50 | 100 | C | 31, 34 |
| `lib/venueBookings.ts` | 100 | 89.65 | 100 | 100 | D | 201, 213, 221 |
| `lib/venueBookingsServer.ts` | 87.5 | 57.14 | 83.33 | 88.88 | C | 35, 39, 47, 54, 59, 60, +1 more |
| `lib/venueCatalogueServer.ts` | 92.85 | 100 | 75 | 100 | C | 39 |
| `lib/venueChecks.ts` | 100 | 92.5 | 100 | 100 | D | 57, 59, 64 |
| `lib/venueFilters.ts` | 98.14 | 80.7 | 100 | 100 | D | 22, 23, 27, 28, 29, 30, +4 more |
| `lib/venueSearch.ts` | 0 | 0 | 0 | 0 | G: Tests replace this file with a mock, so building the search URL is never run. | whole file |
| `lib/venueSearchServer.ts` | 0 | 0 | 0 | 0 | C | whole file |
| `lib/venueStaffDashboard.ts` | 97.56 | 96.66 | 94.11 | 100 | D | 37, 55 |
| `lib/venueSuitabilityServer.ts` | 0 | 0 | 0 | 0 | C | whole file |

### apps/web: middleware

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `middleware.ts` | 96.15 | 100 | 100 | 95.65 | G: Sending the user to sign in when auth-service cannot be reached. | 33 |

### packages/shared

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `equipmentAvailability.ts` | 98.68 | 91.52 | 100 | 100 | G: Returning field errors from the query check. | 26, 55, 142, 143, 149 |
| `eventChangeRequest.ts` | 96.19 | 94.91 | 100 | 97.61 | G: Rejecting non-text fields and invalid dates. | 86, 87, 88, 109, 160, 161, +2 more |
| `eventDetails.ts` | 98.86 | 95.19 | 100 | 100 | G: Rejecting a start time in the past. | 81, 83, 91, 203, 235 |
| `eventRequest.ts` | 98.3 | 97.36 | 100 | 97.87 | G: One custom validation message. | 87, 109 |
| `registration.ts` | 100 | 90 | 100 | 100 | D | 38 |
| `supabaseClient.ts` | 0 | 100 | 0 | 0 | A | whole file |
| `venueBooking.ts` | 99 | 94 | 100 | 100 | G: Rejecting an invalid date. | 189, 219, 230, 275, 323, 330 |
| `venueBookingFlags.ts` | 100 | 95 | 100 | 100 | D | 78 |
| `venueCatalogue.ts` | 100 | 98.94 | 100 | 100 | D | 113 |
| `venueSuitability.ts` | 100 | 98.27 | 100 | 100 | D | 147 |
| `venueUnavailability.ts` | 100 | 97.46 | 100 | 100 | D | 116, 173 |

### services/auth-service

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `middlewares/session.ts` | 95.23 | 89.47 | 100 | 94.73 | G: Refusing a signed-in user whose profile is inactive or has no valid role. | 50, 51, 56 |
| `routes/auth.ts` | 93.05 | 90 | 72.72 | 100 | G: A failed password update, plus best-effort sign-out and clean-up calls. | 38, 84, 90, 101, 111, 124 |
| `routes/dashboard.ts` | 88.23 | 63.63 | 68.75 | 88.63 | G: The rows of several role dashboards are never built. | 23, 26, 27, 30, 46, 104, +5 more |
| `routes/profile.ts` | 100 | 93.75 | 100 | 100 | D | 33, 46 |
| `server.ts` | 0 | 0 | 0 | 0 | A | whole file |
| `supabase.ts` | 12.5 | 0 | 0 | 12.5 | A | 15, 16, 17, 18, 19, 20, +2 more |
| `validation.ts` | 100 | 50 | 100 | 100 | D | 47 |

### services/equipment-service

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `app.ts` | 85.71 | 80 | 50 | 100 | A | 27, 29, 30 |
| `middlewares/session.ts` | 93.75 | 87.5 | 100 | 100 | G: Refusing a session that has no user. | 28 |
| `readers/equipmentReader.ts` | 100 | 75 | 100 | 100 | D | 23 |
| `readers/reservationReader.ts` | 100 | 83.33 | 100 | 100 | D | 30 |
| `routes/equipment.ts` | 100 | 50 | 100 | 100 | D | 67 |
| `routes/equipmentRequests.ts` | 100 | 50 | 100 | 100 | D | 45, 65, 92 |
| `server.ts` | 0 | 0 | 0 | 0 | A | whole file |
| `services/availabilityService.ts` | 96.77 | 87.5 | 94.73 | 98.07 | G: Skipping an empty period, and sorting several events holding one item. | 71, 119 |
| `services/technicalAssignmentService.ts` | 98.63 | 95.23 | 100 | 100 | G: Refusing to change an assignment on a closed event. | 87, 139 |

### services/event-service

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `routes/changeRequestReview.ts` | 100 | 98.07 | 100 | 100 | D | 95 |
| `routes/changeRequests.ts` | 100 | 85.36 | 100 | 100 | D | 30, 49, 79, 80, 81, 83 |
| `routes/eventDetails.ts` | 100 | 94.8 | 100 | 100 | D | 67, 117, 123, 126 |
| `routes/eventRequests.ts` | 100 | 92.85 | 100 | 100 | D | 15 |
| `routes/events.ts` | 98.66 | 91.64 | 100 | 99.25 | G: Some 403, 404 and 500 answers. | 78, 111, 118, 145, 207, 288, +23 more |
| `routes/lead.ts` | 97.75 | 82.14 | 100 | 100 | G: Failure answers when the eligible coordinators cannot be read. | 53, 90, 105, 119, 135, 146, +4 more |
| `routes/registrations.ts` | 100 | 89.02 | 100 | 100 | D | 40, 61, 66, 88, 119, 165, +3 more |
| `routes/safetyChecks.ts` | 100 | 92.3 | 100 | 100 | D | 29, 68 |
| `routes/upcomingEvents.ts` | 100 | 75 | 100 | 100 | D | 17 |
| `server.ts` | 0 | 0 | 0 | 0 | A | whole file |
| `services/arrangementImpact.ts` | 100 | 68.75 | 100 | 100 | D | 54, 56, 57, 63, 65 |
| `services/registrations.ts` | 100 | 94.28 | 100 | 100 | D | 29, 73 |
| `supabase.ts` | 14.28 | 0 | 0 | 14.28 | A | 13, 14, 15, 16, 17, 19, +1 more |

### services/notification-service

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `app.ts` | 88.88 | 81.81 | 60 | 100 | A | 20, 21 |
| `readers/accessReader.ts` | 100 | 88.88 | 100 | 100 | D | 28, 47, 56 |
| `server.ts` | 0 | 0 | 0 | 0 | A | whole file |
| `services/notificationService.ts` | 98.21 | 95.65 | 100 | 100 | G: A notification that disappears while it is being marked read. | 119, 126 |

### services/venue-service

| File | Stmts | Branch | Funcs | Lines | Reason | Not run (line numbers) |
| --- | --: | --: | --: | --: | --- | --- |
| `app.ts` | 95.45 | 92.3 | 80 | 100 | A | 49 |
| `domain/dto.ts` | 100 | 86.84 | 100 | 100 | D | 24, 58, 65, 128, 144 |
| `domain/errors.ts` | 96.66 | 100 | 90 | 100 | F | 69 |
| `domain/queueDto.ts` | 100 | 96.15 | 100 | 100 | D | 103 |
| `readers/venueEditReader.ts` | 85.71 | 83.33 | 100 | 100 | G: A failed read of the venue or of its bookings. | 47, 70, 71 |
| `readers/venueSearchReader.ts` | 18.18 | 18.18 | 33.33 | 25 | G: Reading the filter options, and every read failure. Integration tests raise statements to 50%, no further. | 60, 61, 64, 69, 74, 78, +10 more |
| `readers/venueTimingWriter.ts` | 100 | 83.33 | 100 | 100 | D | 58, 65 |
| `readers/venueUnavailabilityStore.ts` | 75.67 | 73.52 | 100 | 85.18 | G: Turning database refusals into 403, 404 and validation answers. | 61, 62, 63, 64, 65, 77, +1 more |
| `repositories/supabaseBookingRepository.ts` | 91.74 | 87.5 | 88 | 92.4 | G: `flagHistoryFor()` and `listApprovedBetween()`, which read a booking's flag history and the approved bookings in a period. | 54, 90, 102, 162, 177, 185, +9 more |
| `routes/bookingQueue.ts` | 94.44 | 66.66 | 83.33 | 94.11 | A | 10 |
| `routes/venueBookings.ts` | 98.24 | 100 | 95 | 98.24 | A | 34 |
| `routes/venues.ts` | 94.61 | 87.17 | 80.64 | 94.44 | G: The 404 for an unknown venue, and the default database readers. | 81, 82, 83, 84, 86, 87, +4 more |
| `server.ts` | 0 | 0 | 0 | 0 | A | whole file |
| `services/bookingService.ts` | 95.85 | 92.17 | 100 | 99.29 | G: Refusals: wrong role, unknown event, another coordinator's event. | 72, 81, 82, 83, 141, 198, +8 more |
| `services/decisionService.ts` | 100 | 97.22 | 100 | 100 | D | 102 |
| `services/queueService.ts` | 100 | 68 | 100 | 100 | D | 42, 43, 47, 58, 63, 74, +1 more |
| `services/replacementService.ts` | 98.03 | 89.79 | 100 | 100 | G: Replacement already pending. | 63, 81, 91, 92, 99 |
| `services/suitabilityService.ts` | 100 | 98.18 | 100 | 100 | D | 51 |
| `services/trackingService.ts` | 100 | 94.23 | 100 | 100 | D | 132, 139, 156 |
| `supabase.ts` | 0 | 0 | 0 | 0 | A | whole file |

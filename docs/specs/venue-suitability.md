# Venue Suitability Check: Final User Story

User story for **Check Whether a Venue Suits an Event** (ConnectSphere, IS212), compiled 2026-10-14.

- Scenario numbers are the test IDs: `109-S3` means SCRUM-109, Scenario 3.
- Jira writes its acceptance criteria as seven scenarios, not numbered ACs. Here, `AC<n>` means Scenario `n`
  (so `SCRUM-109/AC4` is "The venue is not available").
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-109 | [Venue Suitability Checking] Check Whether a Venue Suits an Event | SCRUM-29 (venue catalogue), SCRUM-36 (bookings that hold a slot) |

SCRUM-110 (suitability on the booking request) builds on the shared check described here.

## Implementation decisions (2026-10-14)

These override the text below where they conflict.

- **One shared check.** `checkSuitability(venue, requirements, availability)` in `packages/shared/src/venueSuitability.ts`
  (pure, no I/O). Venue search (SCRUM-65), booking requests (SCRUM-110) and change impact reuse it. **[DECIDED]**
- **Result.** One line per criterion (`capacity`, `layout`, `accessibility`, `facilities`, `operatingHours`,
  `availability`), each `met`, `not_met`, `not_checked` or `manual`, with a message. The overall result is "Suitable"
  unless at least one criterion is `not_met`. `not_checked` and `manual` never make a venue unsuitable (Scenario 6). **[DECIDED]**
- **Only what is stored today is checked (user decision 2026-10-14).** `events` has no required-facilities column and
  accessibility needs are free text, so:
  - Facilities: always `not_checked`, "Not specified – not checked". **"PA system not available" (Scenario 3) cannot be
    produced** without an event-side facilities field; that needs a schema change and an event form change, which are
    out of scope. The venue's own facilities are still shown on the venue pages.
  - Accessibility: free text cannot be compared, so a stated need is `manual`, "Check manually: <the text>", and
    appears under "Check manually". No need stated: `not_checked`.
  - No event-side schema or form changes. **[DECIDED]**
- **Capacity.** Attendance is an explicit parameter of the check (`requirements.attendance`), not read inside it, so a
  later multi-venue booking (SCRUM-98, SCRUM-110 Scenario 6) can pass its own number. The capacity compared is the
  chosen layout's own capacity when the venue supports the layout, otherwise the venue's maximum (same rule as search,
  SCRUM-65/AC3). Not met: "Expected attendance 120 exceeds capacity 60". **[DECIDED]**
- **Layout.** The event's preferred layout name is compared with the venue's supported layouts (case-insensitive).
  Not met: "Theatre not supported". No preference recorded: `not_checked`. **[DECIDED]**
- **Operating hours.** `isOpenDuring` (moved from `venueSearchService.ts` into `packages/shared`, search keeps using it):
  the start time is not before opening and the end time is not after closing; closing `00:00` is midnight; a venue with
  no stated hours is always open. Uses the period's Singapore times. **[DECIDED]**
- **Availability.** Asked through the seam `services/availabilityLookup.ts`. Today it wraps `hasHold` (a yes or no from
  `venue_slot_is_held`, migration 06/14, which sees every coordinator's bookings); a clash is reported as "already held
  for part of the requested period". When SCRUM-103 (setup/turnaround) merges, the seam switches to
  `SlotConflictRule.findConflict`, which returns the exact occupied period (including setup and turnaround), and the
  message then shows it. Unavailability blocks (SCRUM-105) join the same way. **[DECIDED]**
- **The period.** From the event's proposed date and times; the caller may override `date`, `startTime`, `endTime` and
  `attendance` (the request form checks what is typed, not only what is saved). No period known: operating hours and
  availability are `not_checked`. **[DECIDED]**
- **Endpoint** (`venue-service`, port 4003; needs a session, 401 otherwise) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /venue-suitability?venueId&eventId[&date&startTime&endTime][&attendance][&skipAvailability=true]` | 200 `{ venue, event, overall, criteria[], manualChecks[] }`, 403, 404, 422 `{ code, error, fieldErrors }` |

  Only `event_coordinator` and `venue_staff` (Scenario 7); others get 403 before anything is read. A coordinator may only
  check an event assigned to them (403 otherwise, like requesting a venue). Mounted in `app.ts` after the session
  check, not in `routes/venues.ts`, because it reads events. `skipAvailability=true` leaves availability `not_checked`:
  a pending request holds its own slot, so Venue Staff reviewing it would otherwise always see a clash with itself.
  The queue items now carry `eventId` so the queue detail can run the check. **[DECIDED]**
- **Venue staff can only check events that already have a booking.** The `events` row-level security (migration 14) lets
  venue staff see an event only through a venue booking. For any other event the service answers 404 "Event not found".
  This is accepted, because staff meet the check on a booking they are reviewing. **[PROPOSED]**
- **Data.** A new `venueDetails` reader port reuses the row mapping of the venue search reader (layouts, facilities,
  hours, accessibility). No migration. **[DECIDED]**
- **Web.** `SuitabilityReport` shows the overall result and each criterion with text labels (met, not met, not
  checked, check manually), not colour alone. A "Check suitability" button on the venue request form (coordinators), and
  the report on `booking-queue/[id]` (venue staff). **[DECIDED]**

---

## SCRUM-109 Check Whether a Venue Suits an Event

**User story.** As an Event Coordinator, I want to see whether a venue suits my event on each of its requirements, so
that I can rule out unsuitable venues before requesting one.

### Acceptance criteria

*AC1 (Scenario 1).* Given "TechConf 2026" and "Orchid Hall" with no bookings on 2026-11-14, when I check Orchid Hall
against TechConf 2026, the overall result is "Suitable" and each requirement the event states is shown as met. (Facilities
and accessibility follow the decisions above.)

*AC2 (Scenario 2).* Given the event expects 120 attendees, when I check "Lotus Room" (capacity 60), the overall result is
"Not suitable" and capacity is not met: "Expected attendance 120 exceeds capacity 60".

*AC3 (Scenario 3).* Given the event requires layout "Theatre" and a facility, when I check "Lotus Room", every requirement
that is not met is listed: capacity and layout ("Theatre not supported"). The facility line cannot be produced (see
decisions).

*AC4 (Scenario 4).* Given "Orchid Hall" has an Approved booking for another event on 2026-11-14, 13:00–18:00, availability
is not met, with the conflicting period. The same applies to setup or turnaround time (SCRUM-103) and unavailability
(SCRUM-105), through the availability seam.

*AC5 (Scenario 5).* Given the event starts at 07:00, when I check "Orchid Hall" (open 08:00–22:00), operating hours are not met.

*AC6 (Scenario 6).* Given the event has no layout preference and a free-text note, layout is "Not specified – not
checked" and does not make the venue unsuitable; the free-text note is shown under "Check manually".

*AC7 (Scenario 7).* An Event Coordinator or Venue Staff can run the check; an Event Organiser or Attendee cannot (403).

### Tests

| ID | Scenario |
| --- | --- |
| 109-S1 | Every requirement met: overall Suitable; facilities not checked; stated accessibility need is a manual check (AC1). |
| 109-S2 | Attendance above capacity: Not suitable with "Expected attendance 120 exceeds capacity 60" (AC2). |
| 109-S3 | Capacity and layout both not met and both listed; facilities never produce "not available" (AC3). |
| 109-S4 | A holding booking makes availability not met and names the period; a free slot is met; back-to-back is met (AC4). |
| 109-S5 | Opening later or closing earlier than the event is not met; exact edges, 00:00 closing and no stated hours are met (AC5). |
| 109-S6 | Missing layout, attendance or period is "Not specified – not checked" and never makes the venue unsuitable; the free text is under Check manually (AC6). |
| 109-S7 | 401 without a session; 403 for organiser and attendee; 200 for coordinator and venue staff; a coordinator cannot check another's event (AC7). |
| 109-S8 | The layout's own capacity is used when the venue supports the layout; an explicit attendance overrides the event's (AC2). |
| 109-S9 | Route: unknown venue or event is 404; missing ids and malformed date, time or attendance are 422; date, times and attendance override the event's. |
| 109-S10 | `isOpenDuring` (shared) keeps the venue search's operating-hours behaviour (65-S15). |
| 109-S11 | `skipAvailability=true` leaves availability not checked, so a request does not clash with itself (AC4, queue view). |
| UI | The report shows every criterion with a text status; the button runs the check on the typed venue, date and times; the queue detail shows the report. |
| DB | Against Postgres: a coordinator is told a venue is unavailable because of another coordinator's booking; venue staff can check an event with a booking, not one without. |

# Suitability on a Venue Booking Request: Final User Story

User story for **Show Suitability When Requesting a Venue** (ConnectSphere, IS212), compiled 2026-10-14.

- Scenario numbers are the test IDs: `110-S4` means SCRUM-110, Scenario 4.
- Jira writes its acceptance criteria as six scenarios, not numbered ACs. Here, `AC<n>` means Scenario `n`.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-110 | [Venue Suitability Checking] Show Suitability When Requesting a Venue | SCRUM-32 (submit a request), SCRUM-37 (Venue Staff queue), SCRUM-98 (per-booking attendance and requirements), SCRUM-102 (change a booking), SCRUM-109 (the suitability check, `docs/specs/venue-suitability.md`) |

## Implementation decisions (2026-10-14)

These override the text below, and the older "no capacity check" rule 32-S9 of `docs/specs/venue-booking-request.md`.

- **A warning, not a rule.** Venue Staff keep the final decision, so an unsuitable venue can still be requested, with a
  reason. **Availability is the exception and stays a hard block** (a double booking must be prevented): the slot check
  runs first, refuses with `SLOT_CONFLICT` as before, and never offers the confirm step or reads any override. **[DECIDED]**
- **Order in `submit()`.** validation, role and event checks, active-request and repeat-of-rejected checks, slot check
  (hard block), then suitability, then insert. **[DECIDED]**
- **Unsuitable and no valid reason.** `409 UNSUITABLE_VENUE`, body `{ code, error, unmet: [{ key, label, message }] }`,
  nothing inserted. The same body field `overrideReason` (1 to 500 characters once trimmed) on `POST /venue-bookings`,
  `/venue-bookings/:id/amend` and `/venue-bookings/:id/accept-suggestion` is the confirmation. A blank reason counts as
  none (409); a reason over 500 characters is `422` with `fieldErrors.overrideReason`. **[DECIDED]**
- **What is stored (migration `33_venue_booking_suitability.sql`).** `venue_bookings.suitability` (`suitable` or
  `not_suitable`; null for older rows), `suitability_unmet` (jsonb, the unmet requirements as they were),
  `suitability_override_reason`. A check constraint: `not_suitable` needs a reason of 1 to 500 characters. They are a
  snapshot taken at submission (like DR8) and are not in the UPDATE grant, so a later edit of the venue or event does
  not rewrite them. **[DECIDED]**
- **Same check as SCRUM-109.** `checkSuitability` is run on the event's saved details (attendance, layout, accessibility
  text) and the requested date and times, with availability already settled by the slot check. Only `not_met` lines count
  as unmet; `not_checked` and `manual` lines never raise the warning. **[DECIDED]**
- **Each booking is judged on its own numbers (Scenario 6, built on SCRUM-98).** An event can hold several venue
  bookings, each with its own `expectedAttendance` and `venueRequirements` (a layout name), defaulting to the event's
  (`docs/specs/multiple-venue-bookings.md`). The check uses the booking's attendance and layout, not the event's, so
  "Breakout A" for 40 people at a 60-seat room is suitable although the event expects 120. The accessibility text is always
  the event's. `checkSuitability` still takes attendance explicitly. **[DECIDED]**
- **Changing a booking (SCRUM-102) re-checks it.** `PATCH /venue-bookings/:id` sends the booking back to PENDING with new
  numbers, so the stored result would otherwise be about numbers it no longer has (it could say "suitable" for 40 people when
  the booking is now for 300). The safer choice is to make the result afresh from the changed numbers: an unsuitable change
  needs `overrideReason` exactly like a new request (409 `UNSUITABLE_VENUE`, nothing changed, otherwise), and the new result,
  unmet list and reason replace the old ones; a change that now fits clears the reason. `change_venue_booking()` (migration 30) is
  re-created in migration 33 with three optional arguments so the result is stored in the same step as the change. Availability is
  not re-judged by the service on a change: the database overlap rule (102-S4) stays the authority. A change that alters nothing
  is still `NO_CHANGES` first. **[DECIDED]**
- **Amending a rejected booking (SCRUM-60) and accepting a suggestion (SCRUM-59)** create a new booking through `submit()`, so
  they are checked and snapshotted like any new request. Cancelling needs no check. **[DECIDED]**
- **Capacity warning vs. this check.** SCRUM-98's `exceedsCapacity` flag stays on the response, but the request itself now
  needs the reason first (the 98-S10 and 102-S7 tests send one). **[DECIDED]**
- **Web.** On `UNSUITABLE_VENUE` the request form shows an inline `role="alertdialog"` step (same pattern as
  `VenueStaffDecision`) listing the unmet requirements, a required reason box, and "Submit anyway" and "Cancel"
  buttons. Cancel returns to the form and creates nothing. The same step is used when accepting a suggestion. The queue
  list gets a Suitability column; the queue detail lists the unmet requirements and the reason. **[DECIDED]**
- **Venue Staff only see their own queue.** Suitability appears on queue items and details, which only venue staff may
  read (SCRUM-37). The coordinator's own request response shows `suitability` only. **[DECIDED]**

---

## SCRUM-110 Show Suitability When Requesting a Venue

**User story.** As an Event Coordinator, I want to be warned when a venue I am requesting does not suit my event, and
for that result to travel with my request, so that Venue Staff never receive an unsuitable request without an
explanation.

### Acceptance criteria

*AC1 (Scenario 1).* Given "Orchid Hall" is suitable for "TechConf 2026", when I submit a request for it, no warning is
shown and the request is created as Pending with suitability "Suitable".

*AC2 (Scenario 2).* Given "Lotus Room" is not suitable on capacity and layout, when I submit a request for it, before
it is created I see the requirements that are not met, and I can continue only by confirming and giving a reason.

*AC3 (Scenario 3).* Given the warning, when I cancel, no request is created.

*AC4 (Scenario 4).* Given I submitted the Lotus Room request with a reason, when Venue Staff open the pending queue the
request shows "Not suitable", and opening it shows each unmet requirement and my reason.

*AC5 (Scenario 5).* Given "Orchid Hall" has an overlapping Approved booking, when I submit a request for it, it is
refused as in SCRUM-36, with no option to confirm and continue.

*AC6 (Scenario 6).* Given a booking of the event for "Breakout A" with expected attendance 40 (SCRUM-98), the request is checked
against 40, not the event's 120.

### Tests

| ID | Scenario |
| --- | --- |
| 110-S1 | A suitable venue: 201, PENDING, suitability `suitable`, no unmet list, any reason sent is not stored (AC1). |
| 110-S2 | An unsuitable venue without a reason: 409 `UNSUITABLE_VENUE` listing capacity and layout, nothing inserted; with a reason: 201 with suitability `not_suitable`, the unmet list and the reason stored (AC2). |
| 110-S2b | A blank reason is the same as none (409); a reason over 500 characters is 422 `overrideReason`; the reason is trimmed (AC2). |
| 110-S3 | Cancelling at the warning creates no request (web: Cancel does not call the service) (AC3). |
| 110-S4 | The queue list and detail show `not_suitable`, each unmet requirement and the reason; a suitable request shows `suitable` (AC4). |
| 110-S5 | An overlapping booking is `SLOT_CONFLICT` even with a reason, and is never `UNSUITABLE_VENUE` (AC5). |
| 110-S6 | A booking with its own attendance (40) and layout is judged on those: suitable at a 60-seat room though the event expects 120; without them the event's numbers apply; its own 80 is unsuitable and needs a reason; two bookings of one event are judged separately (AC6). |
| 110-S8 | Amend and accept-suggestion go through the same check; accept-suggestion takes `overrideReason`. |
| 110-S10 | Changing a booking re-checks it: a change past capacity needs a reason (409 otherwise, nothing changed); with one it is PENDING with the new result; a change that fits again clears the reason; a repository call sends the result with the change; NO_CHANGES and a 501-character reason keep their answers. |
| 110-S9 | Not-checked and manual lines (no layout recorded, free-text accessibility) never raise the warning. |
| 32-S9, 98-S10, 102-S7 | Superseded in part: attendance above capacity is no longer accepted silently; it needs the reason (110-S2), and then the `exceedsCapacity` flag is still returned. |
| UI | The confirm step lists the unmet requirements, needs a reason, "Submit anyway" resends with it, "Cancel" does not; the queue shows the Suitability column and detail. |
| DB | Migration 33: suitability columns exist; `not_suitable` without a reason is rejected; a coordinator cannot update the columns afterwards; `change_venue_booking()` stores the new result and clears the reason. |

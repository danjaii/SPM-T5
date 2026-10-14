# Book Multiple Venues for an Event: Final User Story

User story for **Book Multiple Venues for an Event** (ConnectSphere, IS212), compiled 2026-10-14.

- Scenario numbers are the test IDs: `98-S4` means SCRUM-98, Scenario 4.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-98 | Book Multiple Venues for an Event | SCRUM-32 (submit a venue booking request), SCRUM-36 (no double-held slot), SCRUM-60 (amend a rejected request) |

SCRUM-102 (change or cancel one venue booking) builds on this story.

The Week 9 customer clarification says each venue is checked on its own for suitability and capacity, and that the Event
Coordinator decides whether to confirm. So each booking is its own request, judged on its own details.

## Implementation decisions (2026-10-14)

These override `docs/specs/venue-booking-request.md` where they conflict (DR6 and 32-S6 in particular).

- **An event can hold several venue bookings.** The rule "one active request per event" (DR6) is dropped. Each request is a
  separate booking row on the same event, with its own venue, date, start, end and status. **[DECIDED]**
- **The same venue twice is allowed, if the periods do not overlap** (for example the same hall in the morning and again in the
  evening). The same venue for an overlapping period on the same event is refused with the existing code `DUPLICATE_VENUE`.
  **[DECIDED]**
- **Different venues may overlap in time.** That is the point of the story: two spaces at the same time. **[DECIDED]**
- **Another event's booking is still `SLOT_CONFLICT`.** The database rule that stops two holding bookings overlapping at one
  venue (migration 06, `venue_bookings_no_overlap`) is unchanged and is still the final authority. **[DECIDED]**
- **Each booking has its own expected attendance and venue requirements** (AC2: "using that booking's details only"). Both are
  optional on the form. If left out, they default to the event's own. They are saved in the booking's existing snapshot columns
  (`snapshot_expected_attendance`, `snapshot_venue_requirements`), so **no new columns are needed**. Accessibility needs stay
  the event's. **[DECIDED]**
- **Capacity is a warning, not a block.** If a booking's expected attendance is more than the venue's capacity, the booking is
  still created, and the reply carries `exceedsCapacity: true`. The request form warns before submitting (the venue's capacity
  against the booking's attendance, or the event's), and the event's list of bookings shows the flag. This matches 32-S9 (no
  capacity refusal) and the customer's "the Event Coordinator decides". Venue staff see each booking's own attendance in their
  queue, but not the flag; adding it there is a follow-up. **[DECIDED]**
- **One rejected booking can be replaced by one booking at a time.** Amending (SCRUM-60) or accepting a suggestion (SCRUM-59)
  for a rejected booking that already has a pending or approved replacement is still refused with `ACTIVE_REQUEST_EXISTS`.
  The code now means this and nothing else, and its message is now "This rejected request already has an active
  replacement." Migration 28 adds the matching unique index, `venue_bookings_one_active_replacement`. **[DECIDED]**
- **The repeat guard (DR7) is unchanged:** the same venue, date, start and end as a rejected booking of this event is still
  refused with `REPEAT_OF_REJECTED`. **[DECIDED]**
- **Bookings are independent (AC4).** A refused, rejected or withdrawn booking changes no other booking of the event. Nothing in
  the code links one booking's status to another's. **[DECIDED]**
- **A list of all of an event's bookings.** New `GET /events/:eventId/venue-bookings` returns every booking of the event, in any
  status, ordered by start (then by when it was requested), never cached. Each has its venue, date, times, status, rejection
  reason, own attendance and requirements, and `exceedsCapacity`. Only the event's assigned coordinator may read it (AC6 for
  reading). On the event page it replaces SCRUM-38's "Venue booking" section, which showed one approved booking (approved
  ones are in the list). `GET /events/:eventId/venue-booking` stays in venue-service but the web app no longer calls it.
  **[DECIDED]**
- **The public list shows every approved venue.** `list_public_events()` joins an event to its approved bookings, so two
  approved venues would make the event appear twice. Migration 28 redefines it so there is one row per event, with the venue
  names joined by ", " (each venue once, in the order of its first booking) and the address of the earliest one. Attendees
  are not shown each booking's time: a venue booking's period can include setup, so it is not the attendee's schedule.
  **[DECIDED]**
- **Not in this story:** changing or cancelling one booking (SCRUM-102), and the event becoming Confirmed only once all its
  bookings are approved. **[DECIDED]**
- **Migration 28** (26 and 27 are on the SCRUM-87 branch): drops `venue_bookings_one_active_per_event` and redefines
  `list_public_events()`. Affects venue-service and event-service. **[DECIDED]**

---

## SCRUM-98 Book Multiple Venues for an Event

**User story.** As an Event Coordinator, I want to book more than one venue for an event so that larger events can use several
spaces at the same time.

### Acceptance criteria

*AC1.* Requesting another venue for an event creates a separate booking on the same event.

*AC2.* Entering date, start, end, expected attendance and venue requirements checks that venue's suitability, availability and
conflicts using that booking's details only.

*AC3.* The same venue for an overlapping period is not allowed.

*AC4.* If one booking fails a check or is rejected, the other bookings stay unchanged.

*AC5.* An event with several bookings lists each with venue, date, start, end and status.

*AC6.* An event not assigned to the coordinator cannot request a venue.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 98-S1 | AC1 | A second request for a different venue while the first is pending | 201; two separate bookings on the event |
| 98-S2 | AC1 | A second request while the first is approved | 201; both held |
| 98-S3 | AC1 | Three requests for three venues | all three are created |
| 98-S4 | AC1 | The same venue, a later period that does not overlap | 201 |
| 98-S5 | AC1 | Back to back (one ends at 12:00, the next starts at 12:00) at the same venue | 201 |
| 98-S6 | AC2 | A request with its own expected attendance and venue requirements | the booking stores those values, not the event's |
| 98-S7 | AC2 | A request without them | the booking stores the event's attendance and requirements |
| 98-S8 | AC2 | The event's attendance changes after a booking is made | the booking's stored values are unchanged |
| 98-S9 | AC2 | Venue B is already held by another event for that period | 409 `SLOT_CONFLICT`; no booking created |
| 98-S10 | AC2 | Attendance 200, venue capacity 150 | 201; the booking has `exceedsCapacity: true`; the form warns but still submits |
| 98-S11 | AC2 | Attendance 100, venue capacity 150 (or exactly 150) | 201; `exceedsCapacity: false`; no warning |
| 98-S12 | AC2 | An invalid time (end before start) or a negative attendance | 422 with field errors; no booking |
| 98-S13 | AC3 | The same venue, a period that overlaps one of this event's pending bookings | 409 `DUPLICATE_VENUE` |
| 98-S14 | AC3 | The same venue, overlapping one of this event's approved bookings | 409 `DUPLICATE_VENUE` |
| 98-S15 | AC3 | The same venue, overlapping a booking of this event that was rejected or withdrawn | 201 (only holding bookings count) |
| 98-S16 | AC4 | A request fails (conflict or validation) | no row is created; the event's other bookings are unchanged |
| 98-S17 | AC4 | Venue staff reject one of two bookings | the other keeps its status |
| 98-S18 | AC4 | The coordinator withdraws one of two pending bookings | the other stays pending |
| 98-S19 | AC4 | Amending a rejected booking while another booking of the event is pending | 201; the other is unchanged |
| 98-S20 | AC4 | Amending the same rejected booking a second time while its replacement is pending or approved | 409 `ACTIVE_REQUEST_EXISTS` |
| 98-S21 | AC5 | `GET /events/:eventId/venue-bookings` for an event with three bookings | all three, each with venue, date, start, end, status and `exceedsCapacity` |
| 98-S22 | AC5 | The same, with no bookings | an empty list |
| 98-S23 | AC5 | The list includes rejected and withdrawn bookings | yes; status says which |
| 98-S24 | AC5 | The event page | shows each booking with venue, date, start, end and status, and a warning on one that exceeds capacity |
| 98-S25 | AC5 | Two venues approved for one event | the attendee's List of events shows the event once, with both venue names |
| 98-S26 | AC6 | A coordinator the event is not assigned to requests a venue | 403; no booking |
| 98-S27 | AC6 | The same coordinator reads the event's bookings list | 403 |
| 98-S28 | AC6 | Any other role (organiser, venue staff, attendee, technical support) requests or lists | 403; no session gets 401 |
| 98-S29 | AC6 | An event that is not eligible (for example Draft) | 409 `EVENT_NOT_ELIGIBLE` for a second request as for a first |

### Test map

- Service rules (unit, fakes): 98-S1 to S8, S10 to S13, S15 to S20, S26, S28, S29. In `services/venue-service/tests/unit/`.
- Database (integration, CI only): 98-S2, S9, S14, S25. The dropped unique index, the unchanged overlap constraint, and
  `list_public_events()`.
- Routes (unit with supertest): 98-S21 to S23, S27.
- Web (React Testing Library): 98-S24, plus the form's fields and warning (98-S6, S7, S10 to S12) and the page's loader
  (98-S21, S27).
- Where: `services/venue-service/tests/unit/submitBooking.test.ts` and `eventVenueBookings.test.ts`,
  `packages/shared/tests/venueBooking.test.ts`, `services/venue-service/tests/integration/bookingConstraints.test.ts`,
  `services/event-service/tests/integration/list-public-events.test.ts`, `apps/web/tests/unit/event-venue-bookings.test.tsx`
  and `venue-request.test.tsx`.

### Existing tests that change

- `32-S6` in `submitBooking.test.ts`: a second submit while the first is pending or approved is now 201, not
  `ACTIVE_REQUEST_EXISTS`. The test becomes 98-S1 and 98-S2.
- `60-S5` in `amendBooking.test.ts`: stays, because amending R1 twice is still refused (98-S20).
- `38-S4` in the web tests: the event page's one approved venue is now the list of every venue booking, so those tests moved
  to `event-venue-bookings.test.tsx` and `event-page.test.tsx`.
- `32-S6` in `supabaseBookingRepository.test.ts` and `bookingConstraints.test.ts`: the index is gone, so these are removed and
  replaced by the 98-S2 integration test.
- `fakeBookingRepository.ts`: stops enforcing one holding booking per event.

### Questions for the customer (none block the build)

1. Should the event move to Confirmed only when all its bookings are approved? (Left out for now.)
2. Should venue staff see which other venues the event holds? (Not shown for now.)

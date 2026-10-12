# Equipment Reservation: Final User Story

User story for **Equipment Reservation** (ConnectSphere, IS212), compiled 2026-10-06. Builds on SCRUM-18
([equipment-availability.md](equipment-availability.md)): same service, same availability rules.

- Scenario numbers are the test IDs: `19-S3` means SCRUM-19, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-19 | Reserve Equipment for an Event | SCRUM-18 (availability check) |

## Implementation decisions (2026-10-06)

These override the text below where they conflict.

- **Endpoints** (`equipment-service`, port 4004; all need a session, 401 otherwise; any role but
  `technical_support_staff` gets 403) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /equipment` | 200, the catalogue (already built in SCRUM-18), now also with `type` and `totalQuantity` for the cards |
  | `GET /reservable-events` | 200 `ReservableEvent[]`: eligible events (below), soonest first, with date, times and coordinator name |
  | `POST /equipment-reservations` body `{ eventId, equipmentId, quantity, date, startTime, endTime }` | 201 `ReservationConfirmation`; 409 `INSUFFICIENT` with the available quantity; 422 `fieldErrors` |

- **Who.** Technical Support Staff only, the same allow-list as SCRUM-18 (roles added later, such as the Week 7
  Event Coordinator Lead and Safety Officer, are refused by default). Technical Support Staff serve every event, so
  the reservation is **not** limited to events of a particular coordinator. **[DECIDED]**
- **No approval step.** The brief makes Technical Support Staff responsible for deciding whether equipment can be
  reserved (section 2; roles table). A new reservation is saved with status **`reserved`**, `requested_by` and
  `reviewed_by` = the staff member, and `quantity_reserved` = `quantity_requested`. Coordinators recording what an
  event needs ("Equipment Request Management", status `requested`) is a separate story. **[DECIDED]**
- **Eligible events.** Status `approved`, `planning`, `awaiting_arrangements` or `confirmed` (brief step 12:
  additional equipment may be requested after confirmation), and the event has not started yet. **[DECIDED]**
- **The period.** A date plus start and end time, Singapore time, same day, like SCRUM-18. Pre-filled from the
  chosen event's own date and times, and editable. The start must not be in the past. **[DECIDED]**
- **Choosing equipment.** A searchable grid of cards, one per catalogue item (name, type, total quantity). Typing
  in the search box filters the cards by name, ignoring letter case. Clicking a card selects it. Equipment that is
  damaged, under maintenance or retired is shown greyed out with its status and cannot be selected. **[DECIDED]**
- **Availability is SCRUM-18's.** Only `approved` and `reserved` reservations count, at their peak in the period.
  A new reservation is `reserved`, so it lowers the availability SCRUM-18 reports for that period (AC3). **[DECIDED]**
- **No double-commitment, even at the same moment.** Checking what is free and saving the reservation happen as one
  step inside the database: a function in migration **`12_reserve_equipment.sql`** locks the equipment row, recounts
  the peak in the period, and either inserts the reservation or refuses. Two staff reserving the last units at the
  same time cannot both succeed. **[DECIDED]**
- **Prompts** (same "Please …" style as SCRUM-18): "Please select the event.", "Please select the equipment.",
  "Please enter the quantity required.", "Please enter a date.", "Please enter a start time.", "Please enter an end
  time.", plus SCRUM-18's format, end-after-start and not-in-the-past messages. The event prompt is not in the
  original criteria; added because a reservation must belong to an event. **[DECIDED]**
- **Where.** A "Reserve equipment" page, linked from the Technical Support Staff dashboard next to "Check equipment
  availability". **[DECIDED]**

---

## SCRUM-19 Reserve Equipment for an Event

**User story.** As a Technical Support Staff, I want to reserve available equipment for an event, so that the same
equipment is not committed to two incompatible events at the same time.

### Acceptance criteria

*AC1.* Given that I have selected an equipment item from the equipment catalogue for a specific event, and specified
a quantity and a date and time period, when I make the reservation, the system should reserve that quantity of the
equipment for that event and period.

*AC2.* Given that the reservation has been successfully made, when the system confirms it, the system should show me
a confirmation of the reservation.

*AC3.* Given that the reservation has been successfully made, when I check the equipment's availability for the
reserved date and time period, the system should show the available quantity reduced by the amount reserved.

*AC4.* Given that the requested quantity exceeds the quantity available for the specified date and time period, when
I attempt to make the reservation, the system should reject the reservation and inform me that it was rejected.

*AC5.* Given that a reservation has been rejected, when I check the equipment's availability for that date and time
period, the system should show the available quantity unchanged.

*AC6.* Given that I have not selected an equipment item, when I attempt to make the reservation, the system should
prompt me to select the equipment.

*AC7.* Given that I have not specified a quantity, when I attempt to make the reservation, the system should prompt me
to specify the quantity.

*AC8.* Given that I have not specified a date and time period, when I attempt to make the reservation, the system
should prompt me to specify the date and time period.

### Tests

| ID | Scenario |
| --- | --- |
| 19-S1 | 10 Projector Units, none reserved: reserving 4 for an eligible event saves one `reserved` row for that event, equipment, quantity and period, by the staff member (AC1). |
| 19-S2 | A successful reservation returns 201 with the event, equipment, quantity, period and the quantity still available; the page shows it as a confirmation (AC2). |
| 19-S3 | After reserving 4 of 10, the SCRUM-18 availability check for an overlapping period reports 6 (AC3). |
| 19-S4 | 4 of 10 already reserved: asking for 8 returns 409 `INSUFFICIENT` with 6 available, and saves nothing (AC4, AC5). |
| 19-S5 | After a rejection, the availability check still reports 6 (AC5). |
| 19-S6 | No equipment chosen: 422 `fieldErrors.equipmentId` "Please select the equipment." (AC6). |
| 19-S7 | No quantity, or not a whole number of at least 1: 422 `fieldErrors.quantity` (AC7). |
| 19-S8 | No date, start or end time: 422 with each missing field's prompt; malformed, end not after start, or in the past: 422 (AC8). |
| 19-S9 | No event chosen: 422 `fieldErrors.eventId` "Please select the event."; an unknown or ineligible event (e.g. draft, cancelled, already started): 422. |
| 19-S10 | Equipment that is damaged, under maintenance or retired cannot be reserved: 409 `INSUFFICIENT` with 0 available. |
| 19-S11 | Peak, not sum: 4 reserved 09:00-12:00 and 4 reserved 13:00-17:00 leave 6 for 09:00-17:00, so reserving 6 succeeds and 7 is refused. |
| 19-S12 | Two reservations for the last units at the same moment: exactly one succeeds, the other is refused (integration test against a real database, in CI). |
| 19-S13 | No session: 401. Any role but Technical Support Staff: 403, on every endpoint (iterates the shared `ROLES` list). |
| 19-S14 | `GET /reservable-events` lists only eligible events that have not started, soonest first. |
| 19-S15 | The equipment cards filter by name as the user types, ignoring case; unusable equipment is greyed out and cannot be selected. |

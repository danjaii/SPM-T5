# Important Change Impact: Final User Story

User story for **See which arrangements an important event change affects, before saving** (ConnectSphere, IS212), compiled
2026-10-15.

- Scenario numbers are the test IDs: `112-S4` means SCRUM-112, Scenario 4.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-112 | Show affected arrangements before an important change is saved | SCRUM-111 (edit event details, `docs/specs/edit-event-details.md`), SCRUM-98 (venue bookings with their own attendance), SCRUM-86 (equipment requests linked to a venue booking) |

SCRUM-113 builds on this: once an important change is confirmed, it sends the affected arrangements back for review.

What the customer documents say:

- Brief, "Impact of Event Changes": "Significant changes, such as date, time, attendance, venue requirements, or equipment
  requirements, may require existing arrangements to be reviewed again."
- Brief, section 2: "Increasing attendance from 80 to 150 people may make the selected venue unsuitable. Changing an event date
  may create a venue or equipment conflict. ... ConnectSphere therefore expects the proposed system to help users identify and
  manage these relationships."
- Brief, "Event Capacity Management": "A significant attendance change may require the suitability of an existing venue booking
  to be reviewed."
- Week 9: each venue is checked independently for suitability and capacity, and the coordinator decides.

## Implementation decisions (2026-10-15)

- **When the warning appears.** Only for an important change (SCRUM-111's list) that affects at least one existing arrangement.
  An ordinary change, or an important change that affects nothing, saves straight away as in SCRUM-111 (AC6). **[DECIDED]**
- **Which arrangements count.** Venue bookings that are pending or approved (holding their venue), and equipment requests that
  are not released or refused (Submitted, Under Review, Arranged). Rejected, withdrawn, cancelled and released ones are ignored.
  **[DECIDED]**
- **What each important field affects.** **[DECIDED]**

  | Changed | Affected | Why it is listed |
  | --- | --- | --- |
  | start or end | each venue booking and equipment request whose period is no longer inside the event's new start and end | "No longer within the event's new time" (AC3) |
  | expected attendance, raised | every venue booking; one whose venue holds fewer people than the new value says so | "Orchid Hall holds 500 people, but the event now expects 600. This venue booking is for 480. The venue may no longer be suitable." (AC2), or "The event now expects 600 people. This venue booking is for 480, and Grand Ballroom holds 800. Check it still suits." |
  | room layout, accessibility needs, venue requirements | every venue booking | "The event's requirements changed; check this venue still suits them" |
  | equipment requirements | every equipment request | "The event's equipment requirements changed" |

  Lowering the attendance lists nothing: fewer people can't make a venue too small. Every venue booking is listed for a raise,
  rather than guessing which ones were meant for the whole event (SCRUM-98 lets a venue booking have its own number, for
  example a 40-seat breakout room): the coordinator decides (week 9). An earlier draft listed only venue bookings whose own
  number equalled the event's old number, but that match is lost after the first saved change, and keeping it would mean
  changing approved venue bookings' numbers without venue staff seeing it. No venue booking's number is changed
  automatically. When SCRUM-109's suitability check merges, the requirements row can use it to list only the venues that
  fail.
- **How the page asks (AC1, AC3 to AC5).** Saving an important change that affects arrangements does not save: event-service
  answers 409 `CONFIRM_IMPACT` with the list. The form shows it, with **Save anyway** and **Go back**. Save anyway sends the same
  edit again with `confirmImpact: true`, which saves it; Go back returns to the form with nothing saved. **[DECIDED]**
- **Each listed arrangement says** its kind (venue booking or equipment request), what it is (venue name, or equipment and
  quantity), its date and times, its status, and why it is listed. **[DECIDED]**
- **Nothing is changed on the arrangements here.** The venue bookings and equipment requests keep their status; SCRUM-113 sends
  the affected ones back for review. Saving is still SCRUM-111's `update_event_details()`, which records it as important.
  **[DECIDED]**
- **Read as the coordinator.** event-service reads the event's venue bookings (with their venues' names and capacities) and
  equipment requests (with the equipment's names) as the signed-in coordinator, so the database's read rules apply. No
  migration. **[DECIDED]**
- **Not in this story:** changing or flagging the arrangements (SCRUM-113), the Confirmed event returning to Planning
  (SCRUM-113), notifications.

---

## SCRUM-112 Show affected arrangements before an important change is saved

**User story.** As the assigned Event Coordinator, I want to see which existing arrangements may be affected by an important
event change before I save it, so that I can understand the impact before confirming the change.

### Acceptance criteria

*AC1 — List affected arrangements.* Given I am changing important event information, when the event has pending or approved
venue bookings or equipment requests that the change affects, then the system lists those arrangements before the change is
saved.

*AC2 — Attendance exceeds venue capacity.* Given an event has an existing venue booking, when I increase the expected attendance
beyond that venue's capacity, then the warning states that the venue may no longer be suitable.

*AC3 — Event time no longer covers existing arrangements.* Given an event has existing venue bookings or equipment requests,
when I change the event date or time so that an arrangement no longer falls within the event period, then I am warned which
arrangements are affected.

*AC4 — Cancel the change.* Given I am shown the list of affected arrangements, when I cancel the change, then the event
information and its arrangements remain unchanged.

*AC5 — Confirm the change.* Given I am shown the list of affected arrangements, when I confirm the change, then the updated event
information is saved.

*AC6 — Important change with no affected arrangements.* Given I make an important change, when no existing arrangement is
affected by it, then the change is saved without a warning.

*AC7 — Validate important changes.* Given I am editing important event information, when I enter an invalid value, then the
change is not saved and I am informed what must be corrected.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 112-S1 | AC1 | An important change that affects a venue booking, without `confirmImpact` | 409 `CONFIRM_IMPACT` with the list; nothing saved |
| 112-S2 | AC1 | Each listed arrangement | its kind, venue or equipment, date and times, status, and the reason |
| 112-S3 | AC1 | Rejected, withdrawn, cancelled venue bookings; released or refused equipment requests | never listed |
| 112-S4 | AC2 | Attendance 480 → 600; a venue booking using the event's 480 at a venue for 500 | listed: the venue holds 500, the event now expects 600 |
| 112-S5 | AC2 | The same, at a venue for 800 | listed, to check: the event's new number, the venue booking's number, the venue's capacity |
| 112-S6 | AC2 | A venue booking with its own attendance (40, at a venue for 50) | listed as may no longer be suitable (it holds 50), with "This venue booking is for 40" so the coordinator can see it is a side room |
| 112-S7 | AC2 | Attendance lowered | no venue booking listed |
| 112-S8 | AC3 | The event moves to another day | each venue booking and equipment request on the old day is listed |
| 112-S9 | AC3 | The end is moved later, so every arrangement is still inside | nothing listed; saved straight away |
| 112-S10 | AC3 | The start is moved later than a venue booking's start | that venue booking is listed |
| 112-S11 | AC1 | Layout, accessibility or venue requirements changed | every active venue booking listed, as "check it still suits" |
| 112-S12 | AC1 | Equipment requirements changed | every active equipment request listed |
| 112-S13 | AC4 | Go back from the warning | nothing sent; the event and the arrangements unchanged |
| 112-S14 | AC5 | Save anyway (`confirmImpact: true`) | saved, recorded as important; the arrangements unchanged |
| 112-S15 | AC6 | An important change with no active arrangements, or none affected | saved without a warning |
| 112-S16 | AC6 | An ordinary change on an event with arrangements | saved without a warning |
| 112-S17 | AC7 | An invalid value in an important field | 422 with the field error; no warning, nothing saved |
| 112-S18 | AC1 | Another coordinator, a finished event | refused as in SCRUM-111 (403, 409 `EVENT_LOCKED`), before any list |

### Test map

- Shared rules (which arrangements are affected, and why): `packages/shared/tests/`.
- event-service (unit, fakes): 112-S1, S3, S13 to S18; the reads of the arrangements (database, CI).
- Web: the warning, Save anyway and Go back.

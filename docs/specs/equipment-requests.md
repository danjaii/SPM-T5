# Equipment Request Management: User Stories

Feature spec for ConnectSphere's Event Planning and Venue Booking System.
Covers Jira stories **SCRUM-86**, **SCRUM-87** and **SCRUM-88**.

Build each acceptance criterion (AC) so it can be tested on its own. "Must have" ACs are required for this release; "Should have" ACs come after.

## Implementation decisions (2026-10-13)

Where this spec meets the existing schema (`supabase/migrations/01_schema.sql`) and code, these decisions apply. They override the spec text below where they conflict.

- **Data model.** An equipment request is a row in the existing `equipment_reservations` table (migration 25 extends it); there is no separate requests table. SCRUM-18 availability and SCRUM-19's `reserve_equipment()` count only `approved` and `reserved` rows, so a new request (`requested`) never reduces availability.
- **Equipment type.** The coordinator picks a specific catalogue item, from a list grouped by the item's type (e.g. "Audio: Wireless Microphone Set"). This is how "equipment type is picked from a list" is met. Retired items are not offered.
- **Field mapping.** Item = `equipment_id`; quantity = `quantity_requested`; technical notes = `notes`; requested by = `requested_by`; venue = `venue_booking_id` (new). The request's start and end are copied from the venue booking.
- **Status mapping.** Submitted = `requested`; Arranged = `approved` or `reserved`; Cannot Fulfil = `rejected`; `cancelled` rows are not shown. Under Review = `under_review` (new enum value, migration 31).
- **Existing rows.** Every row for an event is shown as one of its requests, including reservations made before this feature (they show "No venue").
- **Finished events.** Requests cannot be created when the event is Completed, Cancelled **or Rejected**.
- **Venue.** Only the event's **approved** venue bookings are offered, meaning the ones the venue pages show as Approved (legacy `tentative` and `confirmed` rows included). Open question 1 is answered as: a venue is required.
- **Quantity message.** Equipment requests use "Quantity must be a whole number of 1 or more"; the SCRUM-18/19 forms keep their own wording.
- **Where the assumptions live.** Each open-question rule is one constant in `packages/shared/src/equipmentRequest.ts`; the database copy of the finished-event rule is kept equal to it by an integration test.

SCRUM-87 decisions (2026-10-14):

- **Arranged checks availability.** Arranged (`approved`) holds units, so it is refused when too few units of the item are free in the request's period, using SCRUM-18's rule. The check and the save are one step in the database (`review_equipment_request()`, migration 32), like SCRUM-19's `reserve_equipment()`. This goes beyond "Checking if equipment is available" being out of scope, to stop equipment being promised twice.
- **Cannot Fulfil reason** is stored on the request (`review_reason`), up to 500 characters. AC8 (notes with author and time) is not built in this story.
- **Finished events.** Requests for a Completed, Cancelled or Rejected event are left out of the queue and cannot be changed (same list as SCRUM-86/AC6).
- **AC6 readiness.** Shown on the event as Complete or Incomplete; an event with no requests (cancelled ones do not count) shows neither. Open question 3 is assumed yes: `EQUIPMENT_READY_STATUSES`.
- **Queue order.** Soonest event first (the event's date, or the request's own date when the event has none), then the oldest request.
- **AC7.** Only Technical Support Staff see the queue and change a status: equipment-service refuses everyone else (403), and migration 32 adds a restrictive update policy so a direct database update by anyone else changes nothing. Technical Support Staff can now read the venue bookings that requests name, so the venue shows.

SCRUM-88 decisions (2026-10-15):

- **Scope.** AC1 to AC6 and AC8 are built. AC7 (a new safety check when equipment changes after the Safety Officer approved) is not: the safety check is SCRUM-111 to 113. AC9 (old details next to new) is not built.
- **How a change is saved.** Migration 32 lets only Technical Support Staff update a request directly, so the coordinator's change goes through one database function, `update_equipment_request()` (migration 37). It checks the caller is the event's assigned coordinator (which follows a Lead's reassignment, AC5), the event is not finished (AC4), the request is not Released, and the venue is one of the event's approved bookings, then saves.
- **Back to Submitted (AC2, open question 6).** Any change, the notes alone included, sends the request back to Submitted. Its last review is cleared (who reviewed it, when, the Cannot Fulfil reason), and an Arranged request stops holding its units.
- **Updated.** Technical Support Staff see a request marked Updated when the coordinator changed it and it is still Submitted, so the mark goes once they change its status.
- **Which requests can be changed.** Submitted, Under Review, Arranged and Cannot Fulfil. Released ones (SCRUM-102) cannot, because their venue booking was cancelled.
- **Who changed it (AC8).** `last_edited_by` and `last_edited_at` record the coordinator's changes only, not status changes by staff. The coordinator (on the event) and Technical Support Staff (on the request) see the name and the Singapore date and time.
- **An item or venue no longer offered.** If the request's item was retired, or its venue booking is no longer approved, the change form starts with that field unchosen, so the coordinator picks again.

---

## Shared rules (apply to all three stories)

### Roles

| Role | What they do in this feature |
|---|---|
| Event Coordinator | Creates and edits equipment requests for events assigned to them |
| Technical Support Staff | Reviews requests and updates their status |
| Event Coordinator Lead | Assigns and moves events between coordinators |
| Safety Officer | Approves events in the safety check |

### Request statuses

| Status | Meaning |
|---|---|
| Submitted | Waiting for Technical Support Staff |
| Under Review | Technical Support Staff are checking it |
| Arranged | The equipment is ready |
| Cannot Fulfil | The equipment can't be provided (a reason is given) |

### Validation

- **Equipment type:** required, picked from a list.
- **Quantity:** required, a whole number of 1 or more.
- **Venue:** required, picked from the event's venue bookings.
- **Technical notes:** optional.

### Permissions

- Only the Event Coordinator **currently assigned** to an event can create or edit its equipment requests.
- Only Technical Support Staff can change a request's status.
- Requests cannot be created or edited when the event is **Completed** or **Cancelled**.

---

## SCRUM-86: Create Equipment Request

### User story

As an **Event Coordinator**,
I want to **request the equipment my event needs**,
so that **Technical Support Staff know what to prepare, without using email or spreadsheets**.

### Acceptance criteria

#### Must have

**AC1: Create a request**
- **Given** I am the coordinator assigned to the event, and the event is not Completed or Cancelled
- **When** I fill in the equipment type, quantity and venue, and submit
- **Then** the request is saved with the status **Submitted**
- Equipment type is picked from a list. Technical notes are optional.

**AC2: See the request**
- **Given** I have submitted a request
- **When** I open the event
- **Then** I see the request's equipment type, quantity, venue, notes and status

**AC3: Several requests per event**
- **Given** the event already has a request
- **When** I submit a request for a different equipment type
- **Then** both requests are shown, each with its own status

**AC4: Missing information**
- **Given** I left the equipment type, quantity or venue empty
- **When** I submit
- **Then** the request is not saved, the empty fields are highlighted, and what I typed is kept

**AC5: Wrong quantity**
- **Given** the quantity is 0, negative, a decimal or not a number
- **When** I submit
- **Then** the request is not saved and I see the message "Quantity must be a whole number of 1 or more"

**AC6: Finished events**
- **Given** the event is Completed or Cancelled
- **When** I open the event
- **Then** I cannot create a request

**AC7: Only the assigned coordinator**
- **Given** I am not the coordinator assigned to the event
- **When** I open the event
- **Then** I cannot create a request

---

## SCRUM-87: Review Equipment Request

### User story

As a **Technical Support Staff member**,
I want to **see the equipment requests waiting for me and update their status**,
so that **I can plan ahead, and the Event Coordinator knows if the equipment is ready**.

### Acceptance criteria

#### Must have

**AC1: See the list of requests**
- **Given** there are requests that are Submitted or Under Review
- **When** I open the equipment request list
- **Then** I see them with the soonest event first
- Each row shows: event name, event date, venue, equipment type, quantity, status.

**AC2: Empty list**
- **Given** there are no Submitted or Under Review requests
- **When** I open the list
- **Then** I see the message "No requests waiting for action"

**AC3: See request details**
- **Given** I am on the list
- **When** I open a request
- **Then** I see: event name, event date, start and end time, venue, equipment type, quantity, notes, status

**AC4: Update the status**
- **Given** a request is Submitted or Under Review
- **When** I change it to Under Review, Arranged or Cannot Fulfil and save
- **Then** the new status is saved and the coordinator can see it on the event

**AC5: Give a reason for Cannot Fulfil**
- **Given** I choose Cannot Fulfil
- **When** I save without a reason
- **Then** the status does not change and I am asked for a reason
- Once saved, the coordinator can read the reason.

**AC6: Equipment ready for the event**
- **Given** an event has one or more requests
- **When** all of them are Arranged
- **Then** the event shows equipment as **Complete**
- If any request is Submitted, Under Review or Cannot Fulfil, the event shows equipment as **Incomplete**.

**AC7: Only Technical Support Staff**
- **Given** I am not Technical Support Staff
- **When** I try to change a request's status
- **Then** I am blocked and the status stays the same

#### Should have

**AC8: Add notes**
- **Given** I have opened a request
- **When** I add a note and save
- **Then** the note shows my name and the date and time, and the coordinator can read it

### Not in this story

- Checking if equipment is available.
- Reserving equipment.

AC6 tells the Safety Officer when the equipment is ready for the safety check.

---

## SCRUM-88: Update Equipment Requirements

### User story

As an **Event Coordinator**,
I want to **change an equipment request when my event's needs change**,
so that **Technical Support Staff always prepare the right equipment**.

### Acceptance criteria

#### Must have

**AC1: Edit a request**
- **Given** I am the coordinator assigned to the event, and the event is not Completed or Cancelled
- **When** I change the equipment type, quantity, venue or notes and save
- **Then** the new details replace the old ones for me and for Technical Support Staff

**AC2: Send it back for review**
- **Given** a request is Under Review, Arranged or Cannot Fulfil
- **When** I save a change
- **Then** the status goes back to **Submitted** and Technical Support Staff see it marked **Updated**

**AC3: Wrong information**
- **Given** I removed the equipment type, or the quantity is not a whole number of 1 or more
- **When** I save
- **Then** nothing is saved, the old details are kept, and I am told what to fix

**AC4: Finished events**
- **Given** the event is Completed or Cancelled
- **When** I open its requests
- **Then** I cannot edit them

**AC5: Event moved to me**
- **Given** the Event Coordinator Lead has moved the event to me
- **When** I open its requests
- **Then** I can edit them, and the previous coordinator cannot

**AC6: Only the assigned coordinator**
- **Given** I am not the coordinator assigned to the event
- **When** I open its requests
- **Then** I cannot edit them

**AC7: Change after the safety check**
- **Given** the Safety Officer has already approved the event
- **When** I change a request's equipment type, quantity or venue
- **Then** the event needs a new safety check

#### Should have

**AC8: Who changed it**
- **Given** a request has been edited
- **When** a coordinator or Technical Support Staff member opens it
- **Then** they see who last changed it, and the date and time

**AC9: What changed**
- **Given** a request has been edited
- **When** Technical Support Staff open it
- **Then** they see the old details next to the new ones

---

## Open questions (not yet confirmed by the customer)

These rules are assumptions. Build them so they are easy to change later.

1. Must every request name a venue? Can a request be made before a venue is booked? (SCRUM-86 AC1, AC4)
2. Does ConnectSphere keep a fixed list of equipment types? (SCRUM-86 AC1)
3. Is equipment only ready for the safety check when every request is Arranged? (SCRUM-87 AC6)
4. Can the Safety Officer and Event Coordinator Lead see equipment requests? (SCRUM-87)
5. Does changing equipment after safety approval need a new safety check? (SCRUM-88 AC7)
6. If only the notes change, should the request still go back to Submitted? (SCRUM-88 AC2)

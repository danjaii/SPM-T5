# Tell the Organiser and Attendees When Replacement Arrangements Are Confirmed: Final User Story

User story for the **AC3** part of SCRUM-185 ([Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to Planning, and
a Block Can Be Lifted), ConnectSphere, IS212, compiled 2026-11-03.

- Scenario numbers are the test IDs: `185-S3` means SCRUM-185, the scenario for **AC3**.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.
- Written before the code. It builds on AC1 (`venue-block-reverts-event.md`, which returns a Confirmed event to Planning) and on
  SCRUM-171 (`operational-safety-check.md`, which starts the safety check when the last arrangement is approved).

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-185 | [Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to Planning, and a Block Can Be Lifted | AC1 (the return to Planning), SCRUM-107 (replacement venue), SCRUM-171 (the automatic start), SCRUM-172 (attendee notifications) |

## Why

After a block returns a Confirmed event to Planning (AC1), only its coordinator is told. The organiser and the attendees, who
registered for a Confirmed event, hear nothing while the coordinator finds a replacement venue, and nothing when it is found. The
customer said in the Week 9 Q&A that they are told once the replacement arrangements are confirmed, not before (row 52).
**[DECIDED]**

## Implementation decisions

- **When.** The moment the last open arrangement of the event is approved and the event moves from Planning to Awaiting
  Arrangements (SCRUM-171's `start_safety_check_when_arranged()`, migration 66): that is "the last one is approved". The notice is
  written in the same transaction, in the same function. **[DECIDED]**
- **Only after a venue block.** The function checks the event's status history: the **most recent** row that moved the event
  to Planning must be Confirmed to Planning made by a **Venue Staff** member (the only way a block does it, AC1). An event
  returned to Planning for another reason (a Safety Officer's rejection or change request, or a coordinator's own status
  change) gets no notice, and neither does an event that moves to Awaiting Arrangements later for the usual reasons. The rule
  needs no new column and no marker row, and it fires once per return to Planning, because the next return makes that row
  the most recent one. **[PROPOSED]** The alternative (a flag column on `events`) was rejected because it needs a schema
  change and every test that compares whole event rows.
- **Who.** The event's **organiser**, and every attendee with an **active registration** (`waitlisted` or `registered`, the
  rule of `event_update_attendees()`, SCRUM-172; a withdrawn or cancelled registration gets nothing). One notice each, even for
  a person who is both. The Venue Staff or Technical Support member who approved the last arrangement is not notified of their
  own action. The coordinator is not sent this notice (they made the arrangements). **[DECIDED]**
- **What it says.** Type `arrangements_reconfirmed`, title "Arrangements confirmed", message naming the event and its current
  venue(s) (the approved or confirmed bookings), and saying the event will be confirmed once its safety check is done:
  `<event>: replacement arrangements are confirmed. Venue: <venue>. The event will be confirmed once its safety check is done.`
  It does not name the venue that was blocked or why. **[PROPOSED]**
- **For information only.** It is not marked "Action needed". **[PROPOSED]**
- **Nothing earlier.** No notice to the organiser or attendees when the block is saved or the event returns to Planning (the
  customer's wording). **[DECIDED]**

## Scenarios

### 185-S3 (AC3) The last arrangement is approved after a block

- **Given** an event that a venue block returned to Planning, with a replacement venue booking waiting for approval, an organiser,
  an attendee registered (Confirmed), an attendee Pending, and an attendee who withdrew
- **When** Venue Staff approve the replacement booking, the last open arrangement
- **Then** the event moves to Awaiting Arrangements, and the organiser, the Confirmed attendee and the Pending attendee each
  have one "Arrangements confirmed" notification naming the new venue; the withdrawn attendee, the coordinator and the Venue
  Staff member have none.

### 185-S3b Not the last arrangement

- **Given** the same event, with an equipment request still unarranged
- **When** the replacement venue booking is approved
- **Then** nobody is notified; when the equipment is arranged afterwards, the notices are sent then.

### 185-S3c Not after a block

- **Given** an event returned to Planning by a Safety Officer's rejection, or by its coordinator
- **When** its last arrangement is approved
- **Then** it moves to Awaiting Arrangements as before and the organiser and attendees get no "Arrangements confirmed" notice.

### 185-S3d Once per return

- **Given** an event that went back to Planning after a block, was arranged again (notice sent), was rejected by the Safety
  Officer (Planning again) and arranged again
- **When** its last arrangement is approved the second time
- **Then** no second notice is sent.

### 185-S3e The screen

- **Given** the organiser's or attendee's notifications page
- **When** the notice has been sent
- **Then** it is listed with its own icon and label (never colour alone), without "Action needed".

## Out of scope

Email or SMS (notifications are in-app only), the safety check itself, registration changes (AC4), and any notice when the event
returns to Confirmed after the safety check (existing `event_confirmed` notice, SCRUM-172).

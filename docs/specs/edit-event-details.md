# Coordinator Edits Event Details: Final User Story

User story for **Update an event's planning information** (ConnectSphere, IS212), compiled 2026-10-15.

- Scenario numbers are the test IDs: `111-S4` means SCRUM-111, Scenario 4.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-111 | Coordinator edits event details | events RLS (`14_events_rls.sql`), coordinator assignment (SCRUM-78/79) |

SCRUM-112 (show the arrangements an important change affects, before saving) and SCRUM-113 (send them back for review, and a
Confirmed event back to Planning) build on this story's save. SCRUM-67 (review an organiser's change request) will apply an
approved request through the same save.

What the customer documents say (they set the scope):

- Brief, "Event Information Management": "Authorised users can update relevant event information during planning. The system
  should distinguish between ordinary edits and changes that may affect arrangements already confirmed."
- Brief, "Impact of Event Changes": "Significant changes, such as date, time, attendance, venue requirements, or equipment
  requirements, may require existing arrangements to be reviewed again." These are the important fields.
- Brief, "Change History", "Auditability", and the pain point "it is difficult to determine who changed important event
  information and when": record what changed, who changed it and when (AC4).
- Brief, section 2: changes occur "after an event has been proposed or even after it has been confirmed"; week 4: "the
  co-ordinator will make relevant changes to the event according to the agreement with the organiser". So a Confirmed event
  can be edited (AC6 only blocks finished events).
- Week 9: "the lead is not able to coordinate event", so only the assigned coordinator edits (AC7).

## Implementation decisions (2026-10-15)

- **Who and when.** Only the event's current assigned coordinator (a Lead's reassignment moves the right with it), and only
  while the event has a coordinator and is not finished: Submitted, Under review, Returned, Approved, Planning, Awaiting
  arrangements or Confirmed. Completed, Cancelled and Rejected events can't be edited (`isClosedEventStatus`, AC6); a Draft has
  no coordinator. Anyone else gets 403. **[DECIDED]**
- **Ordinary and important fields (AC1, AC2).** Ordinary: name, description, purpose, category. Important: start and end date
  and time, expected attendance, room layout, accessibility needs, venue requirements, equipment requirements (the brief's
  list). The form shows them in two groups, and each important field is marked "Important: may affect venue or equipment
  arrangements". The lists live once in `packages/shared` so the form and the service agree. **[DECIDED]**
- **In this story an important change is saved like an ordinary one,** and recorded as important. SCRUM-112 adds the warning
  before saving, and SCRUM-113 what happens to the arrangements. **[DECIDED]**
- **Required (AC3):** name, start, end and expected attendance (a whole number of 1 or more). The end must be after the start;
  a changed start must not be in the past (the same rule as a change request, SCRUM-66). Description, purpose, category, layout,
  accessibility, venue and equipment requirements may be left empty. Text fields are trimmed and at most 2000 characters (the
  name at most 200). Validation is one shared function, used by the form and the service. **[DECIDED]**
- **Nothing changed is refused (`NO_CHANGES`),** so the history only holds real changes. **[DECIDED]**
- **Venue requirements gets a column.** `events` has none; migration 34 adds `venue_requirements text` with `if not exists`.
  SCRUM-49's unmerged branch adds the same column; its owner should renumber its migration and add `if not exists`, so
  whichever merges first, the other still works. **[DECIDED]**
- **Change history (AC4).** A new table, `event_change_history`: one row per save, with the event, who, when, whether it
  included an important field, and `changes` (each changed field as `{ from, to }`). It is shown on the event page, newest
  first, to the event's assigned coordinator and its organiser: when, who, each field's old and new value, and an "Important"
  tag. Nobody can write it directly; only the save function does. **[DECIDED]**
- **Done in the database, in one step.** Coordinators may only update an event's status and coordinator directly (migration
  14's column grants). So the save goes through a security definer function, `update_event_details()` (migration 34; 31 to 33 are SCRUM-87 and SCRUM-88's), which
  checks the caller and the event, refuses `NO_CHANGES`, updates the event and writes the history row together. **[DECIDED]**
- **Latest information shown (AC5).** The event page shows the saved values, including description, category and venue
  requirements, which it does not show yet. **[DECIDED]**
- **API (event-service).** `GET /events/:id/edit-form` (the current values plus the categories and room layouts to choose from;
  assigned coordinator only), `PATCH /events/:id` (the edit; returns the saved event and what changed), `GET
  /events/:id/change-history` (coordinator and organiser). **[PROPOSED]**
- **The pages.** An "Edit event details" button on the event page for the assigned coordinator while the event can be edited;
  the form at `/events/[id]/edit`; after saving, back to the event page with "Event details saved.". **[PROPOSED]**
- **Not in this story:** registration settings (capacity, opening and closing), the organiser, the client organisation,
  notifications.

---

## SCRUM-111 Coordinator edits event details

**User story.** As the assigned Event Coordinator, I want to update an event's planning information, so that everyone works from
the latest event details without unnecessarily affecting confirmed arrangements.

### Acceptance criteria

*AC1 — Edit ordinary event details.* Given I am the assigned Event Coordinator for an active event, when I update ordinary
event information such as the event name, description, purpose, or category, then the changes are saved without requiring
existing venue or equipment arrangements to be reviewed again.

*AC2 — Identify important changes.* Given I am editing an event, when the event's fields are displayed, then important fields
such as date, time, expected attendance, venue requirements, room layout, accessibility needs, and equipment requirements are
clearly identified.

*AC3 — Validate required information.* Given I am editing an event, when I remove required information and attempt to save,
then the changes are not saved and I am informed what information is required.

*AC4 — Record changes.* Given event information is successfully updated, then the system records what changed, who made the
change, and when.

*AC5 — Show the latest information.* Given event information has been successfully updated, when an authorised user views the
event, then the latest saved information is displayed.

*AC6 — Prevent editing of finished events.* Given an event is completed, cancelled, or rejected, when I view the event, then I
cannot edit its planning information.

*AC7 — Restrict editing.* Given I am not the Event Coordinator assigned to the event, when I view the event, then I cannot edit
its planning information through this workflow.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 111-S1 | AC1 | Change the name, description, purpose and category | 200; saved; the venue bookings and equipment requests are unchanged |
| 111-S2 | AC1 | Change only one ordinary field | only that field changes |
| 111-S3 | AC1 | A Confirmed event, an ordinary change | saved; the event stays Confirmed |
| 111-S4 | AC2 | `GET /events/:id/edit-form` | the current values, the categories and room layouts to choose from, and which fields are important |
| 111-S5 | AC2 | The form | ordinary and important fields in two groups; each important field marked |
| 111-S6 | AC2 | Change an important field (attendance, dates, layout, accessibility, venue or equipment requirements) | saved, and recorded as important |
| 111-S7 | AC3 | Name, start, end or attendance left empty | 422 with a field error for each; nothing saved |
| 111-S8 | AC3 | End not after start; attendance 0, negative or a fraction; a changed start in the past; text over its limit | 422 with field errors; nothing saved |
| 111-S9 | AC3 | An unknown category or layout | 422 |
| 111-S10 | AC3 | The form shows the shared messages before sending | nothing is sent |
| 111-S11 | AC4 | A successful save | one history row: who, when, each changed field `{ from, to }`, important or not |
| 111-S12 | AC4 | Nothing actually changed | 409 `NO_CHANGES`; no history row |
| 111-S13 | AC4 | The event page, for the coordinator and for the organiser | the history, newest first, with old and new values and the Important tag |
| 111-S14 | AC4 | Anyone else asks for the history | 403 or 404, as for the event |
| 111-S15 | AC5 | After saving | the event page shows the new values, including description, category and venue requirements |
| 111-S16 | AC6 | The event is Completed, Cancelled or Rejected | no Edit button; `PATCH` is 409 `EVENT_LOCKED` |
| 111-S17 | AC7 | Another coordinator, the Lead, the organiser, venue staff, technical support, an attendee | no Edit button; `PATCH` and the edit form are 403; no session 401 |
| 111-S18 | AC7 | The coordinator the event was moved away from | 403; the coordinator who took it over can edit |
| 111-S19 | AC7 | Calling `update_event_details()` directly as someone else | refused; nothing changes (database test) |

### Test map

- Shared rules (field lists, validation): `packages/shared/tests/`.
- Service (unit, fakes): 111-S1 to S3, S6 to S9, S11, S12, S16 to S18. Database (integration, CI): S11, S12, S16, S18, S19.
- Web: 111-S5, S10, S13, S15 to S17.

### Questions for the customer (none block the build)

1. Should the organiser be notified when the coordinator changes their event's details? (Notifications are not built yet.)

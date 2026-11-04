# Coordinator History Rows Only for the Coordinator's Own Events: Final User Story

User story for **[Authorisation] Coordinator History Rows Only for the Coordinator's Own Events** (ConnectSphere, IS212), compiled 2026-11-02.

- Scenario numbers are the test IDs: `183-S2` means SCRUM-183, Scenario 2. The three acceptance criteria are numbered 1 to 3 as in the Jira story, and **Scenario n is AC n**.
- Markers: **[DECIDED]** settled by an earlier spec, the schema or the code as it is. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-183 | [Authorisation] Coordinator History Rows Only for the Coordinator's Own Events | `07_venue_bookings_rls.sql` (`is_assigned_coordinator()`), `14_events_rls.sql` (the policy being replaced) |

Why: the customer says access follows "the user's role and direct relationship to an event" (Week 9 answers, row 15) and that
coordinators only manage the events the Lead gives them (row 36). Every other child table of `events` already follows that
(SCRUM-91, SCRUM-156). One rule does not. The insert policy of `event_coordinator_history` (migration 14) checks that the caller is
a coordinator and that `assigned_by` is the caller, but not that the event is theirs, so **any coordinator can add a history row
to any event**, including one assigned to another coordinator. It was recorded as a known gap in `REQUIREMENTS_STATUS.md`
(feature 1, point b) and in ADR 0003's follow-ups. The row is an audit trail: a false row says that a coordinator was
assigned to an event they have nothing to do with.

## Implementation decisions (2026-11-02)

- **The rule [DECIDED].** A coordinator may insert a `event_coordinator_history` row only when they are the event's assigned
  coordinator (`public.is_assigned_coordinator(event_id)`, the same helper the `event_status_history` insert policy uses on the
  line above it in migration 14), and `assigned_by` is themselves, as before. Migration 77 drops and re-creates
  `event_coordinator_history_insert`; migration 14 is not edited.
- **Nothing else changes [DECIDED].** The select policy, the revoked update and delete, the columns, and every other role's
  access stay as they are. No other role could insert before (the check names `event_coordinator`), and none can now.
- **Existing flows are unaffected [DECIDED, checked in the code].** No service and no page writes this table. The Lead's assign and
  reassign (migrations 23 and 24) write `coordinator_assignment_logs` from `security definer` functions, and the seed script writes
  history rows with the secret key, which bypasses row level security. So the only inserts this rule can refuse are direct
  inserts made as a coordinator, which is exactly what the story closes.
- **The row's `coordinator_id` is not constrained [PROPOSED].** The story is about whose event it is, not who the history row
  names. A coordinator recording history on their own event for the previous or next coordinator stays allowed. Tightening that
  would be a different rule and nobody asked for it.
- **A reassigned event moves with the coordinator [DECIDED, SCRUM-156].** Once the Lead reassigns an event, the previous
  coordinator is no longer its assigned coordinator, so they can no longer add history to it. That follows from using the
  helper and needs no extra code.

## SCRUM-183 Coordinator History Rows Only for the Coordinator's Own Events

**User story.** As the system owner, I want a coordinator to be able to add a coordinator-history row only for an event assigned
to them, so that role-and-relationship access holds on this table the way it does on the others.

### Acceptance criteria

*AC1.* Given I am an Event Coordinator assigned to an event, when I add a coordinator-history row for that event as myself, then
the row is saved.

*AC2.* Given I am an Event Coordinator who is not assigned to an event, when I try to add a coordinator-history row for that
event, then the insert is refused by the database.

*AC3.* Given the Lead assigns or reassigns a coordinator, or a coordinator takes an assigned event through review, when the
history row is written, then the flow completes as before.

### Tests

| ID | Scenario |
| --- | --- |
| 183-S1 | The assigned coordinator inserts a row for their event with `assigned_by` set to themselves, and it is saved and readable (AC1). A coordinator still may not put someone else's name in `assigned_by`, even on their own event. |
| 183-S2 | A coordinator who is not assigned to the event is refused (`42501`), whether the event is assigned to another coordinator or to nobody, and whether the row names themselves or the assigned coordinator, and no row is written. The previous coordinator of a reassigned event is refused too. The organiser, the Lead, Venue Staff, Technical Support Staff, the Safety Officer and an attendee are still refused (AC2). |
| 183-S3 | The Lead assigns and then reassigns an event through `lead_assign_coordinator` and `lead_reassign_coordinator`, and both succeed and write their `coordinator_assignment_logs` row. The assigned coordinator takes the event through review (`submitted` to `under_review`) and the status change is saved. Neither touches `event_coordinator_history` (AC3). |
| 183-S4 | The policy is the only change: the history rows nobody may change are still unchangeable (update and delete are denied for the assigned coordinator), and a row that already exists stays readable by the organiser and the assigned coordinator (AC1, AC3). |

### Out of scope

- Leads reading every event system-wide (W9 r37). It is a separate gap with its own story (the Lead scope work).
- Stopping a coordinator from naming someone else in `coordinator_id` on their own event.
- Writing history rows automatically when an event is assigned. Today nothing does; the Lead's log is `coordinator_assignment_logs`.

### Open questions

1. **Should `coordinator_id` have to be the assigned coordinator too?** Default: no (see above). If the team wants history rows to describe only the
   current assignment, add `and coordinator_id = auth.uid()` to the check; no test here depends on the answer except 183-S1,
   which would then use their own id.

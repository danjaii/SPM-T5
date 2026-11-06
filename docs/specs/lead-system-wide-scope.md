# The Lead Sees and Assigns Across All Coordinators: Final User Story

User story for SCRUM-184 ([Event Coordinator Lead] The Lead Sees and Assigns Across All Coordinators), ConnectSphere, IS212,
compiled 2026-11-03.

- Scenario numbers are the test IDs: `184-S2` means SCRUM-184, Scenario 2, which is AC2.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.
- Written before the code.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-184 | [Event Coordinator Lead] The Lead Sees and Assigns Across All Coordinators | SCRUM-75 to SCRUM-81 (the Lead role, queue, assign, reassign, overview), SCRUM-156 (coordinator reads) |

## Why

Today the database limits a Lead to the coordinators linked to them (`users.supervising_lead_id`): the overview lists only
those coordinators, assigning or reassigning to anyone else is refused, and a Lead reads only the events held by their own
coordinators. The customer's later answers say the Lead works system-wide: sees every unassigned request, every active
assignment, and can assign any event to any coordinator with no workload limit (Week 9 Q&A, rows 16, 17, 24, 31, 37, 61).
One answer (row 58, "done by him") reads the other way; the team decided on 2026-11-03 to follow the system-wide reading.
**[DECIDED]**

## Implementation decisions

- **The link stays, nothing uses it for access.** `users.supervising_lead_id` and its trigger (migration 19) are left as they
  are: it is data an admin may still record, but no Lead function, policy or screen depends on it any more. **[DECIDED]**
- **One new helper, `is_coordinator(user)`**, replaces `is_my_coordinator(user)` (migration 22): true when the user is an
  Event Coordinator, whoever supervises them. Migration 81 re-creates every function and policy that used the old helper
  and then drops it. Callers still check `is_active` themselves where it matters. **[DECIDED]**
- **What changes, in one migration (81):**
  1. `events_select_lead_team` lets a Lead read every event that has an assigned coordinator (the unassigned policy of
     migration 21 already lets them read unassigned submitted events), so together a Lead reads every submitted event.
  2. `lead_coordinator_overview()` lists every active coordinator with their workload (non-closed events), not only linked ones.
  3. `lead_coordinator_events(coordinator)` works for any active coordinator.
  4. `lead_assign_coordinator()` and `lead_reassign_coordinator()` accept any active coordinator as the target, and reassign
     accepts an event held by any coordinator. No workload cap. The refusal `CL005` (held by another Lead's coordinator)
     can no longer happen and is removed.
  5. `lead_queue_summary()` counts every active event with an assigned coordinator, not only the Lead's team's. **[DECIDED]**
- **Draft events stay private.** A Lead never reads a draft (as before: the unassigned policy requires `status <> 'draft'`,
  and the team policy reads only events with a coordinator, which a draft does not have through the app). **[PROPOSED]**
- **Everyone else is unchanged.** A coordinator still reads only the events assigned to them (SCRUM-156); organisers,
  attendees and the other roles see what they saw before; non-Leads are refused by the Lead functions (`42501`). **[DECIDED]**
- **Refusals that remain.** A deactivated coordinator, or a user who is not a coordinator, is still not a valid target
  (`CL003`), and is still not listed. A closed event cannot be reassigned (`CL001`). Reassigning to the coordinator who
  already holds the event is still refused (`CL006`). **[DECIDED]**
- **Wording.** `CL003` becomes "Choose an active coordinator." and the events refusal becomes "You can only view an active
  coordinator's events." because neither is about supervision any more. **[PROPOSED]**
- **Not in this story.** A Lead still cannot read comments or history of events they do not hold; that is tracked separately
  in `REQUIREMENTS_STATUS.md`. Notifications to Leads were already for every active Lead (migration 65).

## Scenarios

### 184-S1 (AC1) Every unassigned request

- **Given** several Leads, and a submitted event with no coordinator
- **When** any Lead opens the unassigned queue
- **Then** they see it, whichever Lead's coordinators exist or not.

### 184-S2 (AC2) Every active assignment

- **Given** events assigned to coordinators linked to another Lead, to a coordinator linked to no Lead, and to one of my own
- **When** I open the coordinator overview and a coordinator's events
- **Then** every active coordinator is listed with their workload, and I can list the non-closed events of any of them; a
  deactivated coordinator is still not listed and is refused.

### 184-S3 (AC3) Assign or reassign to any coordinator

- **Given** an unassigned event, and an event held by a coordinator another Lead supervises
- **When** I assign the first, and reassign the second, to any active coordinator
- **Then** it is done and logged, with no limit on that coordinator's workload; a deactivated coordinator, a user who is not
  a coordinator, a closed event and a same-coordinator reassignment are still refused.

### 184-S4 (AC4) Everyone else is unchanged

- **Given** a coordinator, an organiser, an attendee, or any role other than Lead
- **When** they use the same functions or read events
- **Then** the Lead functions refuse them (`42501`); a coordinator still reads only the events assigned to them; a Lead
  still cannot read a draft.

### 184-S5 (AC1, AC2) The Lead's queue summary

- **Given** active events assigned to coordinators linked to different Leads
- **When** a Lead opens the queue summary
- **Then** "events this month" counts all of them, not only their own team's.

## Out of scope

Comments and history of events the Lead does not hold; changing or removing `supervising_lead_id`; a Lead-to-coordinator
admin screen; workload caps (the customer said there is none).

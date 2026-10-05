# Coordinator Assignment — User Stories

This document contains the user stories and acceptance criteria for **Coordinator Assignment** in the `SCRUM` project.

---

## 1. [SCRUM-42] — [Coordinator Assignment] — Assign Event to Coordinator

- **Issue Key:** [SCRUM-42](https://is212-g1t5.atlassian.net/browse/SCRUM-42)
- **Type:** Story
- **Status:** To Do
- **Priority:** Medium
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong

### User Story
As an **authorised staff member**,  
I want to **assign an unassigned event to an available Event Coordinator**,  
so that **someone is clearly responsible for coordinating the event**.

### Acceptance Criteria
- **AC1 — View eligible coordinators**  
  Given an event has not yet been assigned,  
  And I am authorised to assign coordinators,  
  When I choose to assign the event,  
  Then I can see the Event Coordinators who are eligible to manage it.

- **AC2 — Eligible coordinator**  
  Given I am selecting a coordinator,  
  Then a coordinator is considered eligible when they:
  - Have permission to coordinate events
  - Have an active user account
  - Are eligible to manage the selected event

- **AC3 — Assign coordinator**  
  Given I have selected an eligible Event Coordinator,  
  When I confirm the assignment,  
  Then that coordinator becomes the assigned coordinator for the event.

- **AC4 — Update coordinator's event list**  
  Given an event has been successfully assigned,  
  When the assigned coordinator views their active events,  
  Then the event is displayed in their active event list.

- **AC5 — Update point of contact**  
  Given an event has been successfully assigned,  
  When the assignment is completed,  
  Then the assigned coordinator becomes the Event Organiser's internal point of contact for that event.

- **AC6 — Record assignment**  
  Given an event has been successfully assigned,  
  Then the system records:
  - Who performed the assignment
  - Who the event was assigned to
  - Date and time of assignment

- **AC7 — No eligible coordinator**  
  Given no eligible coordinators are available,  
  When I attempt to assign the event,  
  Then I am informed that no eligible coordinator is currently available,  
  And the event remains unassigned.

- **AC8 — Authorisation**  
  Given I am not authorised to assign Event Coordinators,  
  When I view the event,  
  Then the coordinator assignment action is not available to me.

---

## 2. [SCRUM-41] — [Coordinator Assignment] — Reassign an Event to Another Coordinator

- **Issue Key:** [SCRUM-41](https://is212-g1t5.atlassian.net/browse/SCRUM-41)
- **Type:** Story
- **Status:** To Do
- **Priority:** Medium
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong

### User Story
As an **authorised Event Coordinator**,  
I want to **reassign an active event to another available coordinator**,  
so that **changes in staff availability or responsibilities do not delay the event's progress**.

### Acceptance Criteria
- **AC1 — Reassign an assigned event**  
  Given I am authorised to reassign an active event,  
  And I am currently assigned to the event,  
  When I choose to reassign the event,  
  Then I can select another eligible and available Event Coordinator to take over.

- **AC2 — Define an available coordinator**  
  Given I am selecting a new coordinator,  
  When the list of coordinators is displayed,  
  Then only coordinators who:
  - Have permission to manage events
  - Are currently active users
  - Are eligible to manage the event  
  are available for selection.

- **AC3 — Complete reassignment**  
  Given I have selected an eligible coordinator,  
  When I confirm the reassignment,  
  Then the selected coordinator becomes the assigned coordinator for the event.

- **AC4 — Update active event lists**  
  Given the reassignment has been completed successfully,  
  When the previous coordinator views their active events,  
  Then the reassigned event is no longer shown in their active event list.  
  And when the newly assigned coordinator views their active events,  
  Then the event is shown in their active event list.

- **AC5 — Previous coordinator retains read-only access**  
  Given I was previously assigned to the event,  
  When the event is reassigned to another coordinator,  
  Then I can still view the event in read-only mode if my role permits historical access.  
  And I cannot perform actions that require me to be the currently assigned coordinator.

- **AC6 — Update organiser point of contact**  
  Given an event has been successfully reassigned,  
  When the reassignment is completed,  
  Then the newly assigned coordinator automatically becomes the Event Organiser's coordinator point of contact for that event.  
  And the Event Organiser is not required to update the point of contact manually.

- **AC7 — Record reassignment history**  
  Given an event is successfully reassigned,  
  When the reassignment is recorded,  
  Then the reassignment history includes:
  - The user who performed the reassignment
  - The previous coordinator
  - The newly assigned coordinator
  - The date and time of reassignment

- **AC8 — No eligible coordinator available**  
  Given no eligible coordinator is available for reassignment,  
  When I attempt to reassign the event,  
  Then I am informed that no eligible coordinators are currently available.  
  And the existing coordinator assignment remains unchanged.

- **AC9 — Reassignment authorisation**  
  Given I do not have permission to reassign the event,  
  When I view the event,  
  Then the reassignment action is not available to me.

- **AC10 — Prevent invalid reassignment**  
  Given I am attempting to reassign an event,  
  When I select the coordinator who is already assigned to the event,  
  Then I cannot complete the reassignment to the same coordinator.

---

## 3. [SCRUM-43] — [Coordinator Assignment] — View Coordinator Assignment History

- **Issue Key:** [SCRUM-43](https://is212-g1t5.atlassian.net/browse/SCRUM-43)
- **Type:** Story
- **Status:** To Do
- **Priority:** Medium
- **Assignee:** Jerome Liau Jun Rong
- **Reporter:** Jerome Liau Jun Rong

### User Story
As an **authorised Event Coordinator**,  
I want to **view the coordinator assignment history of an event**,  
so that I can **understand who has been responsible for the event over time**.

### Acceptance Criteria
- **AC1 — View assignment history**  
  Given I am authorised to view an event,  
  When I open its assignment history,  
  Then I can see its previous coordinator assignments and reassignments.

- **AC2 — Display assignment information**  
  Given an assignment record exists,  
  Then the record displays:
  - Previous coordinator, where applicable
  - Newly assigned coordinator
  - User who performed the assignment or reassignment
  - Date and time of the change

- **AC3 — Display history chronologically**  
  Given multiple assignment records exist,  
  When I view the assignment history,  
  Then they are displayed in chronological order.

- **AC4 — Preserve historical records**  
  Given an event has been reassigned multiple times,  
  When I view its assignment history,  
  Then previous assignment records remain available and are not overwritten.

- **AC5 — Access control**  
  Given I am not authorised to view the event,  
  When I attempt to access its assignment history,  
  Then I am prevented from viewing the history.

# Spec: Addition of Event Coordinator Lead Role

Source of truth: Jira project SCRUM (SCRUM-75, 77, 78, 79, 81). Each acceptance criterion has a stable ID (e.g. `SCRUM-78-AC5`). Use these IDs in test names so every test traces back to a criterion.

## Context

The system already has user authentication (SCRUM-13: email/password login, generic error on invalid credentials, password reset, redirect to a role-appropriate dashboard) and an Event Coordinator role that manages events. This epic adds a new **Event Coordinator Lead** role that assigns submitted event requests to Event Coordinators, reassigns them, and monitors coordinator workload. Per-role data access rules (SCRUM-92, row-level security) also apply to this role.

## Definitions

| Term | Meaning |
|---|---|
| Event Coordinator Lead (Lead) | A user with the Event Coordinator Lead role. Separate from the Event Coordinator role. |
| Linked coordinator | An Event Coordinator account linked to the one Lead who supervises it (SCRUM-75-AC5). |
| Eligible Event Coordinator | An **active** account with the Event Coordinator role that is **linked to the Lead** performing the action. |
| Closed event | An event in a final status. **Open question: exact statuses not yet confirmed** (e.g. completed, cancelled, rejected). Any other status is non-closed. |
| Unassigned event request | A submitted, non-closed event request with no assigned Event Coordinator. |
| Workload count | The number of non-closed events assigned to a coordinator. |

## Business Rules (apply across stories)

- **BR1:** An event has at most one assigned Event Coordinator at any time.
- **BR2:** Closed events cannot be assigned or reassigned.
- **BR3:** Lead-only pages and actions must be enforced server-side / at the data layer, not only hidden in the UI. Direct URL or API calls by non-Leads are denied and change nothing.
- **BR4:** All Leads share one unassigned queue; each Lead assigns only to their own linked coordinators.
- **BR5:** There is no cap on how many non-closed events a coordinator can hold.

## Implementation Order

1. **SCRUM-75** (blocks all others)
2. **SCRUM-77** and **SCRUM-81** (independent of each other; both state their rules in terms of data, so they can be built before 78/79)
3. **SCRUM-78**
4. **SCRUM-79**

## Out of Scope

Do not build any of these, even though they may seem natural:
- Notifications to coordinators on assignment or reassignment
- Automatic or suggested assignment
- Workload caps or limits
- An audit record for first-time assignment (only reassignment is recorded, SCRUM-79-AC8)
- Changes to the login flow itself (reuse SCRUM-13)
- Story points, Jira updates or any other project-management changes

---

## SCRUM-75 — Set Up Event Coordinator Lead Role

**Story:** As an Event Coordinator Lead, I want to log in to an account that has the Event Coordinator Lead role, so that I can reach the Lead features for assigning and overseeing my Event Coordinators.

| ID | Given | When | Then |
|---|---|---|---|
| SCRUM-75-AC1 | The system's user roles | — | An Event Coordinator Lead role exists, separate from Event Coordinator and all other roles. |
| SCRUM-75-AC2 | A staff account | It is set up with the Lead role (seed data or an admin setup step) | The user is recognised as a Lead when they log in. |
| SCRUM-75-AC3 | I have a Lead account | I log in | Email/password login, generic error message and password reset behave exactly as SCRUM-13. |
| SCRUM-75-AC4 | I log in successfully as a Lead | — | I land on the Lead home page, which links to the unassigned event queue and the coordinator overview. |
| SCRUM-75-AC5 | An Event Coordinator account | It is set up or updated | It can be linked to one Lead who supervises it. A Lead can supervise any number of coordinators. |
| SCRUM-75-AC6 | I am logged in as a Lead | I open a Lead page | I can access it. |
| SCRUM-75-AC7 | I do not have the Lead role | I try to open a Lead page or perform a Lead action, including by direct URL or API call | I am denied access, and no Lead data is shown or changed. |

---

## SCRUM-77 — View Unassigned Event Requests

**Story:** As an Event Coordinator Lead, I want to view submitted event requests that have not yet been assigned, so that I can identify which requests need an Event Coordinator.

| ID | Given | When | Then |
|---|---|---|---|
| SCRUM-77-AC1 | An event request is submitted, not closed, and has no assigned coordinator | I view the unassigned queue | The request is displayed. |
| SCRUM-77-AC2 | An event appears in the queue | — | I see event name, Event Organiser, preferred date and time, expected attendance, and submission date. |
| SCRUM-77-AC3 | Multiple unassigned requests exist | I view the queue | They are ordered oldest to newest by submission date and time. |
| SCRUM-77-AC4 | An event request has an assigned coordinator | I view the queue | It is not displayed. |
| SCRUM-77-AC5 | An unassigned event request is closed | I view the queue | It is not displayed. |
| SCRUM-77-AC6 | There are no unassigned, non-closed requests | I view the queue | I see a clear message that no requests are awaiting coordinator assignment. |
| SCRUM-77-AC7 | I am not a Lead | I try to access the queue, including by direct URL or API call | I am denied access. |

---

## SCRUM-78 — Manually Assign Event Coordinator

**Story:** As an Event Coordinator Lead, I want to assign an unassigned event request to a suitable Event Coordinator, so that every event has one coordinator responsible for managing it.

| ID | Given | When | Then |
|---|---|---|---|
| SCRUM-78-AC1 | An event request is unassigned and not closed | I choose to assign it | I see the eligible coordinators, each with their workload count. |
| SCRUM-78-AC2 | I select an eligible coordinator | I confirm | That coordinator becomes the only assigned coordinator for the event. |
| SCRUM-78-AC3 | The assignment succeeded | The event is viewed | It shows as assigned to that coordinator and is no longer unassigned (leaves the SCRUM-77 queue). |
| SCRUM-78-AC4 | A coordinator already has other non-closed events | I assign another event to them | The assignment still succeeds. |
| SCRUM-78-AC5 | The event was assigned by someone else after I opened it | I confirm my assignment | Mine is rejected, I am told the event is already assigned, and the existing assignment is unchanged. |
| SCRUM-78-AC6 | An event is closed | I view it | The assign action is not available. |
| SCRUM-78-AC7 | There are no eligible coordinators | I try to assign | I am told none are available and cannot complete the assignment. |
| SCRUM-78-AC8 | I have started assigning | I cancel before confirming | The event stays unassigned. |
| SCRUM-78-AC9 | I am not a Lead | I try to assign, including by direct URL or API call | I am denied and the event is unchanged. |

Note: SCRUM-78-AC5 is a concurrency rule. The data layer must guarantee it (e.g. a conditional update or constraint), not a read-then-write check in application code.

---

## SCRUM-79 — Reassign Event Coordinator

**Story:** As an Event Coordinator Lead, I want to reassign a non-closed event to another Event Coordinator, so that the event can continue to be managed when responsibilities or staff availability change.

| ID | Given | When | Then |
|---|---|---|---|
| SCRUM-79-AC1 | A non-closed event has an assigned coordinator | I view it | I can choose to reassign it. |
| SCRUM-79-AC2 | I choose to reassign | The coordinator list is shown | I see who is currently assigned; I can select from the other eligible coordinators, each with their workload count; the current coordinator cannot be selected. |
| SCRUM-79-AC3 | I select another eligible coordinator | I confirm | The new coordinator becomes the only assigned coordinator; the previous one is no longer responsible. |
| SCRUM-79-AC4 | The reassignment succeeded | Each coordinator views their events | The previous coordinator no longer sees it; the new coordinator does. |
| SCRUM-79-AC5 | An event is closed | I view it | The reassign action is not available. |
| SCRUM-79-AC6 | No eligible coordinator exists other than the current one | I try to reassign | I am told none are available and the assignment is unchanged. |
| SCRUM-79-AC7 | I have started reassigning | I cancel before confirming | The assignment is unchanged. |
| SCRUM-79-AC8 | A reassignment succeeded | — | The system records the previous coordinator, new coordinator, Lead who performed it, and date and time. |
| SCRUM-79-AC9 | I am not a Lead | I try to reassign, including by direct URL or API call | I am denied and the assignment is unchanged. |

---

## SCRUM-81 — View Coordinator Workload and Active Events

**Story:** As an Event Coordinator Lead, I want to view each Event Coordinator I supervise and the non-closed events assigned to them, so that I can monitor coordinator workload and event ownership.

| ID | Given | When | Then |
|---|---|---|---|
| SCRUM-81-AC1 | I am logged in as a Lead | I open the coordinator overview | I see every active coordinator linked to me, each with their workload count. |
| SCRUM-81-AC2 | I select a coordinator | I view their events | I see each of their non-closed events with event name, current status, preferred date and time, and expected attendance. |
| SCRUM-81-AC3 | A coordinator has no non-closed events | I view the overview | They are still shown with a count of 0. |
| SCRUM-81-AC4 | An event is closed | I view workloads | It is excluded from the coordinator's count and list. |
| SCRUM-81-AC5 | An event's assigned coordinator has changed | I open or refresh the overview | Lists and counts reflect the current assignment. |
| SCRUM-81-AC6 | No coordinators are linked to me | I open the overview | I see a clear message that no coordinators are assigned to me. |
| SCRUM-81-AC7 | I am not a Lead | I try to access the overview, including by direct URL or API call | I am denied access. |

---

## Open Questions

1. **Closed statuses:** which event statuses count as closed? Until confirmed, isolate this in one place (a single constant or function) so it can be changed without touching tests elsewhere.
2. **Lead account setup:** seed data is enough for MVP unless the codebase already has an admin user-management screen.

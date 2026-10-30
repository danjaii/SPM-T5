# Equipment Reservations and Technical Support Requests Follow the Event's Access: Final User Story

User story for **Equipment reservations and technical support requests follow the event's access** (ConnectSphere, IS212), compiled 2026-10-28.

- Scenario numbers are the test IDs: `153-S3` means SCRUM-153, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-153 | [User Authorisation & Authentication] Equipment reservations and technical support requests follow the event's access | `07_venue_bookings_rls.sql` (helpers), `25_equipment_requests.sql`, `32_equipment_request_review.sql` |

Why: the customer says access follows "the user's role and direct relationship to an event" (Week 9 answers, row 15). Today any
signed-in user can read every equipment reservation and delete one by querying the database directly, and
`technical_support_requests` still has the blanket policy from `02_rls.sql`. Migrations 25 and 32 added restrictive policies for
insert and update only; the permissive "any signed-in user, any row" policy is still underneath them. See ADR 0003.

## Implementation decisions (2026-10-28)

These override the text of the Jira ticket where they conflict.

- **Who reads `equipment_reservations` [DECIDED].** Technical Support Staff (every row, they review requests and check
  availability across events), the event's assigned coordinator, and the event's organiser. Nobody else: not another
  coordinator, not a Lead, a Safety Officer, Venue Staff or an attendee. Safety Officers and Venue Staff still see what they
  need through `security definer` functions (`safety_check_details()`, `is_ready_for_safety_check()`), which are unchanged.
  The check uses `is_assigned_coordinator()` and `is_event_organiser()` from migration 07, never a subquery on `events`.
- **Nobody deletes a reservation through the API [DECIDED].** `revoke delete on equipment_reservations from authenticated,
  anon`, so every role gets a permission error (42501). Every function that releases or changes reservations
  (`reserve_equipment()`, `review_equipment_request()`, `update_equipment_request()`, `change_venue_booking()`,
  `cancel_venue_booking()`, `update_event_details()`, `venue_booking_take_over()`) is `security definer` and only
  inserts or updates, so none is affected; rows still go away with their event (`on delete cascade`, which runs as the
  database owner).
- **Writes keep migrations 25 and 32's checks, with a permissive policy underneath [DECIDED].** Those two policies are
  `restrictive` and need at least one permissive policy to exist. INSERT: the event's assigned coordinator. UPDATE:
  Technical Support Staff. The restrictive policies are not re-created, so the request rules (own name, status `requested`,
  open event, approved venue) are untouched. Coordinator changes still go through `update_equipment_request()`.
- **`technical_support_requests` [PROPOSED].** SELECT: Technical Support Staff (all) and the event's assigned coordinator.
  INSERT: the event's assigned coordinator, as themselves, a new `requested` row that nobody has reviewed. UPDATE:
  Technical Support Staff. No DELETE (`revoke delete`). The ticket only asks that everyone else is refused; no code writes
  this table today (seed and tests use the secret key), so the write policies are the smallest shape that fits the
  roles, to be revisited when a story builds the screen. The organiser does not read it (AC3).
- **The organiser reads their event's requests, read-only [PROPOSED].** The ticket marks AC5 open. Today
  `GET /events/:id/equipment-requests` refuses an organiser, and the event page's Equipment tab shows "Unavailable". With
  the organiser allowed by RLS, equipment-service now lets them view the list (`EventInfo` gains `organiserId`) with
  `canCreate` and every `canEdit` false. The page already renders that read-only, so `apps/web` does not change. If the
  customer says organisers must not see equipment, drop the organiser from the select policy and from `forEvent()`.
- **Counts stay correct [DECIDED].** `equipment_free_units()` (migration 32) is `security definer`, so a coordinator's
  "Available 4 / need 6" still counts other events' holds while the rows themselves are hidden from them. The availability
  check, the inventory page and the review page are Technical Support Staff only (equipment-service refuses everyone
  else), so they keep reading every row.
- **Consumers audited.** equipment-service readers (`equipmentRequestReader`, `reservationReader`): Technical Support Staff
  and the assigned coordinator. event-service `arrangementImpact`: the assigned coordinator editing their event, a
  coordinator-only route. auth-service dashboard: Technical Support Staff reading `technical_support_requests`. No
  service holds the secret key for these reads.
- **Migration** `54_equipment_reservations_rls.sql` (`52` is SCRUM-154's and `53` SCRUM-155's, both open; claim the next
  free number at merge). The header holds the role-by-action matrix. No `packages/shared` change. **[DECIDED]**
- **Not in scope.** `technical_staff_assignments` (already per-role, migration 41), narrowing the Lead's reads (SCRUM-156),
  a screen for technical support requests, and the notes on requests (SCRUM-87/AC8).

### Role-by-action matrix

| Role | `equipment_reservations` SELECT | INSERT | UPDATE | DELETE | `technical_support_requests` SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Technical Support Staff | every row | none | every row | none | every row | none | every row | none |
| Event coordinator, assigned to the event | the event's rows | the event's requests | none (via `update_equipment_request()`) | none | the event's rows | the event's requests | none | none |
| Event organiser of the event | the event's rows | none | none | none | none | none | none | none |
| Any other role, any other event | none | none | none | none | none | none | none | none |
| anon | none | none | none | none | none | none | none | none |

### Jira wording

- AC2 is unchanged. Add to AC5: "and the page does not offer to change them" (read-only).

---

## SCRUM-153 Equipment reservations and technical support requests follow the event's access

**User story.** As an Event Coordinator or Technical Support Staff member, I want equipment reservations to be readable and
removable only by the people involved in the event, so that nobody else can see or cancel the equipment an event depends on.

### Acceptance criteria

*AC1.* Given I am not Technical Support Staff, the event's assigned coordinator or the event's organiser, when I read
equipment reservations, then I get none for that event.

*AC2.* Given any role, when I delete an equipment reservation through the API, then it is refused. Releasing goes through the
existing functions (`cancel_venue_booking()`, `reserve_equipment()`, `update_equipment_request()`).

*AC3.* Given I am not Technical Support Staff or the event's coordinator, when I read or write `technical_support_requests`,
then it is refused.

*AC4.* Given I am Technical Support Staff or the event's assigned coordinator, when I use the equipment request, review,
availability and inventory pages, then they work as before.

*AC5.* Given I am an organiser, when I open my event page, then I see its equipment requests but cannot change them.

### Tests

"Another event" means an event the caller has no relationship to. Roles are the seven in `packages/shared/src/roles.ts`.

| ID | Scenario | Level | File (proposed) |
| --- | --- | --- | --- |
| 153-S1 | Technical Support Staff read the reservations of two events; the assigned coordinator and the organiser of an event read only theirs | integration | `services/equipment-service/tests/integration/equipmentReservationsRls.test.ts` |
| 153-S2 | Another coordinator, another organiser, a Lead, a Safety Officer, Venue Staff, an attendee and a signed-out client read none of an event's reservations | integration | same |
| 153-S3 | Every role is refused deleting a reservation (42501) and the row remains | integration | same |
| 153-S4 | The assigned coordinator can still add a request; another coordinator, the organiser and Technical Support Staff cannot insert one | integration | same |
| 153-S5 | Technical Support Staff can still update a request's status; no other role changes one directly | integration | same |
| 153-S6 | A coordinator's "free units" still counts another event's approved hold, while that hold's row is hidden from them | integration | same |
| 153-S7 | `reserve_equipment()`, `review_equipment_request()`, `update_equipment_request()` and `cancel_venue_booking()` still work for their roles | integration | existing `equipmentReservation`, `equipmentReview`, `equipmentRequestUpdate` and `changeCancelBooking` suites, re-run |
| 153-S8 | Technical Support Staff and the event's coordinator read `technical_support_requests` of the event; every other role reads none | integration | `equipmentReservationsRls.test.ts` |
| 153-S9 | The assigned coordinator can insert a `requested` technical support request for their event; others cannot insert; only Technical Support Staff update; nobody deletes | integration | same |
| 153-S10 | The organiser of the event gets the request list with `canCreate` false and every `canEdit` false; another organiser gets 403 | unit | `services/equipment-service/tests/unit/equipmentRequest.test.ts` |
| 153-S11 | The event reader returns the organiser's id | unit | `services/equipment-service/tests/unit/supabaseReaders.test.ts` |

Fixtures are created with the secret key, prefixed `IT-`, and removed afterwards; assertions only cover rows the test
creates (CLAUDE.md, SCRUM-143).

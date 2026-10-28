# Users: Contact Details Are Private: Final User Story

User story for **Per-role RLS for users** (ConnectSphere, IS212), compiled 2026-10-28.

- Scenario numbers are the test IDs: `154-S3` means SCRUM-154, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-154 | [User Authorisation & Authentication] Per-role RLS for users: own row, names only for others | `03_users_role_privilege.sql`, `11_event_registrations.sql` |

Why: the customer says access follows "the user's role and direct relationship to an event" (Week 9 answers, row 15).
Today any signed-in user can read every user's email and phone, change another user's name or phone, and delete or insert
user rows, because `users` still has the blanket policy from `02_rls.sql`. See ADR 0003.

## Implementation decisions (2026-10-28)

These override the text of the Jira ticket where they conflict.

- **Close the contact columns, not the rows [PROPOSED].** The ticket says "own row only". But other users' names are read
  through RLS in many places, including PostgREST embeds (`staff:users!staff_id(full_name)` in
  `equipment-service/.../technicalAssignmentStore.ts`, `editor:users!...(full_name)` in `equipmentRequestReader.ts`,
  `coordinator:users!...(full_name)` in `equipment-service/.../eventReader.ts`, `recorder:users!created_by(full_name)` in
  `venue-service/.../venueUnavailabilityStore.ts`) and lists such as the coordinator picker in `routes/events.ts`. An
  own-row policy would turn every one of those into a silent `null` or an empty list. So rows stay readable and
  `email`, `phone` and `communication_preferences` become unreadable to signed-in users through the API. Names, roles and
  departments are shown on pages already and are not contact details. The ticket marks its approach Negotiable. Jira AC1 and
  AC4 are reworded to match (see "Jira wording" below).
- **How.** `revoke select on users from authenticated, anon`, then `grant select (id, role, full_name, organisation_id,
  department, is_active, supervising_lead_id, created_at, updated_at) on users to authenticated`. `supervising_lead_id`
  (migration 19) is a link, not contact information, and the Lead's overview functions read it as the caller. A column grant is the tool because a row
  policy cannot hide a column (the same reason as migration 03). The secret key still reads everything. **[DECIDED]**
- **Own contact details through a function.** `public.my_contact_details()` returns the caller's `email`, `phone` and
  `communication_preferences`; `security definer`, `search_path = public, pg_temp`, executable by `authenticated` only.
  Used by `auth-service/src/routes/profile.ts` (`readProfile`) and `event-service/src/routes/registrations.ts`
  (`/:id/registration-form` prefill). **[DECIDED]**
- **Attendee contact details for the people who manage the event.** `public.event_registration_contacts(p_event_id uuid)`
  returns `(registration_id, attendee_id, full_name, email, phone)` for the registrations of that event, and only when the
  caller is the event's organiser (`is_event_organiser()`) or its assigned coordinator (`is_assigned_coordinator()`);
  for anyone else it returns no rows. `GET /events/:id/registrations` reads the registrations as the caller (RLS from
  migration 11 unchanged) without the `attendee:attendee_id(...)` embed, calls this function, and joins by registration id
  in code. **[DECIDED]**
- **Row access tightened in the same migration.** The blanket `for all` policy is replaced by: SELECT for any signed-in
  user (the rows, limited to the granted columns), UPDATE only of the caller's own row (`id = auth.uid()` in `using` and
  `with check`), and no INSERT or DELETE (`revoke insert, delete on users from authenticated, anon`). Account creation and
  the `users.role` column stay with auth-service and the secret key. Migration 03's column grant on UPDATE (`full_name`,
  `phone`, `communication_preferences`) is unchanged. **[DECIDED]**
- **Migration** `52_users_contact_privacy.sql` (claim the next free number at merge; 51 is the latest today). The header
  holds the role-by-action matrix. No `packages/shared` change. **[DECIDED]**
- **Not in scope.** Narrowing which user rows a role can see (names stay readable by every signed-in user), organisation
  hierarchies (out of scope for Release 1, W9 row 15), and the profile email flow (`PATCH /profile` already uses the
  secret key). **[DECIDED]**

### Role-by-action matrix

| Role | `users` SELECT | `users` UPDATE | INSERT / DELETE | `my_contact_details()` | `event_registration_contacts(event)` |
| --- | --- | --- | --- | --- | --- |
| any signed-in role | every row, granted columns only (no email, phone, preferences) | own row, `full_name`, `phone`, `communication_preferences` | none | own details | none unless below |
| event organiser | same | same | none | own details | rows for events they organise |
| event coordinator | same | same | none | own details | rows for events assigned to them |
| anon | none | none | none | refused | refused |

### Jira wording

- AC1 becomes: Given I am signed in as any role, when I query `users` directly for another person's email or phone, then it
  is refused; names, roles and departments are still readable.
- AC4 becomes: Given I am an attendee (or any role that does not manage the event), when I ask for an event's attendee
  contact details, then nothing is returned.
- Add AC6: Given I am signed in, when I try to change, add or delete another person's `users` row through the API, then it
  is refused.

---

## SCRUM-154 Per-role RLS for users

**User story.** As any signed-in ConnectSphere user, I want other people to be unable to read my email and phone number,
so that my contact details are only seen by the people who need them for an event.

### Acceptance criteria

*AC1.* Given I am signed in as any role, when I query `users` directly for another person's email or phone, then it is
refused.

*AC2.* Given I am an organiser, coordinator, Lead, venue staff or technical support staff, when a page shows another
person's name (assignee, requester, technician, coordinator), then it still shows the name and no email or phone.

*AC3.* Given I am an organiser or coordinator and I open the registrations of an event I manage, when the list loads, then
each attendee's name, email and phone are shown, and only for that event's attendees.

*AC4.* Given I am an attendee (or any role that does not manage the event), when I ask for an event's attendee contact
details, then nothing is returned.

*AC5.* Given any role, when I update my own profile (name, phone, communication preferences), then it still works and
`role` stays unwritable (migration 03 unchanged).

*AC6.* Given I am signed in, when I try to change, add or delete another person's `users` row through the API, then it is
refused.

### Tests

| ID | Scenario | Level | File (proposed) |
| --- | --- | --- | --- |
| 154-S1 | Every role selecting another user's `email`, `phone` or `communication_preferences` gets a permission error (42501) | integration | `services/event-service/tests/integration/usersRls.test.ts` |
| 154-S2 | Every role can still select another user's `id`, `full_name`, `role`, `department` | integration | same |
| 154-S3 | `my_contact_details()` returns the caller's own email, phone and preferences, and only theirs | integration | same |
| 154-S4 | An event's organiser and its assigned coordinator get every registration's name, email and phone from `event_registration_contacts()` | integration | same |
| 154-S5 | Another organiser, another coordinator, an attendee, venue staff and technical support get no rows from `event_registration_contacts()` | integration | same |
| 154-S6 | A user can update their own `full_name`, `phone` and `communication_preferences`; updating `role` or `email` is still refused (migration 03) | integration | same |
| 154-S7 | A user cannot update another user's row, and cannot insert or delete a `users` row | integration | same |
| 154-S8 | `GET /events/:id/registrations` joins contacts from the function and still returns the same fields; a registration with no form details falls back to the profile | unit | `services/event-service/tests/unit/` (route tests) |
| 154-S9 | `profile` and `registration-form` read own contact details through the function | unit | `services/auth-service/tests/unit/`, `services/event-service/tests/unit/` |
| 154-S10 | Existing pages that show a person's name (equipment, venue unavailability recorder, event point of contact, mentions, coordinator picker) still resolve names | integration | existing suites, re-run |

Fixtures are created with the secret key, prefixed `IT-`, and removed afterwards; assertions only cover rows the test
creates (CLAUDE.md, SCRUM-143).

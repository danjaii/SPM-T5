# Catalogue Writes Limited to the Owning Role: Final User Story

User story for **Catalogue writes limited to the right role (venues, layouts, equipment)** (ConnectSphere, IS212), compiled 2026-10-28.

- Scenario numbers are the test IDs: `155-S3` means SCRUM-155, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-155 | [User Authorisation & Authentication] Catalogue writes limited to the right role (venues, layouts, equipment) | `02_rls.sql`, `07_venue_bookings_rls.sql` (`current_user_role()`), `26_venue_setup_turnaround.sql`, `39_venue_unavailability_marking.sql` |

Why: the customer says Venue Staff define layout types and can add, edit and delete them (Week 9 answers, row 14) and that the
catalogue must allow creating and maintaining venues and equipment (row 12). Today any signed-in user, an attendee included,
can insert, edit or delete a venue, a layout, a facility or a piece of equipment by querying the database directly, because
these tables still have the blanket policy from `02_rls.sql`. SCRUM-57 and SCRUM-58 (create and edit a venue) need a
Venue-Staff-only write policy before they can be built. See ADR 0003.

## Implementation decisions (2026-10-28)

These override the text of the Jira ticket where they conflict.

- **Reads stay open, writes follow the owning role [DECIDED].** Each table's blanket `for all` policy is dropped. SELECT is
  re-created for every signed-in user (`using (true)`), so no page that reads the catalogue changes (venue search, the
  layout picker on the event request form, the equipment pages, the dashboard, the profile's organisation name).
  Nothing is audited as "needs a change" because **no service or page writes these tables today**: every
  `.from(...)` in `services/*/src` and `apps/web` on them is a read, and every test that inserts one uses the secret key,
  which bypasses RLS. SCRUM-57 and SCRUM-58 will add the first writes.
- **Who owns what [DECIDED].**
  - `venues`, `venue_supported_layouts`, `venue_facilities`, `room_layouts`, `facilities`: Venue Staff.
  - `equipment`: Technical Support Staff.
  - `organisations`, `event_categories`: nobody through the API. Organisations come from sign-up and the seed; categories
    from the seed. The secret key still writes them.
- **How a refusal looks [DECIDED].** The role check is `current_user_role() = 'venue_staff'` (or
  `'technical_support_staff'`), the helper from migration 07, in `using` and `with check`. For the two tables nobody writes,
  and for DELETE on `venues` and `equipment`, the table privilege is revoked as well (`revoke insert, update, delete ... from
  authenticated, anon`), as migration 39 did for `venue_unavailability`, so the caller gets a permission error (42501) and not
  a silent "0 rows changed". For a role-gated table, a refused INSERT is an RLS violation (42501) and a refused UPDATE or
  DELETE by the wrong role changes no rows; tests check the row is unchanged as well as the error.
- **`venues` keeps migration 26's column grant [DECIDED].** The UPDATE grant on the nine pre-existing columns stays, so Venue
  Staff cannot write `setup_minutes` or `turnaround_minutes` directly; they still go through `set_venue_timing()`.
  `mark_venue_unavailable()` and `set_venue_timing()` are `security definer` and check the role themselves, so AC6 needs no
  change to them (they are not re-created). INSERT on `venues` is open to Venue Staff for the same columns SCRUM-57 will
  send; the new columns have defaults.
- **No venue or equipment delete [PROPOSED].** A venue has `is_active` and equipment has an `operational_status` of `retired`,
  and both are referenced by bookings and reservations (foreign keys without `on delete cascade`, so Postgres would refuse
  the delete of a used row anyway). The ticket says "no DELETE policy where nothing needs one"; nothing needs one. AC2 and
  AC4 still hold: a delete by any role is refused. If the customer wants a venue or an equipment row removed outright, add
  a DELETE policy then.
- **Deleting a layout type that is in use is refused [DECIDED].** `venue_supported_layouts.room_layout_id` and
  `events.preferred_room_layout_id` reference `room_layouts(id)` with no `on delete`, so Postgres refuses (23503) the
  delete of a layout a venue still supports or an event prefers. We keep that, and do not cascade, because a cascade would
  silently remove a layout from every venue and break the capacity-per-layout figures. Venue Staff retire a layout by
  setting `is_active = false` (already read by venue search). A layout nobody uses can be deleted.
- **Deleting a facility removes it from every venue [PROPOSED].** `venue_facilities.facility_id` is `on delete cascade`
  and nothing else refers to a facility, so Venue Staff deleting a facility drops that tag from the venues that had it. A
  facility is only a label, so we keep the cascade. The ticket marks this one Negotiable (the customer never said who
  owns facilities); it is treated like layouts until they do.
- **Link tables follow `venues` [DECIDED].** `venue_supported_layouts` and `venue_facilities` take insert, update and delete
  for Venue Staff only, because editing a venue's layouts and facilities means adding and removing links.
- **Migration** `53_catalogue_write_roles.sql` (`52` is SCRUM-154's, open in PR #138; claim the next free number at merge).
  The header holds the role-by-action matrix. No `packages/shared` change. **[DECIDED]**
- **Not in scope.** The venue create and edit screens (SCRUM-57, SCRUM-58), a catalogue screen for equipment, any narrowing
  of reads, `venue_unavailability` (already per-role, migration 39), `equipment_reservations` and
  `technical_support_requests` (SCRUM-153). **[DECIDED]**

### Role-by-action matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `venues` | any signed-in role | Venue Staff | Venue Staff, the nine pre-26 columns (timing only via `set_venue_timing()`) | none |
| `venue_supported_layouts`, `venue_facilities` | any signed-in role | Venue Staff | Venue Staff | Venue Staff |
| `room_layouts`, `facilities` | any signed-in role | Venue Staff | Venue Staff | Venue Staff (a layout in use is refused by its foreign keys) |
| `equipment` | any signed-in role | Technical Support Staff | Technical Support Staff | none |
| `organisations`, `event_categories` | any signed-in role | none | none | none |
| every table above | `anon`: none | `anon`: none | `anon`: none | `anon`: none |

### Jira wording

- AC4 is unchanged. Add to AC2 and AC4: "or delete a venue or an equipment row, whoever I am" (no one deletes these
  through the API; the secret key does).
- Add AC7: Given I am Venue Staff, when I delete a room layout type that a venue still supports, then it is refused and the
  layout is still there; I retire it by marking it inactive.

---

## SCRUM-155 Catalogue writes limited to the right role

**User story.** As Venue Staff or Technical Support Staff, I want only my role to be able to change the venue and equipment
catalogues, so that nobody else can alter or delete venues, layouts, facilities or equipment that events depend on.

### Acceptance criteria

*AC1.* Given I am signed in as any role, when I read venues, their supported layouts and facilities, equipment,
organisations and the lookup tables, then I can, as today.

*AC2.* Given I am not Venue Staff, when I insert, update or delete a venue, a venue's supported layouts or facilities, a room
layout type or a facility, then it is refused.

*AC3.* Given I am Venue Staff, when I add, edit or delete a room layout type or a facility, then it works.

*AC4.* Given I am not Technical Support Staff, when I insert, update or delete an `equipment` row, then it is refused.

*AC5.* Given any signed-in user, when I write to `organisations` or `event_categories` through the API, then it is refused.

*AC6.* Given Venue Staff, when I set a venue's setup and turnaround times or mark it unavailable, then those still work
through their existing functions (migrations 26, 39, 46).

*AC7 (added by this spec).* Given I am Venue Staff, when I delete a room layout type that a venue still supports, then it is
refused and the layout is still there.

### Tests

"Every other role" means each of the six other roles in `packages/shared/src/roles.ts`.

| ID | Scenario | Level | File (proposed) |
| --- | --- | --- | --- |
| 155-S1 | Every role (and no one else) can select from `venues`, `venue_supported_layouts`, `venue_facilities`, `room_layouts`, `facilities`, `equipment`, `organisations` and `event_categories`; an unauthenticated client gets nothing | integration | `services/venue-service/tests/integration/catalogueRls.test.ts` |
| 155-S2 | Every role except Venue Staff is refused inserting a venue, a supported layout, a venue facility, a layout type and a facility (42501), and nothing is created | integration | same |
| 155-S3 | Every role except Venue Staff updating or deleting a venue, a link row, a layout type or a facility changes no row | integration | same |
| 155-S4 | Venue Staff can insert, edit and delete a layout type and a facility they created, and add, edit and remove a venue's layout and facility links | integration | same |
| 155-S5 | Venue Staff can insert a venue and edit its nine columns; no role can delete a venue (42501) | integration | same |
| 155-S6 | Every role except Technical Support Staff is refused inserting an `equipment` row, and updating or deleting one changes nothing | integration | same |
| 155-S7 | Technical Support Staff can insert and edit equipment, including `operational_status`; no role can delete equipment (42501) | integration | same |
| 155-S8 | Every role, Venue Staff and Technical Support Staff included, is refused inserting, updating or deleting `organisations` and `event_categories` (42501) | integration | same |
| 155-S9 | Venue Staff still set a venue's timing through `set_venue_timing()` and mark it unavailable through `mark_venue_unavailable()`; writing `setup_minutes` directly is still refused | integration | existing `venueTiming.test.ts`, `venueUnavailability` suites, re-run |
| 155-S10 | Venue Staff deleting a layout type a venue supports, or an event prefers, is refused with a foreign-key error and the layout remains | integration | `catalogueRls.test.ts` |
| 155-S11 | Deleting a facility removes it from the venues that had it and leaves the venues | integration | `catalogueRls.test.ts` |
| 155-S12 | Existing pages and routes that read the catalogue (venue search, the layout picker on the event request form, the equipment pages, the dashboard) still work for every role | integration | existing suites, re-run |

Fixtures are created with the secret key, prefixed `IT-`, and removed afterwards; assertions only cover rows the test
creates (CLAUDE.md, SCRUM-143).

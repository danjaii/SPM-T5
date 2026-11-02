# Maintain Room Layout Types: Final User Story

User story for **[Venue Catalogue] Maintain Room Layout Types** (ConnectSphere, IS212), compiled 2026-11-02.

- Scenario numbers are the test IDs: `181-S4` means SCRUM-181, Scenario 4. The six acceptance criteria are numbered 1 to 6 as in
  the brief for this spec (the Jira story itself was not read), and **Scenario n is AC n** in test names and commit titles
  **[PROPOSED]** (confirm the numbering with the PO). The ID form is `<story>-S<n>` because `scripts/traceability` only
  recognises that form.
- Markers: **[DECIDED]** settled by an earlier spec or the schema. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-181 | [Venue Catalogue] Maintain Room Layout Types | SCRUM-155 (catalogue write policies, migration 53), SCRUM-57 and SCRUM-58 (the venue form that offers the layouts) |

Why: the customer says Venue Staff define layout types and can add, edit and delete them (Week 9 Q&A, row 14).
Migration 53 already lets only Venue Staff write `room_layouts`, but no route or screen uses that, so the six seeded layouts
(Classroom, Theatre, Boardroom, Banquet, Exhibition, U-Shape) can only be changed by a developer. This story adds the
route, the screen and the checks. It does not change which layouts a venue supports (SCRUM-57, SCRUM-58).

## Implementation decisions (2026-11-02)

These override the text below where they conflict, and where this spec and the schema disagree, this spec wins.

- **What a layout type is.** A row of `room_layouts` (`id`, `name` unique, `description`, `is_active`, default true). Exactly
  two foreign keys point at it, both without `on delete`: `venue_supported_layouts.room_layout_id` and
  `events.preferred_room_layout_id` (a draft is an `events` row too). Nothing else refers to it by key: a venue booking keeps
  the layout as text (`snapshot_venue_requirements`), and `available_venues()` does not read layouts. **[DECIDED]**
- **Who may write: three `security definer` functions, with the RLS of migration 53 kept underneath.** The new migration adds
  `create_layout_type(p_name)`, `rename_layout_type(p_id, p_name)` and `delete_layout_type(p_id)`. Each allows `venue_staff`
  only (`current_user_role()`, 42501 otherwise), writes an `activity_log` row in the same transaction (DR13), and is
  granted to `authenticated` only, as `create_venue()` and `update_venue()` are. **[PROPOSED]**
  - Why functions, when `create_venue()` needed one only because a venue is three tables and nobody can delete a venue: a
    layout type is one table, so atomicity across tables is not the reason. The reasons here are different:
    1. **The in-use check must see events that Venue Staff cannot read.** Venue Staff read only events that have a venue
       booking (migration 59), yet an event request or draft that prefers the layout also blocks the delete. Only a definer
       function can count them. It returns a count, never event names.
    2. **The check and the delete must be one step.** The function locks the layout row (`for update`) before it checks, so a
       venue saved in between waits for the delete (or the other way round) and cannot slip a reference in.
    3. **A refusal that carries data.** "Told which venues use it" needs the venues in the answer. The function returns them
       as a normal result, so the service does not parse a Postgres error's `details` string.
    4. **One place for the name rules and the audit row** (with old and new name), written only when the change happens.
  - Alternative rejected: plain RLS (the service inserts, updates and deletes `room_layouts` as the caller, which migration 53
    already allows). Smallest change, but the audit row would be a second, separate write; the delete could only name venues,
    not events; and a race between the check and the delete would end as a bare foreign key error.
  - Migration 53's policies stay. A direct write by anyone but Venue Staff is still refused by them (42501), and the
    constraints below hold for a direct write by Venue Staff too.
- **Name rules (AC5).** **[PROPOSED]**
  - The name is trimmed and runs of spaces become one. It may not be empty and can be at most 60 characters (a typo guard,
    ours; the seeded names are 7 to 10).
  - **Names are unique ignoring case.** `room_layouts.name` has only `unique (name)`, which is case-sensitive, so "theatre"
    could sit beside "Theatre". That is not harmless here: the suitability check finds a venue's layout by lower-cased name
    (`packages/shared/src/venueSuitability.ts`), so two spellings would be ambiguous. The migration adds a unique index on
    `lower(btrim(name))` and a check that `btrim(name) <> ''`, so a direct write is held to the same rule.
  - A duplicate or an empty name is a 422 with the reason on the `name` field. Renaming a layout type to a different spelling of
    its own name ("theatre" to "Theatre") is allowed. Renaming it to exactly what it is called now changes nothing and
    writes no audit row.
- **Delete rule (AC3, AC4).** A layout type is deleted only when no venue supports it and no event request, draft included,
  prefers it. **[DECIDED]** (SCRUM-155 AC7 and its spec: no cascade, because it would silently remove a layout from every
  venue and break the capacity-per-layout figures.) A venue counts whether or not it is active.
  - Refused: `delete_layout_type` changes nothing and returns `{ deleted: false, name, venues: [{ id, name }], event_count }`.
    The service answers **409 `LAYOUT_TYPE_IN_USE`** with `usedBy: { venues, eventCount }` and a message that names the
    venues, for example `"Theatre" cannot be deleted because 2 venues use it: Marina Bayview Hall A, Orchard Suite 2.`
    When only event requests use it, the message says how many ("1 event request prefers it") and names none, because
    Venue Staff may not read those events. The shared function `layoutTypeInUseMessage` writes the sentence, so the page
    and the service agree.
  - The layout stays. To remove it Venue Staff first take it off its venues (venue edit, SCRUM-58) and wait for or ask the
    organiser to change the requests. There is no force option and no retire step in this story.
  - Allowed: `{ deleted: true, name }`. The `activity_log` row stays after the layout is gone.
- **Rename (AC2).** The id never changes, so every venue and event keeps its link and its per-layout capacity, and every page
  that reads the layout through the key shows the new name (see the table below). The `description` and `is_active` of a
  layout type are not touched. **[DECIDED]**
- **Not changed by a rename or delete, and why that is acceptable [PROPOSED]:** text copies of the old name. A booking's
  `snapshot_venue_requirements` and the change history keep what was written at the time, so they are not rewritten. See the
  table and open question 6.
- **Endpoints** (`venue-service`, a new router mounted at `/layout-types`, its own session check, then a role check that
  comes before the body is read, as `POST /venues` does) **[PROPOSED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /layout-types` | Venue Staff only (403 others): `[{ id, name, isActive, venueCount }]`, by name, never cached. `venueCount` is the number of venues that support it. It does not count events (Venue Staff cannot read them), so a count of 0 can still be refused on delete. |
  | `POST /layout-types` body `{ name }` | 201 `{ id, name }`; 403; 422 `{ code, error, fieldErrors: { name } }` |
  | `PATCH /layout-types/:id` body `{ name }` | 200 `{ id, name }`; 403; 404 unknown id (after the role check); 422 |
  | `DELETE /layout-types/:id` | 200 `{ id, name }`; 403; 404; 409 `LAYOUT_TYPE_IN_USE` |

  The coordinator check on `/venues` does not apply here: this router refuses every role but Venue Staff, even for `GET`,
  because the choices other roles need already come from `GET /venues/search-options` and `GET /events/request-options`.
  The service's CORS header adds `DELETE` to `Access-Control-Allow-Methods`; without it the browser's preflight for
  the delete fails.
- **Validation is shared.** `parseLayoutTypeInput` in `packages/shared` trims, collapses spaces and checks length, and runs in
  the page and in the service, so they cannot disagree. `sameLayoutName(a, b)` (ignoring case) lets the page warn about a
  duplicate in its own list before sending; the database is the authority. Who may manage is the existing
  `canManageVenueCatalogue(role)` (Venue Staff only), not a new rule. **[DECIDED]**
- **Writes and reads go through an injected `LayoutTypeStore`** (`AppOptions.layoutTypes`), so unit tests need no database.
  The Supabase implementation calls the three functions and reads the list as the caller. The mapping from database
  refusals: 42501 to 403, 22023 (empty or too long) and 23505 (duplicate) to a 422 on `name`, P0002 to 404, an in-use result
  to 409. **[DECIDED]** (same shape as `VenueCatalogueWriter`)
- **Web.** `/venues/layout-types` holds the list, an "Add layout type" box, a Rename button on each row (edit in place) and a
  Delete button that asks to confirm. A "Layout types" button next to "Add venue" on the catalogue opens it, shown to
  Venue Staff only; anyone else who opens the address is told why they cannot (as `/venues/new` does). The delete button
  stays enabled when a type is in use, because the refusal is what lists the venues; they are shown as links to each venue.
  Status is never shown by colour alone. No sidebar item. **[PROPOSED]**

### What reads a layout type, and what a rename or delete does to it

| Reader | How it finds the layout | After a rename | After a delete (only an unused type can go) |
| --- | --- | --- | --- |
| Venue page, venue search results, the venue edit form (`venues.ts`, `venueSearchReader.ts`) | the key, name read live | new name straight away (AC2) | nothing: no venue uses it |
| Layout choices when adding or editing a venue (`GET /venues/search-options`, `is_active = true`) | live | new name | gone from the choices (AC3); a new type is in them at once because it starts active (AC1) |
| Venue search filter by layout | `layoutId`, matched in `venueSearchService.ts` | unchanged | a stale page that still sends the old id gets an empty result; no venue disappears from other searches |
| Event request form, event edit form, event page (`event-service`, `venue-service` event reader) | the key, name read live; `GET /events/request-options` lists every row, active or not | new name | gone from the choices; an event cannot still point at it |
| Event change history and the "sent back" note | stored id, shown by looking it up in the current list | new name | an old history line shows the raw id, and a sent-back note shows "Unknown room layout" (both already fall back this way). Cosmetic, only for an event that once preferred the type |
| **Venue suitability check** (`venueSuitability.ts`) | the booking's stored requirement text, compared with the venue's layout names ignoring case | **a booking whose stored text still holds the old name no longer matches, so its layout check reads "not supported" until the text is changed** | no effect |
| `venue_bookings.snapshot_venue_requirements`, `events.venue_requirements` | free text | not rewritten | no effect |

A new layout type also appears on the event request form, because both forms read the same table. That is intended: layout
types are one shared lookup.

---

## SCRUM-181 Maintain Room Layout Types

**User story.** As Venue Staff, I want to add, rename and delete room layout types, so that the layouts a venue can offer match
how ConnectSphere's spaces are really set out, without a developer changing seed data.

### Acceptance criteria

*AC1.* Given I am Venue Staff, when I add a layout type with a name, then it appears in the layout choices when adding or
editing a venue.

*AC2.* Given a layout type that venues use, when I rename it, then the new name is shown on the venues that use it.

*AC3.* Given a layout type that no venue uses, when I delete it, then it is removed and disappears from the choices.

*AC4.* Given a layout type that a venue uses, when I try to delete it, then the delete is refused and I am told which venues
use it.

*AC5.* Given I enter an empty name, or a name another layout type already has, when I add or rename a layout type, then it is
rejected and I am shown the reason.

*AC6.* Given I am not Venue Staff, when I try to add, rename or delete a layout type, then the action is not available to me in
the interface and the database refuses it.

### Tests

"Every other role" means each of the six other roles in `packages/shared/src/roles.ts`.

| ID | Scenario |
| --- | --- |
| 181-S1 | Venue Staff POST a name: 201 with `{ id, name }`; the store is called with the cleaned name (trimmed, spaces collapsed); the new type is in `GET /layout-types` and in the layout choices for adding and editing a venue; the page adds it to its list and clears the box (AC1). |
| 181-S2 | Venue Staff PATCH a name: 200; a venue that uses the type shows the new name and keeps its capacity for that layout; changing only the case is allowed; the same name again changes nothing; an unknown id is 404 (after the role check); the page edits the row in place and shows the new name (AC2). |
| 181-S3 | Venue Staff DELETE a type nothing uses: 200; it is gone from the list and from the layout choices; the audit row remains; the page removes the row after a confirmation, and cancelling the confirmation deletes nothing (AC3). |
| 181-S4 | DELETE of a type a venue supports is 409 `LAYOUT_TYPE_IN_USE` naming every such venue (inactive ones too), and the type is still there; a type that only an event request or draft prefers is refused with the event count and no event name; once the last venue drops the type (venue edit) the delete goes through; the page shows the refusal and links to the venues (AC4). |
| 181-S5 | An empty or blank name, a name over 60 characters, a name that matches another type ignoring case and spacing, on add and on rename, each get a 422 with a message on `name`; the store is not called; the page shows the message and keeps what was typed; the database refuses the same duplicate and a blank name even when written directly (AC5). |
| 181-S6 | Every other role gets 403 on all four routes, even with an invalid body, and no session gets 401; the "Layout types" button is not on the catalogue for them and `/venues/layout-types` tells them why they cannot manage; the three functions refuse every other role (42501) and a visitor who is not signed in; a direct insert, update or delete of `room_layouts` by every other role is still denied (AC6). |
| DB | `create_layout_type`, `rename_layout_type` and `delete_layout_type` work for Venue Staff and log `layout_type_created`, `layout_type_renamed` and `layout_type_deleted` with the actor and both names; an unknown id is `P0002`; a delete is refused while a venue or an event row points at the type and goes through when none does; two types differing only in case cannot both exist; a venue edit that names a deleted type is refused (CS571) and changes nothing. Fixtures are the test's own `IT-181-` types, never the seeded ones (AC1 to AC6). |
| E2E | Venue Staff add a throwaway type, see it in the Add venue form, rename it, and delete it; a throwaway venue that uses a second type blocks that delete and is named; a coordinator sees no "Layout types" button (AC1 to AC4, AC6). |

### Out of scope

- Retiring a layout type (`is_active`) or bringing it back, and editing its description. The customer's "edit" is built as rename,
  as this story asks. Note that `GET /events/request-options` offers inactive types too, so retiring would need that fixed first.
- Facilities and equipment catalogue maintenance (the Week 9 Q&A, row 12). Facilities are treated like layouts in migration 53,
  but have no story yet.
- Deciding which layouts a venue supports (SCRUM-57, SCRUM-58) and a capacity per layout.
- Rewriting stored text that holds an old layout name (a booking's requirement text, the change history).
- Notifying anyone of a rename or delete.
- Two people changing the same type at once: the row lock makes the changes happen one after the other and the last rename
  wins; there is no version check, as for venue edits.

### Open questions (each has a proposed default, shown in the decisions above)

1. **Functions or plain RLS?** Default: three `security definer` functions (reasons above). If the team prefers the smaller
   change, add and rename can go straight to the table and only `delete_layout_type` stays a function, with the audit rows
   for add and rename dropped or written by the service.
2. **Unique ignoring case, and a non-empty check, added to `room_layouts`.** Default: yes. The migration fails on the
   hosted database if it already holds two names that differ only in case or a blank name; that has not been checked.
3. **Longest name.** Default: 60 characters.
4. **Description.** Default: not editable and not asked for. If the customer wants to edit it, add an optional field (small) and
   drop the "description is not touched" line. If it stays out, record the narrowing of "edit" in
   `docs/scope-decisions.md`, as CLAUDE.md asks.
5. **Do event requests and drafts block a delete?** Default: yes, as SCRUM-155 decided, shown as a count. A forgotten draft
   can therefore block a delete with no way for Venue Staff to see it. An alternative is to let the delete clear the
   layout on drafts only; that changes someone else's draft without telling them, so it is not proposed.
6. **A rename and the suitability check.** Default: stored text is not rewritten, and the consequence is accepted and
   documented. The alternative is for `rename_layout_type` to also update `venue_bookings.snapshot_venue_requirements` where it
   equals the old name (ignoring case) and the booking still holds its venue. That keeps the layout check true, but it
   edits a snapshot meant to record what was asked. Needs the PO's choice.
7. **Where the screen lives.** Default: a button on the venue catalogue and a link from the venue form, no sidebar item, no
   route guard in the middleware (the page explains, as `/venues/new` does). The alternative is a sidebar item and a
   `ROLE_ONLY` entry, which needs `app-shell-nav` and `role-access` tests to change.
8. **A `DELETE` verb.** Default: yes, with `DELETE` added to the service's CORS methods. No other endpoint here uses it
   (cancelling a booking is `POST .../cancel`), so `POST /layout-types/:id/delete` is the other choice.

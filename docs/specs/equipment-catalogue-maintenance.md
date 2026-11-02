# Add and Edit Equipment and Its Maintenance Status: Final User Story

User story for **[Equipment Catalogue] Add and Edit Equipment and Its Maintenance Status** (ConnectSphere, IS212), compiled 2026-11-02.

- Scenario numbers are the test IDs: `182-S4` means SCRUM-182, Scenario 4. The five acceptance criteria are numbered 1 to 5 as in the Jira story, and **Scenario n is AC n**.
- The ID form is `<story>-S<n>` because `scripts/traceability` only recognises that form.
- Markers: **[DECIDED]** settled by an earlier spec, the schema or the code as it is. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-182 | [Equipment Catalogue] Add and Edit Equipment and Its Maintenance Status | SCRUM-155 (catalogue write policies, migration 53), SCRUM-16/SCRUM-18 (availability and the free-units rule, migration 32) |

Why: the customer says the catalogue must allow creating and maintaining venues and equipment (Week 9 answers, row 12), and that
Technical Support Staff handle maintenance statuses. Migration 53 already lets only Technical Support Staff insert and update
`equipment`, but no route or screen uses that, so the seeded catalogue (17 items) can only be changed by a developer, and nobody
can mark an item damaged or under maintenance from the app. This story adds the route, the page and the checks. It does the
same job for equipment that SCRUM-57, SCRUM-58 and SCRUM-181 did for venues and layout types.

## Implementation decisions (2026-11-02)

- **What an item is.** A row of `equipment`: `name` (required), `type` (a free label such as AV or Audio), `description`,
  `total_quantity` (whole number), `location`, `operational_status` (`available`, `damaged`, `under_maintenance`, `retired`) and
  `created_at`. Reservations point at it by id with no `on delete`, and nobody can delete an item (migration 53 revokes `delete`).
  **[DECIDED]**
- **Who may write: two `security definer` functions, with the RLS of migration 53 kept underneath.** `create_equipment(...)` and
  `update_equipment(...)` allow `technical_support_staff` only (`current_user_role()`, 42501 otherwise), write an `activity_log`
  row in the same transaction (DR13), and are granted to `authenticated` only, as `create_venue()` and `update_venue()` are.
  **[PROPOSED]**
  - Why functions, when one table could take plain RLS writes: one place for the field rules, a check that a missing item is
    P0002 and not a silent zero-row update, and an audit row that records what changed (including a status change, which
    Technical Support Staff and the reservation pages rely on) in the same transaction.
  - Alternative rejected: plain RLS writes from the service. Smaller, but the audit row would be a second write and an update of
    an unknown id would succeed with no effect.
  - Migration 53's policies stay. A direct write by anyone but Technical Support Staff is still refused (42501).
- **Field rules (AC4).** **[PROPOSED]**
  - `name`: required, trimmed with runs of spaces made one, at most 120 characters. Duplicate names are allowed (a default taken
    where the ticket is silent, as for venues; the catalogue has no unique name today and the hosted data was not checked, so no
    unique index is added). `type`: optional, at most 60 characters. `description`: optional, at most 500. `location`: optional,
    at most 120.
  - `total_quantity`: required, a whole number from 1 to 100000 (a typo guard, ours). The schema allows 0; an item that is no
    longer held is retired with its status, not by setting its quantity to 0. Because of that, editing an item whose quantity is 0
    asks for a valid quantity (no seeded item has 0).
  - A blank optional field is stored as null.
  - Operational status: one of the four values. **A new item starts `available`**, and the add form does not ask (a status in an
    add request is ignored). **An edit must send a status**: one that leaves it out is a 422, so an edit can never put a damaged item
    back in service by accident.
  - A refused field is a 422 with the reason on that field.
- **A status change is an edit [DECIDED].** AC3's "mark it under maintenance" is the edit form's status choice. The existing
  rule in `equipment_free_units()` (migration 32) already returns 0 free units for any item that is not `available`, so the
  availability check, the inventory page and a new reservation all stop offering it. Nothing new is needed there.
- **What a status change or a quantity cut does to reservations already made [DECIDED, out of scope].** Reservations that were
  already approved are left alone; the same as marking a venue unavailable under a booking was left to its own story. A cut of
  `total_quantity` below what is already reserved is saved (no check) and the inventory shows 0 free for that period.
  This is recorded as a known limit and an open question.
- **Endpoints** (`equipment-service`, a new router, session already required by the app, then a role check that comes before the
  body is read) **[PROPOSED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /equipment-catalogue` | Technical Support Staff only (403 others): every item with `id`, `name`, `type`, `description`, `totalQuantity`, `location`, `operationalStatus`, by name, never cached. |
  | `POST /equipment-catalogue` | 201 `{ id }`; 403; 422 `{ code, error, fieldErrors }` |
  | `PUT /equipment-catalogue/:id` | 200 `{ id }`; 403; 404 unknown or malformed id (after the role check); 422 |

  The service's CORS header adds `PUT` to `Access-Control-Allow-Methods`.
- **Validation is shared.** `parseEquipmentInput` in `packages/shared` trims and checks every field, and runs in the page and in the
  service, so they cannot disagree. Who may manage is a new `canManageEquipmentCatalogue(role)` (Technical Support Staff only).
  **[DECIDED]**
- **Writes go through an injected `EquipmentCatalogueStore`** (`AppOptions.catalogue`), so unit tests need no database. The mapping
  from database refusals: 42501 to 403, 22023 to a 422 on the named field, P0002 to 404. **[DECIDED]**
- **Web.** `/equipment-catalogue` lists every item (name, type, quantity, location, status with an icon and a label, never
  colour alone), with an **Add equipment** form and an **Edit** button on each row that opens the same form with the item's
  values, including its status. A "Manage catalogue" button on the Inventory page opens it for Technical Support Staff only;
  anyone else who opens the address is told why they cannot. Route guard: `ROLE_ONLY` in the middleware, like the Inventory
  page. **[PROPOSED]**

---

## SCRUM-182 Add and Edit Equipment and Its Maintenance Status

**User story.** As Technical Support Staff, I want to add and edit equipment and change an item's operational status, so that the
catalogue and availability checks reflect what we actually have.

### Acceptance criteria

*AC1.* Given I am Technical Support Staff, when I add an item with its required details and save, then it appears in the equipment
inventory and availability checks.

*AC2.* Given an item exists, when I change its details and save, then the new values show in the inventory.

*AC3.* Given an item is available, when I mark it under maintenance, then it reports no free units in availability checks.

*AC4.* Given I clear a required field, when I save, then it is rejected and I see which field is invalid.

*AC5.* Given I am not Technical Support Staff, when I try to add or edit equipment, then the action is not available and the
database refuses it.

### Tests

| ID | Scenario |
| --- | --- |
| 182-S1 | Technical Support Staff POST an item: 201 with the new id; the store gets the cleaned values (trimmed, spaces collapsed, blanks as null); the item starts available, is in `GET /equipment-catalogue`, in `GET /equipment-inventory` with its quantity as free units, and in the availability check's names; the page adds it to its list and clears the form (AC1). |
| 182-S2 | PUT changes name, type, description, quantity and location: 200; the inventory shows the new values; the page opens the row's values in the form and shows the new ones after saving; an unknown or malformed id is 404 (after the role check) (AC2). |
| 182-S3 | PUT sets the status to `under_maintenance`: the item has 0 free units in the inventory and the availability check, and a reservation for it is refused; setting it back to `available` makes its units free again; each of the four statuses is accepted and anything else is refused (AC3). |
| 182-S4 | An empty body names every required field (name, quantity); a blank name, a name over 120 characters, a quantity that is not a whole number, below 1 or over 100000, an unknown status, and over-long type, description and location each get a 422 on the right field; the store is not called; the page shows the message and keeps what was typed; the database refuses the same values written directly (AC4). |
| 182-S5 | Every other role gets 403 on all three routes, even with an invalid body, and no session gets 401; the "Manage catalogue" button is not on the Inventory page for them and `/equipment-catalogue` tells them why they cannot manage; the two functions refuse every other role (42501) and a signed-out visitor; a direct insert or update of `equipment` by every other role is still denied (AC5). |
| DB | `create_equipment` and `update_equipment` work for Technical Support Staff and log `equipment_created` and `equipment_updated` with the actor and what changed; a status change is in the log; an unknown id is `P0002`; blank optional fields are stored as null; nothing is written when a check fails. Fixtures are the test's own `IT-182-` items, never the seeded ones (AC1 to AC5). |
| E2E | Technical Support Staff add a throwaway item, see it in the inventory, edit it, mark it under maintenance and see 0 free; a coordinator sees no "Manage catalogue" button (AC1 to AC3, AC5). |

### Out of scope

- Deleting an item (nobody can; migration 53) and bringing a retired item back other than by editing its status.
- What happens to reservations already made when an item is damaged, retired or its quantity is cut.
- Per-unit tracking (damage is per catalogue item, as the availability rules already say) and photos or manuals.
- A unique name rule on the catalogue.
- Notifying anyone of a catalogue change.

### Open questions (each has a proposed default, shown in the decisions above)

1. **Two definer functions or plain RLS writes?** Default: two functions (reasons above).
2. **Duplicate names.** Default: allowed, with no new index, because the hosted data was not checked. Adding a unique index on
   `lower(btrim(name))` is a small follow-up once someone checks the hosted table.
3. **Quantity from 1.** Default: yes; use the status to take an item out of use.
4. **A quantity cut or a status change under existing reservations.** Default: saved with no check; existing reservations stay.
   The alternative is to refuse the change or to ask first, as the venue capacity cut does, which needs a reading of
   "reserved in the future" per item.
5. **Where the screen lives.** Default: a button on the Inventory page and a role-only route `/equipment-catalogue`, no sidebar item.

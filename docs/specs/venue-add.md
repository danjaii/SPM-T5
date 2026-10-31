# Add a New Venue: Final User Story

User story for **[Venue Catalogue] Add a New Venue Record** (ConnectSphere, IS212), compiled 2026-10-30.

- Scenario numbers are the test IDs: `57-S2` means SCRUM-57, Scenario 2. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO).
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-57 | [Venue Catalogue] Add a New Venue Record | SCRUM-29 (venue catalogue), SCRUM-155 (catalogue write policies, migration 53) |

SCRUM-58 (edit a venue) reuses the form and the shared checks written here and has its own spec, `venue-edit.md`.
This story only creates a venue. It does not delete or retire one.

## Implementation decisions (2026-10-30)

These override the text below where they conflict.

- **Who may write (RLS is the authority).** Migration 53 already lets only `venue_staff` insert into `venues`,
  `venue_supported_layouts` and `venue_facilities`. A venue is three tables, and nobody can delete a venue
  (`revoke delete`), so three separate inserts from the service could leave a half-made venue that cannot be
  cleaned up. The new migration adds the `security definer` function
  `create_venue(p_name, p_address, p_description, p_max_capacity, p_hours_start, p_hours_end, p_is_accessible,
  p_accessibility_notes, p_layouts, p_facility_ids)` which writes all three in one transaction, allows `venue_staff`
  only (`current_user_role()`), and writes an `activity_log` row. It follows `set_venue_timing()`. **[DECIDED]**
- **Setup and turnaround start at 0** (the column defaults of SCRUM-101); Venue Staff set them afterwards on the
  detail page. **[DECIDED]**
- **Required fields (57-S2).** Name, location (address), capacity and at least one supported layout. Each layout
  has its own capacity, which may not exceed the venue's. Description, operating hours, accessibility notes and
  facilities are optional. Operating hours are both set or both empty, and the opening time is before the closing
  time. Jira lists "accessibility features" among the fields but does not say whether one is required; the
  accessible flag always has a value (yes or no). **[PROPOSED]**
- **Limits (typo guards, ours).** Name up to 120 characters, location up to 200, capacity a whole number from 1 to
  100000. **[PROPOSED]**
- **Duplicate names are allowed (open question in Jira).** The ticket's own example is two rooms with the same name
  in different wings, and location tells them apart. No warning is shown. **[PROPOSED]**
- **Endpoint** (`venue-service`, behind the existing `/venues` session check) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `POST /venues` body `{ name, address, description?, maxCapacity, operatingHoursStart?, operatingHoursEnd?, isAccessible, accessibilityNotes?, layouts: [{ layoutId, maxCapacity }], facilityIds }` | 201 `{ id }`; 403 for anyone but Venue Staff (checked before validation); 422 `{ code, error, fieldErrors }` with a message per field |

  Coordinators already pass the catalogue check, so the role check inside the route is what refuses them. Unknown
  layout or facility ids (a foreign key error in the database) come back as a 422 on `layouts` or `facilityIds`.
- **Validation is shared.** `parseVenueInput` in `packages/shared` runs in the form and in the service, and checks
  every field together so the form can show all the problems at once. `canManageVenueCatalogue(role)` is true for
  Venue Staff only. **[DECIDED]**
- **Writes go through an injected `VenueCatalogueWriter`** (`AppOptions.venueCatalogue`), so unit tests need no
  database. **[DECIDED]**
- **Web.** `/venues/new` holds the form. The layouts and facilities it offers come from the existing
  `GET /venues/search-options`. A "Add venue" button on the catalogue is shown to Venue Staff only (the server
  refuses anyone else regardless). After saving, the user lands on the new venue's detail page. **[DECIDED]**

---

## SCRUM-57 Add a New Venue Record

**User story.** As Venue Staff, I want to add a new venue record to the catalogue, so that a newly available
ConnectSphere space can be booked without a developer manually seeding data.

### Acceptance criteria

*AC1 (Scenario 1, successful creation).* Given I am Venue Staff, when I submit a new venue record with name,
location, capacity, supported layouts, accessibility features and facilities, then the venue is added to the
catalogue and it appears immediately in venue browsing.

*AC2 (Scenario 2, required fields missing).* Given I omit a required field, when I attempt to submit the new venue
record, then it is not created and I am shown which fields are missing.

*AC3 (Scenario 3, access restricted to Venue Staff).* Given I am not Venue Staff, when I attempt to add a venue
record, then the action is not available to me.

### Tests

| ID | Scenario |
| --- | --- |
| 57-S1 | Venue staff POST a complete venue: 201 with an id, the writer is called with the cleaned values, and the venue then appears in `GET /venues` and `GET /venues/:id` with its layouts, facilities and accessibility (AC1). `parseVenueInput` accepts a complete body, trims text, and accepts hours given or left out, numbers or numeric strings for capacity. A venue with the same name as an existing one is accepted. |
| 57-S2 | A missing name, location, capacity or layout, a non-positive or fractional capacity, a layout capacity above the venue's, only one operating hour, an opening time not before the closing time, and a repeated layout are each rejected with a message on the right field (422, every problem at once); the writer is not called; the form shows the messages and keeps what was typed (AC2). |
| 57-S3 | A coordinator gets 403 from POST (even with an invalid body); an organiser is refused by the catalogue check; 401 without a session; the page shows no "Add venue" button to a coordinator and `/venues/new` shows them why they cannot add one (AC3). |
| DB | `create_venue` works for venue staff, writes the venue, its layouts and facilities together and logs it; a coordinator is refused (42501); a layout id that does not exist rolls the whole save back, leaving no venue behind; a direct insert as a coordinator is still denied (AC1, AC3). |
| E2E | Venue staff add a throwaway venue and see it in the catalogue and on its detail page; a coordinator sees no "Add venue" (AC1, AC3). |

### Out of scope

- Editing a venue (SCRUM-58), retiring or deleting a venue, and adding new layouts or facilities to the lookup lists.
- Setup and turnaround times at creation (they start at 0 and are set on the detail page, SCRUM-101).
- A warning for a duplicate name (see the decision above).

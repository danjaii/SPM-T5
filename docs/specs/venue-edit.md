# Edit an Existing Venue: Final User Story

User story for **[Venue Catalogue] Update an Existing Venue Record** (ConnectSphere, IS212), compiled 2026-10-30.

- Scenario numbers are the test IDs: `58-S2` means SCRUM-58, Scenario 2. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO). `58-S4` is not a Jira
  scenario: it covers the ticket's Notes (a capacity cut), which the customer has not answered.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-58 | [Venue Catalogue] Update an Existing Venue Record | SCRUM-29 (venue catalogue), SCRUM-57 (add a venue: the form, `parseVenueInput`, `can_manage_catalogue`) |

This story edits a venue's details. It does not retire or delete a venue, and it does not touch setup and turnaround
times (SCRUM-101 has its own form and function).

## Implementation decisions (2026-10-30)

These override the text below where they conflict.

- **What can be edited.** Everything SCRUM-57 can set: name, location, description, capacity, operating hours, the
  accessible flag and notes, supported layouts (each with its own capacity) and facilities. Setup minutes,
  turnaround minutes and `is_active` are left as they are. **[DECIDED]**
- **Who may write (RLS is the authority).** The new migration adds the `security definer` function
  `update_venue(p_venue_id, ...)` with the same parameters as `create_venue()`. It allows `venue_staff` only
  (`current_user_role()`), changes the venue row and replaces its layouts and facilities in one transaction (a venue
  has three tables and nobody can delete a venue, so a half-saved edit could not be cleaned up), and writes an
  `activity_log` row. An unknown layout or facility is refused before anything is written (CS571 / CS572, as in
  `create_venue()`); an unknown venue is `P0002`. **[DECIDED]**
- **Existing bookings are not touched by an edit,** other than by the capacity rule below. Removing a layout from a
  venue does not break anything stored (no booking refers to a venue's layout link; the safety check reads it with a
  left join), and the suitability check reads the venue as it is when it runs. **[DECIDED]**
- **Endpoints** (`venue-service`, behind the existing `/venues` session check) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /venues/:id/edit` | Venue Staff only (403 for others, 404 unknown): the venue as the form needs it, in the same shape as the add form's body (`name`, `address`, `description`, `maxCapacity`, `operatingHoursStart`, `operatingHoursEnd`, `isAccessible`, `accessibilityNotes`, `layouts: [{ layoutId, maxCapacity }]`, `facilityIds`). `GET /venues/:id` is unchanged: it gives layout and facility names, not ids. |
  | `PUT /venues/:id` body as `POST /venues` plus optional `confirmImpact: true` | 200 `{ id }`; 403 for anyone but Venue Staff (checked before validation); 404 unknown venue; 422 `{ code, error, fieldErrors }` with a message per field; 409 `CONFIRM_IMPACT` (58-S4) |

- **Required fields cannot be cleared (58-S2).** The same shared `parseVenueInput` as the add form, so the rules
  are the same: name, location, capacity and at least one layout. A rejected save changes nothing. **[DECIDED]**
- **A capacity cut is allowed, after confirmation (58-S4).** The ticket asks whether to block, warn or stay silent
  and the customer has not answered. We allow it, with an explicit confirmation, which is the pattern SCRUM-112 uses
  for important event changes: when the new capacity is lower than the venue's current capacity and some holding
  booking at the venue (status requested, tentative, approved or confirmed, not yet ended) expects more people than
  the new capacity, the first save answers 409 `CONFIRM_IMPACT` with those bookings and saves nothing. The form lists
  them and offers "Save anyway", which sends the same body again with `confirmImpact: true`. **[PROPOSED]**
  - It compares each booking's own expected attendance, not the event's total (SCRUM-98).
  - It applies only to a cut. An edit that leaves the capacity the same or raises it never asks, even if a booking
    already exceeded it.
  - Nothing is cancelled, flagged or sent to anyone. Those bookings already show "exceeds capacity" to their
    coordinators and Venue Staff, worked out from the venue's capacity when they are read (SCRUM-98).
  - No reason is asked for: the person editing is Venue Staff, who hold the decision.
  - Alternatives rejected: refusing the edit (takes the decision from Venue Staff, and some capacities are
    conservative), and saving silently (nobody learns bookings now exceed the venue).
  - The check and the save are two steps, so a booking made in between is not in the list. It still shows "exceeds
    capacity" afterwards, so nothing is lost.
- **Two people saving at once: the last save wins.** There is no version check. **[DECIDED]**
- **Writes and reads go through injected ports** (`AppOptions.venueCatalogue` gains `update`, and
  `AppOptions.venueEdit` reads the form values and the affected bookings), so unit tests need no database. CORS
  already allows `PUT`. **[DECIDED]**
- **Web.** `/venues/[id]/edit` holds the same `VenueForm` as `/venues/new`, filled in. The detail page's existing
  "Edit venue" button only edits setup and turnaround times, so it is renamed **"Edit times"**, and **"Edit venue"**
  becomes a link to the new page. Both are shown to Venue Staff only. A saved edit returns to the venue's page.
  **[DECIDED]**

---

## SCRUM-58 Update an Existing Venue Record

**User story.** As Venue Staff, I want to update an existing venue's details, so that the catalogue accurately
reflects current capacity, facilities, or accessibility characteristics without a developer changing seed data.

### Acceptance criteria

*AC1 (Scenario 1, successful update).* Given a venue record exists in the catalogue, when I edit its details and
save, then the updated values are reflected in venue browsing and detail views.

*AC2 (Scenario 2, required fields cannot be cleared).* Given I clear a required field, when I attempt to save the
update, then the update is rejected and I am shown which field is invalid.

*AC3 (Scenario 3, access restricted to Venue Staff).* Given I am not Venue Staff, when I attempt to update a venue
record, then the action is not available to me.

*AC4 (58-S4, from the ticket's Notes, PROPOSED).* Given a booking at the venue expects more people than the venue
would hold after my edit, when I save, then I am shown those bookings and the venue is changed only when I confirm.

### Tests

| ID | Scenario |
| --- | --- |
| 58-S1 | Venue staff PUT a changed venue: 200, the writer is called with the cleaned values, and `GET /venues` and `GET /venues/:id` then show the new values with the new layouts and facilities (AC1). `GET /venues/:id/edit` returns the form's values, with ids, for pre-filling. The form is filled in from them and sends only what the shared parser accepts, then opens the venue's page. |
| 58-S2 | A cleared name, location, capacity or layout, and the other rules of `parseVenueInput`, are rejected with a message on the right field (422, every problem at once); the writer is not called; the form shows the messages and keeps what was typed; the saved venue is unchanged (AC2). |
| 58-S3 | A coordinator's `PUT` and `GET /venues/:id/edit` are 403 (even with an invalid body); an organiser is refused by the catalogue check; 401 without a session; 404 for an unknown venue (after the role check). The detail page shows "Edit venue" and "Edit times" to venue staff only, and `/venues/[id]/edit` tells anyone else why they cannot edit (AC3). |
| 58-S4 | Cutting the capacity below a holding booking's own attendance gives 409 `CONFIRM_IMPACT` listing it (event name, period, attendance, status), and nothing is saved; the same body with `confirmImpact: true` saves. A booking that has ended, a withdrawn, rejected or cancelled one, and one that fits are not listed. Raising or keeping the capacity never asks. The form shows the list with "Save anyway" and "Keep editing" (AC4). |
| DB | `update_venue` changes the venue and replaces its layouts and facilities together and logs it; setup and turnaround times and `is_active` are unchanged; a coordinator is refused (42501) and so is every other role; an unknown venue is `P0002`; an unknown layout or facility is refused and the whole save rolled back, so the old layouts are still there; a direct update of a venue as a coordinator is still denied (AC1, AC2, AC3). |
| E2E | Venue staff open a throwaway venue, change its capacity and a layout, save, and see the new values in the catalogue and on its page; a capacity cut below a booking asks first; a coordinator is offered no edit (AC1, AC3, AC4). |

### Out of scope

- Retiring or deleting a venue, and setup and turnaround times (SCRUM-101).
- Adding layouts or facilities to the lookup lists.
- Flagging, cancelling or notifying bookings after a capacity cut (see the decision above).
- Edit conflicts between two people (the last save wins).

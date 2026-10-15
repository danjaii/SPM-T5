# Venue Setup and Turnaround Times: Final User Story

User story for **Configure Venue Setup and Turnaround Times** (ConnectSphere, IS212), compiled 2026-10-14.

- Scenario numbers are the test IDs: `101-S3` means SCRUM-101, Scenario 3. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO).
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-101 | Configure Venue Setup and Turnaround Times | SCRUM-29 (venue catalogue) |

SCRUM-103 (`docs/specs/venue-padded-occupancy.md`) uses these times in availability and conflict checks. This story
only stores, edits and shows them.

## Implementation decisions (2026-10-14)

These override the text below where they conflict.

- **Columns.** Migration `26_venue_setup_turnaround.sql` adds `venues.setup_minutes` and `venues.turnaround_minutes`:
  `int not null default 0`, checked to be between 0 and 1440. Existing venues become 0 and 0, so nothing changes until
  staff set times (101-S2). **[DECIDED]**
- **Whole minutes from 0 to 1440** (one day, a typo guard). Jira only says whole minutes at least 0; the upper bound is
  our addition. **[PROPOSED]**
- **Who may write (RLS is the authority).** `02_rls.sql` lets any signed-in user update any venue row. The migration
  revokes table-level UPDATE on `venues` from `authenticated` and `anon` and re-grants UPDATE on the existing
  catalogue columns only, so the two new columns cannot be written directly. The only way to write them is the
  `security definer` function `set_venue_timing(p_venue_id, p_setup, p_turnaround)`, which allows `venue_staff`
  only (`current_user_role()`, migration 07) and writes an `activity_log` row (DR13). **[DECIDED]**
- **Endpoints** (`venue-service`, need a session; only `event_coordinator` and `venue_staff` reach `/venues`, others
  get 403) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /venues/:id` | adds `setup_minutes`, `turnaround_minutes`, `can_edit_timing` (true for venue staff only) |
  | `PUT /venues/:id/timing` body `{ setupMinutes, turnaroundMinutes }` | 200 `{ setup_minutes, turnaround_minutes }`; 403 for non-staff (checked before validation); 404 unknown venue; 422 `{ code, error, fieldErrors }` |

- **Validation is shared.** `parseVenueTimingInput` in `packages/shared` runs in the form and the service. A value
  must be a whole number from 0 up; `-15`, `12.5` and text are rejected with a message per field, and both fields
  are checked together. A rejected save changes nothing (101-S3). **[DECIDED]**
- **Writes go through an injected `VenueTimingWriter`** (`AppOptions.venueTiming`), so unit tests need no database.
  CORS now allows `PUT`. **[DECIDED]**
- **Web.** `VenueDetail` shows both times ("30 minutes"). Venue staff also see a `VenueTimingForm` (two number
  fields, "Save times"); coordinators see the times with no form. **[DECIDED]**

---

## SCRUM-101 Configure Venue Setup and Turnaround Times

**User story.** As Venue Staff, I want to set a setup time and a turnaround time for each venue, so that availability
reflects the time my team needs to prepare and reset the room.

### Acceptance criteria

*AC1 (Scenario 1, setting the times).* Given I am logged in as Venue Staff and "Orchid Hall" has no setup or
turnaround time set, when I set its setup time to 30 minutes and its turnaround time to 45 minutes and save, then both
values are saved against "Orchid Hall" and they are shown in the venue detail view.

*AC2 (Scenario 2, venues default to zero).* Given "Lotus Room" has never had its times set, when I open its detail
view, then setup and turnaround time are both shown as 0 minutes.

*AC3 (Scenario 3, invalid values are rejected).* Given I am editing the times for "Orchid Hall", when I enter -15, or a
value that is not a whole number, for either field and save, then a validation message is shown and the previously
saved values are kept.

*AC4 (Scenario 4, only Venue Staff can edit).* Given I am logged in as an Event Coordinator, when I open "Orchid
Hall", then I can see its setup and turnaround times and I cannot edit them.

### Tests

| ID | Scenario |
| --- | --- |
| 101-S1 | Venue staff PUT 30 and 45: 200, the writer is called with them, and the detail view shows them (AC1). `parseVenueTimingInput` accepts whole minutes, as numbers or numeric strings. |
| 101-S2 | A venue never given times is returned with 0 and 0 and the page shows "0 minutes" for both (AC2). |
| 101-S3 | -15, 12.5, text and blank are rejected with a message per field (422); the writer is not called; the form shows the message and keeps the old values (AC3). |
| 101-S4 | A coordinator gets the times and `can_edit_timing: false` from GET and 403 from PUT (even with an invalid body); the page shows no form (AC4). 404 for an unknown venue; 401 without a session. |
| DB | `set_venue_timing` works for venue staff and logs the change; a coordinator is refused; a direct `update venues set setup_minutes` as venue staff is denied; out-of-range values are refused by the check constraint (AC1, AC3, AC4). |
| E2E | Venue staff set 30 and 45 on a throwaway venue and see them on the detail page; a coordinator sees them with no form (AC1, AC4). |

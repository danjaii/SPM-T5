# Venue Search: Final User Story

User story for **Search for Suitable Venues** (ConnectSphere, IS212), compiled 2026-10-06.

- Scenario numbers are the test IDs: `65-S3` means SCRUM-65, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-65 | Search for Suitable Venues | SCRUM-29 (venue catalogue), SCRUM-36 (bookings that hold a slot) |

## Implementation decisions (2026-10-06)

These override the text below where they conflict.

- **Endpoints** (`venue-service`, port 4003; need a session, 401 otherwise; only `event_coordinator` and `venue_staff`
  may use them, others get 403, the same guard as the catalogue) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /venues/search?startDate&startTime&endDate&endTime[&attendance][&location][&layoutId][&accessible][&facilityIds]` | 200 `{ venues: VenueSearchResult[] }`, 422 `{ code, error, fieldErrors }` |
  | `GET /venues/search-options` | 200 `{ layouts: {id,name}[], facilities: {id,name}[] }`, the choices for the form |

  Both are registered before `GET /venues/:id`, so `search` is never read as a venue id.
- **"Available".** A venue is available for a period when it is active, has no overlapping holding booking
  (`requested`, `tentative`, `approved`, `confirmed`) and no overlapping `venue_unavailability` block. Overlap is
  half-open `[start, end)`, so back-to-back periods do not overlap (same rule as DR5). **[DECIDED]**
- **Operating hours (2026-10-10).** The venue must also be open for the period: the period's start time is not before
  `operating_hours_start` and its end time is not after `operating_hours_end`, with an end of `00:00` read as midnight
  (24:00). A venue with either hour empty has no stated limit and is always open. For a period over several days this
  compares the start time with the opening hour and the end time with the closing hour, assuming each day's event
  hours stay inside the venue's daily hours (a booking holds one continuous range). This is applied in
  `venue-service` after `available_venues`, so migration 14 is unchanged. **[DECIDED]**
- **Why a database function.** Row-level security (migrations 07 and 09) hides other coordinators' bookings from a
  coordinator, so a search run as the coordinator would wrongly show a venue as free. Migration
  `14_venue_search.sql` adds `available_venues(p_start, p_end) returns setof uuid`, `security definer`, executable by
  `authenticated` only. It returns venue ids only, never who holds what. **[DECIDED]**
- **Period (2026-10-10).** A start date and time and an end date and time, Singapore time; the end may be on a later
  day, so multi-day events can be searched. The start date must not be before today (Singapore time); today itself is
  allowed. The end must be after the start: an end date before the start date is reported on the end date, and on the
  same day an end time that is not later is reported on the end time. **[DECIDED]**
- **Filters** (all optional; a result must meet every one that is given) **[DECIDED]**:
  - `attendance`: whole number of at least 1. `max_capacity >= attendance`; when a layout is also chosen, that
    layout's own `max_capacity_for_layout` is used instead.
  - `location` (2026-10-10): case-insensitive "contains" match on the venue's name **or** its address, so "Marina"
    finds Marina Bayview Hall A as well as an address containing it.
  - `layoutId`: the venue supports that layout.
  - `accessible`: when on, only accessible venues. Off means no filter, not "inaccessible only".
  - `facilityIds`: the venue has **all** of the listed facilities.
- **Result.** `{ id, name, address, max_capacity, opening_time, closing_time, is_accessible, accessibility_notes,
  layouts: {id,name,max_capacity}[], facilities: {id,name}[] }`, ordered by name. `opening_time` and `closing_time` are
  `"HH:MM"` or `null` when not stated. **[DECIDED]**
- **Validation is shared.** `parseVenueSearchInput` in `packages/shared` runs in the form and the service, so they
  agree. All missing fields are reported together. **[DECIDED]**
- **Web.** Page `/venues/search`; the form's start date box has `min` set to today (Singapore time), so past dates
  cannot be picked, and the end date's `min` is the start date. The end date follows the start date until it is
  changed, so a one-day search needs one date. The results table shows opening hours. A "Search venues" link is on the dashboard for coordinators. **[DECIDED]**

---

## SCRUM-65 Search for Suitable Venues

**User story.** As an Event Coordinator, I want to search for venues based on an event's requirements so I can
identify suitable venues to request.

### Acceptance criteria

*AC1.* Given I have entered a date, start time and end time, when I search, the system shows only venues available for
that period.

*AC2.* Given I have also entered expected attendance, location, room layout, an accessibility requirement or required
facilities, when I search, the system shows only venues that meet every criterion I specified.

*AC3.* Given I have entered an expected attendance, when I search, the system shows only venues whose capacity is at
least that attendance.

*AC4.* Given the date, start time or end time is missing, when I search, the system prompts me for the missing
information.

*AC5.* Given I try to enter a date in the past, the system does not allow it.

*AC6.* Given the end time is before the start time, the system does not allow it.

*AC7.* Each result displays the venue name, location, capacity, accessibility, supported layouts and facilities.

*AC8.* Given no venues match, the system tells me no suitable venues were found.

### Tests

| ID | Scenario |
| --- | --- |
| 65-S1 | Free venues returned; the Singapore period is sent to the database as UTC (AC1). |
| 65-S2 | Location, layout, accessibility and all facilities together keep only the venue meeting all (AC2). |
| 65-S3 | Each filter on its own narrows the list (AC2). |
| 65-S4 | No filters: every free venue (AC2). |
| 65-S5 | Capacity equal to or above attendance is kept (AC3). |
| 65-S6 | With a layout chosen, the layout's own capacity counts (AC3). |
| 65-S7 | Missing date and times: 422 with a prompt per field (AC4). |
| 65-S8 | A past date: 422, no venues read (AC5). |
| 65-S9 | End before start: 422, for an end time before the start on one day and for an end date before the start date (AC6). |
| 65-S10 | 401 without a session, 403 for an organiser, 200 for venue staff. |
| 65-S11 | `/venues/search` is not read as a venue id. |
| 65-S12 | Each result carries all its details (AC7). |
| 65-S13 | `/venues/search-options` lists layouts and facilities. |
| 65-S14 | No match: 200 with an empty list; the page says no suitable venues were found (AC8). |
| 65-S15 | Operating hours: a venue that opens after the start or closes before the end is left out; no stated hours means open; a 00:00 closing time is midnight; opening and closing exactly at the edges is allowed (AC1). |
| 65-S16 | Multi-day period: the whole Singapore range is sent to the database as UTC; an end time earlier than the start time is fine on a later day (AC1). |
| 65-S17 | Location matches the venue name as well as the address, ignoring case (AC2). |
| DB | `available_venues` excludes overlapping holding bookings (all four statuses) and maintenance blocks, including other coordinators' bookings; allows back-to-back, another date, rejected bookings; leaves out inactive venues (AC1). |

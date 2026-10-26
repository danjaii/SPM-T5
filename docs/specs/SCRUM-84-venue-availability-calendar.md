# SCRUM-84 — View Venue Availability Calendar

**Jira:** SCRUM-84 [Venue Availability Calendar] View Venue Availability Calendar
**Branch:** `SCRUM-84/venue-availability-calendar`
**Scope:** API only. The calendar page is SCRUM-130 (another developer); no change under `apps/web`.
**Contract for the UI developer:** `.local/SCRUM-84-contract.md` (git-excluded, handed over directly).

## Story

As an `event_coordinator`, I want to see the status of every ConnectSphere venue across a date range I choose, so that I can
shortlist venues that are free for an event without asking Venue Staff to check for me.

Venue Staff and Technical Support Staff may open it too (AC1, AC8). It also serves SCRUM-85 (details panel) early: block
reasons and setup/turnaround are already in the payload (see Decisions).

Customer docs: briefing "Venue Availability Calendar: available, tentatively held, confirmed, blocked, or otherwise
unavailable"; project instructions "Authorised internal users can view venue availability"; week 2 Q: coordinators and Venue
Staff view the calendar; week 9 Q38/Q48: setup and turnaround pad events and holds, not maintenance blocks. Nothing
contradicts the ACs. Q41 (a block also stops holds) is already built (SCRUM-105).

## Acceptance criteria

Scenario `n` of ACx is tested as `SCRUM-84/ACx`.

### AC1 — Open the calendar
- **Given** I am signed in as an Event Coordinator, Venue Staff member, or Technical Support Staff member
- **When** I open the venue availability calendar
- **Then** I see every ConnectSphere venue with its status for the current week
- S1: no query parameters returns the current week, Monday 00:00 to the next Monday 00:00 Singapore time, from the injected clock.
- S2: all three roles get 200.
- S3: every active venue is listed (name, address, max_capacity), including a venue with no bookings (its whole week is one
  Available period, or Available/Unavailable by its operating hours). An inactive venue is not listed.
- S4: a Sunday-night clock (SGT) is still the same week; Monday 00:00 SGT starts the next one.

### AC2 — Show held, confirmed, and blocked periods
- **Given** a venue has a period that is tentatively held, has a confirmed booking, or has been blocked by Venue Staff
- **When** I view a date range that includes that period
- **Then** that period is shown with the text label Tentatively Held, Confirmed, or Blocked respectively, with its start and end time
- S1: a Pending booking (db `requested`) is `TENTATIVELY_HELD` / "Tentatively Held"; Approved (db `approved`, and legacy
  `tentative`, `confirmed`) is `CONFIRMED` / "Confirmed"; a `venue_unavailability` row is `BLOCKED` / "Blocked". Rejected,
  withdrawn, cancelled and replaced bookings do not appear.
- S2: each carries `start` and `end` as UTC ISO instants.
- S3 (block reason, asked for by the SCRUM-130 developer; serves SCRUM-85 AC3 early): a `BLOCKED` period carries `reason` (the
  enum key) and `reason_label` (e.g. "Maintenance"), the same label SCRUM-105 shows coordinators. Never `notes`, never who
  recorded it. Technical Support Staff are treated like coordinators.
- S4: a booking's event period carries `event_start`, `event_end`, `occupied_start`, `occupied_end`, `setup_minutes` and
  `turnaround_minutes`; the setup and turnaround are their own periods (kind `setup`, `turnaround`), never Available. A
  booking 10:00-12:00 with 30 and 45 minutes is occupied 09:30-12:45: setup 09:30-10:00, event 10:00-12:00, turnaround 12:00-12:45.
- S5: overlap precedence, highest first: Blocked, Confirmed event, Tentatively Held event, Confirmed setup/turnaround,
  Tentatively Held setup/turnaround, Available, Unavailable. So a block over a booking shows Blocked (the booking is flagged
  by SCRUM-106 elsewhere); a booking in non-operating hours shows its status. Periods never overlap.
- S6: no booking ids, event names, coordinators, `notes` or `created_by` are returned (36-S5).

### AC3 — Show available periods
- **Given** a venue has a period within its operating hours with no hold, booking, or block
- **When** I view a date range that includes that period
- **Then** that period is shown with the text label Available
- S1: free time inside operating hours is `AVAILABLE` / "Available". Setup and turnaround time is not Available (AC2 S4).
- S2: operating hours NULL (either column) means no restriction: free time is Available all day. Equal start and end is
  treated as NULL. An end before the start is an overnight window (22:00-02:00 runs into the next day).
- S3: operating hours are Singapore local time; the venue's `operating_hours` are echoed (`HH:MM`, or null).

### AC4 — Show periods outside operating hours
- **Given** a period falls outside a venue's operating hours
- **When** I view a date range that includes that period
- **Then** that period is shown with the text label Unavailable
- S1: outside operating hours and free is `UNAVAILABLE` / "Unavailable", per Singapore day. "Unavailable" is only for
  closed hours; a Venue Staff block is "Blocked", never "Unavailable".
- S2: a venue open 08:00-22:00 over one day gives Unavailable 00:00-08:00, Available 08:00-22:00, Unavailable 22:00-24:00.

### AC5 — Change the date range
- **Given** I am viewing the calendar
- **When** I select a single date, or a start date and an end date
- **Then** the calendar shows venue statuses for exactly that period
- S1: `?from=D` is that Singapore day only. S2: `?from=D1&to=D2` covers D1 00:00 to D2 24:00 SGT, both inclusive.
- S3: periods are clipped to the range (a booking running past midnight into the range appears from the range start) and
  cover it completely. S4: a range across a week or month boundary works. S5: `to` without `from` is a 422 on `from`.
- S6: the response echoes `range` (`from`, `to`, `start`, `end`, `time_zone`).

### AC6 — Reject an invalid date range
- **Given** I am viewing the calendar
- **When** I select an end date that is earlier than the start date
- **Then** the range is not applied, the previous view is kept, and I am told the end date must be on or after the start date
- S1: 422 `{ code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { to: "The end date must be on or after the start date." } }`; nothing is read from the database.
- S2: a malformed or non-existent date (`2026-02-30`, `14/11/2026`) is a 422 naming `from` or `to`.
- S3: a range of more than 62 days is a 422 on `to`. (The web keeps the previous view; the API changes no state.)

### AC7 — Show the latest recorded status
- **Given** a hold, booking, or block was recorded or changed after I opened the calendar
- **When** I reload the calendar
- **Then** the affected period shows its new status
- S1: every call reads the database again; `Cache-Control: no-store` is sent. No server cache.
- S2: a booking, hold or block added, and a hold approved, between two calls shows in the second.

### AC8 — Access control
- **Given** I am not signed in, or I am signed in as an Event Organiser or Attendee
- **When** I attempt to open the venue availability calendar
- **Then** I am prevented from opening it and no venue availability information is shown to me
- S1: no session is 401 `UNAUTHENTICATED`. S2: `event_organiser`, `attendee`, and also `event_coordinator_lead` and
  `safety_officer` (not named in the story) get 403 `FORBIDDEN`. S3: the 401/403 bodies hold no venue data and nothing is read.
- S4: `canViewVenueCalendar(role)` in `packages/shared` is the rule (coordinator, venue staff, technical support).
- S5: the database function refuses other roles too (42501), so the rule holds even if the service check is bypassed.

## Decisions

- **Endpoint:** `GET /venue-calendar` on venue-service, mounted outside the `/venues` gate (which excludes Technical Support
  Staff) with `requireSession` and its own role check.
- **Migration 58** `58_venue_calendar.sql`: `venue_calendar_entries(p_from, p_to)`, one security-definer call for all active
  venues' holding bookings (event and padded period, setup/turnaround minutes) and blocks (period and reason), for the three
  roles only. Why: `venue_occupied_periods` is per venue and refuses Technical Support Staff, and `venue_unavailability` has
  no SELECT policy for them, so reusing them would need 1 + N calls and still fail for one allowed role. It reuses
  `venue_padded_period` (27) and the same holding statuses (DR5), and returns no event, coordinator or notes. SCRUM-97 (hold
  expiry) redefines the same "holding" rule in 56-57; when it lands this function must copy its holding predicate.
  Venues themselves are read through the caller's token from `venues` (blanket RLS today).
- **Never the service-role key;** everything is `deps.forUser(token)`.
- **Time:** all instants are UTC ISO strings; ranges and days are Singapore dates; the current week is Monday-Sunday SGT.
- **Max range 62 days** (about two months, a month view plus margin). The work is `venues x periods`, so it is bounded.
- **Response is snake_case** like `/venues` (`max_capacity`) and the block reason fields asked for. Periods carry a `kind`
  (`event`, `setup`, `turnaround`, `block`, `open`, `closed`) so SCRUM-85 can add fields without breaking changes.
- **Split of work:** `packages/shared/src/venueCalendar.ts` has the range parser (the web
  can validate with the same code; the role rule is in `roles.ts`); `services/venue-service/src/services/venueCalendarService.ts` builds periods (pure).

## AC → test mapping

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `services/venue-service/tests/unit/venueCalendarOpen.test.ts` | `SCRUM-84/AC1 …` |
| AC2 | `services/venue-service/tests/unit/venueCalendarPeriods.test.ts` | `SCRUM-84/AC2 …` |
| AC3, AC4 | `services/venue-service/tests/unit/venueCalendarHours.test.ts` | `SCRUM-84/AC3 …`, `SCRUM-84/AC4 …` |
| AC5, AC6 | `packages/shared/tests/unit/venueCalendarRange.test.ts`; `services/venue-service/tests/unit/venueCalendarRange.test.ts` | `SCRUM-84/AC5 …`, `SCRUM-84/AC6 …` |
| AC7 | `services/venue-service/tests/unit/venueCalendarFresh.test.ts` | `SCRUM-84/AC7 …` |
| AC8 | `packages/shared/tests/unit/canViewVenueCalendar.test.ts`; `services/venue-service/tests/unit/venueCalendarAccess.test.ts` | `SCRUM-84/AC8 …` |
| AC1-AC8 (database) | `services/venue-service/tests/integration/venueCalendar.test.ts` | `SCRUM-84 …` (not run by the author) |

(Kept current as tests are written.)

## Affected workspaces

- `services/venue-service` (route, reader, service, tests), `packages/shared` (role rule, range parser; affects the web app only if it adopts them).
- `supabase/migrations/58_venue_calendar.sql` (new, flag in the PR).
- C4: a component diagram update for venue-service would list the new route; not edited here (`docs/architecture` is out of bounds).

## Out of scope

- The calendar UI (SCRUM-130) and the details panel (SCRUM-85: venue details, free window, setup/turnaround labels).
- An expired hold showing as Available (SCRUM-97).
- Buffer-conflict and "Venue unavailable" booking flags (SCRUM-104, 106) are not drawn.

## Open questions

- Should a block over a Confirmed booking show Blocked (chosen) or Confirmed? SCRUM-85 can add an `overlaps` field.
- Technical Support Staff see the block reason label (as coordinators do); confirm with the PO.

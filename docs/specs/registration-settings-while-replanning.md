# Registration While an Event Is Back in Planning: Final User Story

User story for the **AC4** part of SCRUM-185 ([Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to Planning, and
a Block Can Be Lifted), ConnectSphere, IS212, compiled 2026-11-03.

- Scenario numbers are the test IDs: `185-S4` means SCRUM-185, the scenario for **AC4**.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.
- Written before the code. It builds on AC1 (`venue-block-reverts-event.md`, which returns a Confirmed event to Planning).

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-185 | [Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to Planning, and a Block Can Be Lifted | AC1, SCRUM-83 and SCRUM-169 (registration and capacity), SCRUM-111 (the coordinator edits an event) |

## Why

When a venue block sends a Confirmed event back to Planning (AC1), people may already have registered, and the replacement venue
may be smaller or the dates may move. The customer said in the Week 9 Q&A that, while the event is being re-planned, registration
may be paused or adjusted by the coordinator (row 44). Today the coordinator has no way to change an event's registration
capacity or window at all (the event edit form has no registration fields), and nothing tells them that registration is closed
while the event is in Planning. **[DECIDED]**

## Implementation decisions

- **Paused automatically while the event is not Confirmed (already true, now tested and shown).** `register_for_event()` (migration
  68) refuses unless the event is Confirmed, and `list_public_events()` (migration 28) lists only Confirmed or Cancelled events,
  so an event in Planning is not offered to attendees and nobody can register. Existing registrations are left exactly as they
  are (not cancelled, not moved). When the event is Confirmed again, registration reopens within its window. **[DECIDED]**
- **The coordinator can adjust registration.** The assigned coordinator can change the event's registration capacity, opening
  time and closing time, in any status except a closed one (Completed, Cancelled, Rejected), through a new function
  `update_registration_settings()` (migration 84). Because the window can be set to close now, this also lets a coordinator pause
  registration on a Confirmed event, or shift the window while re-planning. **[PROPOSED]**
- **The rules are the request form's.** The event must take registrations (`registration_required`); the capacity is a whole number
  from 1; the closing time must be after the opening time and no later than the event's start (the same rules as
  `parseEventRequest`, SCRUM-49). The capacity may not drop below the number of **Confirmed** registrations (Pending ones do not
  hold a place, SCRUM-83/AC13), so nobody who holds a place is pushed out. Past times are allowed: they are how a coordinator
  closes registration early. **[DECIDED]**
- **Only the assigned coordinator.** Everyone else, including the organiser, the Lead and venue staff, is refused (`42501`). The
  function checks it; the route's 403 is the friendly message. **[DECIDED]**
- **Logged.** Each change writes an `activity_log` row (`registration_settings_changed`, with the old and new values). **[PROPOSED]**
- **Screen.** The event page's Registrations tab shows the coordinator a "Registration settings" form (capacity, opens, closes) and,
  when the event is not Confirmed, a note that registration is closed until it is Confirmed again. Everyone else sees no form.
  Times are entered and shown in Singapore time. **[PROPOSED]**
- **Not built: a separate pause switch.** There is no "paused" flag. Closing the window does the same, and the status already
  pauses it during re-planning. Recorded in `docs/scope-decisions.md`. **[DECIDED]**

## Scenarios

### 185-S4 (AC4) Registration is closed while the event is in Planning

- **Given** an event that a block returned to Planning, with one Confirmed and one Pending registration
- **When** an attendee looks for it or tries to register
- **Then** it is not listed, registering is refused, and the two existing registrations are unchanged.

### 185-S4b The coordinator adjusts registration

- **Given** the assigned coordinator of an event that takes registrations, with 5 Confirmed registrations
- **When** they set a capacity of 40, an opening time and a closing time before the event starts
- **Then** the event has those values, the change is logged, and the answer shows them.

### 185-S4c Capacity cannot cut out someone who holds a place

- **Given** an event with 5 Confirmed registrations
- **When** the coordinator sets a capacity of 4
- **Then** it is refused with a message on the capacity field, naming the 5, and nothing changes. Pending registrations do not count.

### 185-S4d The window must make sense

- **Given** the coordinator
- **When** the closing time is not after the opening time, or is after the event's start, or the capacity is not a whole number
  from 1, or a time is missing or not a date
- **Then** each is refused with a message on its own field, and nothing changes.

### 185-S4e Only the assigned coordinator

- **Given** another coordinator, the organiser, a Lead, venue staff, an attendee, or nobody signed in
- **When** they try to change the settings
- **Then** they are refused (403, or 401 when not signed in) and nothing changes.

### 185-S4f Closed events and events without registration

- **Given** a Completed, Cancelled or Rejected event, or an event that does not take registrations
- **When** the coordinator tries to change the settings
- **Then** the first is refused as locked (409) and the second with a message that the event does not take registrations (422).

### 185-S4g The screen

- **Given** the event's Registrations tab
- **When** the coordinator opens it, and later saves new values
- **Then** they see the current values in Singapore time, a note when the event is not Confirmed, and a confirmation after saving;
  other roles see no form.

## Out of scope

A separate pause flag, changing which attendees hold places, notifying attendees of a changed window, and email or SMS.

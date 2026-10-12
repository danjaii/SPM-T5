# Event Search and Filtering: Final User Story

User story for **Event Search and Filtering** (ConnectSphere, IS212), compiled 2026-10-12.

- Scenario numbers are the test IDs: `9-S4` means SCRUM-9, Scenario 4.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-9 | Event Search and Filtering | SCRUM-71 (the attendee's List of events and its cards) and SCRUM-83 (registrations, which decide the available slots) |

The Week 1 Customer Briefing says "Users can search for events using suitable criteria such as event name, client
organisation, date, venue, status, category, or assigned coordinator". The Jira story is written for an **attendee**, so this is
built for the attendee's List of events. The same matching rule could serve the coordinator and organiser lists later.

## Implementation decisions (2026-10-12)

These override the text below where they conflict.

- **One search box, filtering as you type.** There is no Search button. The cards narrow after every keystroke, and a **×** clear
  button (shown only while something is typed) empties the box and shows the full list again. Escape does the same. The text is
  not kept in the address, so a refresh clears it. **[DECIDED]**
- **The browser does the filtering.** event-service sends every upcoming event with the details that can be searched, and the page
  hides the ones that do not match. No search code runs on the server. **[DECIDED]**
- **Everything searchable is sent to every attendee's browser,** including events that do not match, such as the assigned
  coordinator's name and the client organisation. The story says attendees can search by these, so this is intended. **[DECIDED]**
- **What is searched.** The seven criteria from the briefing: event name, client organisation, date, venue, status, category and
  assigned coordinator. **[DECIDED]**
  - **Venue** is the venue's name and its address.
  - **Status** is the event's status ("confirmed", "cancelled") and the word on the card ("Event Full", "Registration Closed",
    "Cancelled"), because that is what an attendee sees as its status.
  - **Date** is understood in the forms people write it: `2026-12-12`, "12 Dec 2026", the full month name ("december") and the
    weekday ("sat", "saturday"). Dates are in Singapore time, like the cards. The date is matched as **whole parts** (the full ISO
    date, the day, the month, the year, the weekday), exactly for numbers and, for letters, as the start of a part, so "12" means
    the day 12 and not the 12 inside `2026-12-13`.
- **How words match.** Capital letters do not matter. The text is split into words, and **every word must appear somewhere** in the
  event's searchable details (as part of a word is enough: "ball" finds "Ballroom"). The words may match different details, so
  "gala dec" finds the Gala Dinner in December. An empty box, or only spaces, shows every event. **[DECIDED]**
- **A missing detail is skipped.** An event with no venue yet, no category or no coordinator can still be found by its other
  details, and nothing breaks. **[DECIDED]**
- **Available slots** are the capacity minus the Confirmed registrations (a Pending one holds no slot, SCRUM-83/AC13), never below 0.
  An event with no capacity has no limit. The card says "12 slots left", "1 slot left", "No slots left" or "No limit". **[DECIDED]**
- **No matches.** When events exist but none match, the page says `No events match "<what was typed>"`. When there are no upcoming
  events at all, the page still says "No upcoming events" (SCRUM-71/AC11). **[DECIDED]**
- **Only upcoming events** stay in the list, as before (SCRUM-71/AC2). **[DECIDED]**
- **event-service** adds to each event of `GET /events/upcoming`: `organisation`, `category` and `coordinator` (names, or `null`),
  `status`, and `available_slots` (a number, or `null` for no limit). The list function `list_public_events()` is dropped and
  created again with three more columns (migration 20); the registration story's function is changed only by adding those
  columns. **[DECIDED]**
- **Where the code lives.** The matching rule is one function in `apps/web/src/lib/eventSearch.ts`, and the search box is a client
  component that wraps the existing `UpcomingEventList`. **[PROPOSED]**

---

## SCRUM-9 Event Search and Filtering

**User story.** As an attendee, I want to search for events using keywords so that I can quickly find the specific events without
looking through the entire list of events.

### Acceptance criteria

*AC1.* Enter event name, client organisation, date, venue, status, category or assigned coordinator into the search bar.

*AC2.* Matching events are displayed as cards showing the name, date, time, venue and available slots of the event.

*AC3.* If no matches are found, display a clear message.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 9-S1 | AC1 | Nothing typed, or only spaces | every event matches |
| 9-S2 | AC1 | A word from an event's name | that event matches, and an event without the word does not |
| 9-S3 | AC1 | A word from the client organisation | that event matches |
| 9-S4 | AC1 | A word from the venue's name or address | that event matches |
| 9-S5 | AC1 | A word from the category | that event matches |
| 9-S6 | AC1 | A word from the assigned coordinator's name | that event matches |
| 9-S7 | AC1 | A status word: "confirmed", "cancelled", "full", "registration closed" | the events with that status or label match |
| 9-S8 | AC1 | A date as `2026-12-12`, "12 dec", "december", "dec 2026", "sat" or "saturday" | the events on that date, month or weekday match (Singapore time) |
| 9-S9 | AC1 | The same word in capitals, small letters or mixed | the same events match |
| 9-S10 | AC1 | Several words | only events matching every word |
| 9-S11 | AC1 | Several words that match different details | the event matches ("gala dec") |
| 9-S12 | AC1 | An event with no venue, category or coordinator | it can still be found by its other details, and nothing breaks |
| 9-S13 | AC2 | `GET /events/upcoming` | each event has `organisation`, `category`, `coordinator` (names or `null`) and `status` |
| 9-S14 | AC2 | `GET /events/upcoming` for an event with capacity 100 and 40 Confirmed registrations | `available_slots` is 60 |
| 9-S15 | AC2 | More Confirmed registrations than capacity | `available_slots` is 0, never negative |
| 9-S16 | AC2 | An event with no capacity | `available_slots` is `null` |
| 9-S17 | AC2 | A card | shows "12 slots left", "1 slot left", "No slots left" or "No limit" as well as the name, date, time and venue |
| 9-S18 | AC1 | Typing in the search box | the cards narrow at once, with no button pressed |
| 9-S19 | AC1 | The box is empty | no × is shown; once something is typed, a × appears |
| 9-S20 | AC1 | The × is pressed | the box is emptied and every event is shown again |
| 9-S21 | AC1 | Escape is pressed in the box | the same as pressing × |
| 9-S22 | AC3 | Events exist but none match | the page says `No events match "<what was typed>"` |
| 9-S23 | AC3 | There are no upcoming events at all | the page says "No upcoming events", not the no-match message |
| 9-S24 | AC1 | The attendee's page | the search box is above the cards and has a label for screen readers |

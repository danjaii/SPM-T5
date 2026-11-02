import { describe, expect, it } from "vitest";
import { matchesSearch } from "@/lib/eventSearch";
import type { UpcomingEvent } from "@/lib/getUpcomingEvents";

// ----------------------------------------------------------------------------
// Test setup: events as the attendee's List of events gets them (docs/specs/event-search.md)
// ----------------------------------------------------------------------------

/** One event, with every searchable detail filled in. A test changes only what it is about. */
const anEvent = (overrides: Partial<UpcomingEvent> = {}): UpcomingEvent => ({
  id: "evt-1",
  name: "Pacific Rim Gala Dinner",
  start_at: "2026-12-12T10:30:00Z", // Sat, 12 Dec 2026, 6:30 PM in Singapore
  end_at: "2026-12-12T14:30:00Z",
  venue: { name: "Riverside Grand Ballroom", address: "Jurong Gateway Road" },
  availability: "open",
  my_registration: null,
  status: "confirmed",
  organisation: "Pacific Rim Trade Association",
  category: "Conference",
  coordinator: "Rachel Tan",
  available_slots: 40,
  can_register: true,
  ...overrides,
});

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-9/AC1 which events a typed search matches
// ----------------------------------------------------------------------------

describe("SCRUM-9/AC1 matchesSearch", () => {
  // A word from an event's name finds that event, and not an event without the word.
  // this is for event name
  it("9-S2: matches an event whose name has the typed word, and not one without it", () => {
    const gala = anEvent({ name: "Pacific Rim Gala Dinner" });
    const summit = anEvent({ id: "evt-2", name: "TechConnect Annual Summit" });

    expect(matchesSearch(gala, "gala")).toBe(true);
    // the person typed gala and the event is gala, so should return true
    expect(matchesSearch(summit, "gala")).toBe(false);
    // the person typed gala and the event is summit, so should return false
  });
  // end of name

  // A word from the client organisation (the company that booked the event) finds that event, even when the word is not in its name.
  it("9-S3: matches an event by its client organisation", () => {
    // this is for client organisation
    const pacific = anEvent({ name: "Annual Summit", organisation: "Pacific Rim Trade Association" });
    const techconnect = anEvent({ id: "evt-2", name: "Annual Summit", organisation: "TechConnect Pte Ltd" });

    expect(matchesSearch(pacific, "pacific")).toBe(true);
    // the person typed pacific and the org is pacific, so should return true
    expect(matchesSearch(techconnect, "pacific")).toBe(false);
    // the person typed pacific and the org is techconnect, so should return false 
  });
  // end of organisation

  // A word from the venue's name, or from its address, finds that event.
  it("9-S4: matches an event by its venue's name or its address", () => {
    const ballroom = anEvent({ name: "Annual Summit", venue: { name: "Riverside Grand Ballroom", address: "12 Jurong Gateway Road" } });
    const hall = anEvent({ id: "evt-2", name: "Annual Summit", venue: { name: "Orchid Hall", address: "Level 3, East Wing" } });
    // we want to search by venue name or by the venue address 
    expect(matchesSearch(ballroom, "ballroom")).toBe(true); // from the name
    expect(matchesSearch(ballroom, "jurong")).toBe(true); // from the address
    // jurong is the address, the event name is riverside grand ballroom, so they are related for that event
    // so we should return true 
    expect(matchesSearch(hall, "ballroom")).toBe(false);
    // orchid hall name has no ballroom, so return false
    expect(matchesSearch(hall, "jurong")).toBe(false);
    // orchid hall address is level 3 east wing, so return false 
  });
  // end of venue

  // A word from the event's category (such as Conference or Workshop) finds that event.
  it("9-S5: matches an event by its category", () => {
    const conference = anEvent({ name: "Annual Summit", category: "Conference" });
    const workshop = anEvent({ id: "evt-2", name: "Annual Summit", category: "Workshop" });
    // we want to search by event category 

    expect(matchesSearch(conference, "conference")).toBe(true);
    expect(matchesSearch(workshop, "conference")).toBe(false);
  });
  // end of category

  // A word from the assigned coordinator's name finds the events that coordinator looks after.
  it("9-S6: matches an event by its assigned coordinator", () => {
    // we want to find the event coordinator's name
    const rachels = anEvent({ name: "Annual Summit", coordinator: "Rachel Tan" });
    const marcuss = anEvent({ id: "evt-2", name: "Annual Summit", coordinator: "Marcus Lim" });

    expect(matchesSearch(rachels, "rachel")).toBe(true);
    // return true because we are searching for rachel
    expect(matchesSearch(marcuss, "rachel")).toBe(false);
    // return false because we are searching for rachel, but the name in the database is marcuss
  });
  // end of coordinator

  // Status is what an attendee sees on the card as well as the event's own status: "confirmed" or "cancelled", and the label
  // "Event Full", "Registration Closed" or "Cancelled". Each word finds the events it describes, and not the others.
  it.each([
    ["confirmed", { status: "confirmed" }, { status: "cancelled", availability: "cancelled" }],
    ["cancelled", { status: "cancelled", availability: "cancelled" }, { status: "confirmed", availability: "open" }],
    ["full", { availability: "full" }, { availability: "open" }],
    ["registration closed", { availability: "closed" }, { availability: "open" }],
  ] as const)("9-S7: matches an event by its status, for '%s'", (word, described, other) => {
    const matching = anEvent({ name: "Annual Summit", ...described });
    const notMatching = anEvent({ id: "evt-2", name: "Annual Summit", ...other });
    // we want to search by status
    // the status in the database has only 2 values for the events, confirmed and cancelled
    // there are also other status, such as 'full' that is not saved in the database
    // event-service works them out each time the list is asked for, from the capacity and the registration dates
    // the attendee sees them on the card, so they should be able to search for them too
    // the reason they are not stored in the database is because they keep changing
    // registrations come and go, and time passes, but a saved status does not change by itself
    // so a saved status could be wrong, and a worked-out one is right at that moment
    expect(matchesSearch(matching, word)).toBe(true);
    expect(matchesSearch(notMatching, word)).toBe(false);
  });
  // end of status

  // The date can be typed the way people write it: as 2026-12-12, "12 dec", the month ("december"), "dec 2026", or the weekday
  // ("sat", "saturday"). The anEvent() default starts on Saturday 12 December 2026 (Singapore time).
  // we want to search by the date of the event
  it.each(["2026-12-12", "12 dec", "12 dec 2026", "dec", "december", "dec 2026", "sat", "saturday"])(
    "9-S8: matches an event on Saturday 12 December 2026 for '%s'",
    (typed) => {
      expect(matchesSearch(anEvent({ name: "Annual Summit" }), typed)).toBe(true);
    },
  );

  // A different day, month or weekday does not match.
  it.each(["2026-12-13", "13 dec", "november", "sunday"])("9-S8: does not match an event on Saturday 12 December 2026 for '%s'", (typed) => {
    expect(matchesSearch(anEvent({ name: "Annual Summit" }), typed)).toBe(false);
  });

  // Dates are in Singapore time, like the cards. This event starts at 5:00 PM UTC, which is already 1:00 AM on Sunday 13 December
  // in Singapore, so it is a Sunday event.
  it("9-S8: reads the date in Singapore time", () => {
    const late = anEvent({ name: "Annual Summit", start_at: "2026-12-12T17:00:00Z", end_at: "2026-12-12T19:00:00Z" });

    expect(matchesSearch(late, "13 dec")).toBe(true);
    expect(matchesSearch(late, "sunday")).toBe(true);
    expect(matchesSearch(late, "12 dec")).toBe(false);
    expect(matchesSearch(late, "saturday")).toBe(false);
  });

  // A day below 10 is written 05 in 2026-12-05 and 5 in "5 dec": both find the event.
  it.each(["2026-12-05", "5 dec", "5 dec 2026"])("9-S8: finds an event on Saturday 5 December 2026 for '%s'", (typed) => {
    const fifth = anEvent({ name: "Annual Summit", start_at: "2026-12-05T03:00:00Z" }); // 11:00 AM in Singapore

    expect(matchesSearch(fifth, typed)).toBe(true);
  });
  // end of date

  // Several words narrow the search: every word must be found somewhere in the event's details, in any order. The words can match
  // different details, so "gala dec" finds the Gala Dinner (its name) in December (its date).
  it("9-S10: needs every typed word to match, and the words can match different details", () => {
    const gala = anEvent({ name: "Pacific Rim Gala Dinner" }); // Saturday 12 December 2026
    // the event is "Pacific Rim Gala Dinner" (Saturday 12 December, assigned to Rachel Tan, at the Ballroom, a Conference)

    expect(matchesSearch(gala, "gala dec")).toBe(true); // name + date
    expect(matchesSearch(gala, "dec gala")).toBe(true); // any order
    expect(matchesSearch(gala, "rachel ballroom")).toBe(true); // coordinator + venue
    expect(matchesSearch(gala, "gala conference")).toBe(true); 
    expect(matchesSearch(gala, "gala november")).toBe(false); // one word is missing
    expect(matchesSearch(gala, "gala workshop")).toBe(false); // it is a Conference
  });
  // end of several words

  // With nothing typed, or only spaces, there is nothing to narrow down, so every event matches.
  it.each(["", " ", "   "])("9-S1: matches every event when the typed text is '%s'", (typed) => {
    expect(matchesSearch(anEvent(), typed)).toBe(true);
    expect(matchesSearch(anEvent({ id: "evt-2", name: "Annual Summit", venue: { name: null, address: null } }), typed)).toBe(true);
  });
  // end of empty box

  // Capital letters make no difference to what is found, whether in the typed text or in the event.
  it.each(["gala", "GALA", "Gala", "gAlA"])("9-S9: finds the Gala Dinner for '%s'", (typed) => {
    expect(matchesSearch(anEvent({ name: "Pacific Rim GALA Dinner" }), typed)).toBe(true);
  });
  // end of capitals

  // An event may have no venue yet, no category, no coordinator or no organisation. It can still be found by its other details,
  // and a missing detail never causes an error or a wrong match.
  it("9-S12: finds an event that has some details missing, by the details it has", () => {
    const bare = anEvent({ name: "Annual Summit", organisation: null, category: null, coordinator: null, venue: { name: null, address: null } });

    expect(matchesSearch(bare, "summit")).toBe(true); // its name
    expect(matchesSearch(bare, "dec")).toBe(true); // its date
    expect(matchesSearch(bare, "confirmed")).toBe(true); // its status
    expect(matchesSearch(bare, "ballroom")).toBe(false); // it has no venue
    expect(matchesSearch(bare, "null")).toBe(false); // a missing detail is not the word "null"
    expect(matchesSearch(bare, "undefined")).toBe(false);
  });
  // end of missing details
});
// end of SCRUM-9/AC1 matchesSearch

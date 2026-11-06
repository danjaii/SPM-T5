// Manual test scripts, part 2: ACL, ASSIGN and AUTH. See setups.ts for S0 to S9 and API. Free of imports (Node loads it directly).

const OWNERS = [
  "/lead/queue: Event Coordinator Lead only",
  "/booking-queue: Venue Staff only",
  "/safety-checks: Safety Officer only",
  "/equipment-requests, /equipment-availability, /equipment-inventory, /equipment-catalogue, /equipment-reservation: Technical Support Staff only",
  "/my-event-requests: Event Organiser only",
  "/venue-calendar: Event Coordinator, Venue Staff and Technical Support Staff",
  "/dashboard/<role>: that role only (the Lead's dashboard address forwards to /lead/queue)",
];

export const MANUAL = {
  "E2E-ACL-01": {
    setups: ["S0"],
    preconditions: "The stack is running with the seeded accounts. One account per role (see the accounts table).",
    data: `Who may open which page:\n${OWNERS.map((o) => `- ${o}`).join("\n")}`,
    steps: [
      "Sign in as one role (S0).",
      "Type each address from the table that this role does NOT own (and each other role's /dashboard/<role>) into the address bar, one at a time.",
      "Note where each one ends up.",
      "Open the role's own dashboard and one page it owns.",
      "Repeat for all seven roles (use a private window per role).",
    ],
    expected: [
      "Every address the role does not own ends on the page \"You don't have access to this page\" (address `/access-denied`), with a link back to the person's own home. No blank or broken screen, and no data from the refused page.",
      "The role's own dashboard opens (the Lead's ends on `/lead/queue`) and so does the page it owns.",
    ],
  },
  "E2E-ACL-02": {
    setups: ["API", "S0"],
    preconditions: "An unassigned submitted request (S1 only), a Pending venue booking for an approved event assigned to Rachel Tan (S4, S7, then request the venue as Rachel Tan), an event waiting for its safety check (golden journey step 6, E2E-JRN-01), an item of equipment (S8). Note each id from the page addresses.",
    data: "Calls, each allowed for one role only: GET `:4002/lead/queue` and POST `:4002/lead/events/<event id>/assign` (Lead); POST `:4003/venue-bookings/<booking id>/approve` and `/reject` (Venue Staff); POST `:4002/safety-checks/<event id>/decision` (Safety Officer); POST `:4003/venue-bookings` and GET `:4003/events/<event id>/venue-bookings` (the assigned Event Coordinator); POST `:4004/equipment-reservations` (Technical Support Staff).",
    steps: [
      "For each call in the data, sign in through the service (API) as every role except the allowed one, and make the call.",
      "Make the same call with no cookie at all.",
      "After each call check, in the screens, that nothing changed: the request is still unassigned, the booking still Pending, no safety decision recorded, no new booking, no equipment reserved.",
      "As the assigned coordinator, list the event's venue bookings.",
    ],
    expected: [
      "Every wrong-role call answers 403 and changes nothing.",
      "Every call with no cookie answers 401.",
      "The assigned coordinator's list answers 200, so the refusals are about the caller, not a broken address.",
    ],
  },
  "E2E-ACL-03": {
    setups: ["S0", "API", "S1", "S2"],
    preconditions: "A submitted request assigned to Rachel Tan (S1, S2). Marcus Lim is another coordinator.",
    data: "The event's id from its address.",
    steps: [
      "Sign in as Rachel Tan. Open **Event requests**: the event is listed. Open it.",
      "Sign in as Marcus Lim (private window). Open **Event requests**: the event is not listed.",
      "As Marcus Lim open `/events/<event id>`.",
      "With Marcus Lim's cookie (API), GET `:4002/events/<id>` and PATCH `:4002/events/<id>/status` with `{\"status\":\"under_review\"}`.",
      "As Rachel Tan, check the event is still **Submitted**.",
    ],
    expected: [
      "Rachel Tan sees and opens the event; the API read answers 200.",
      "Marcus Lim's list does not show it. His page shows no event name and no **Start review**; his GET answers 404 (the event looks as if it does not exist).",
      "His status change is refused (403 or 404) and the event is still Submitted.",
    ],
  },
  "E2E-ACL-04": {
    setups: ["S0", "S9"],
    preconditions: "A Confirmed event with registration open, organised by Jason Chua and assigned to Rachel Tan (S9). The automated test also covers a registrant who registered before the form existed and so has no form details (read from the profile); a person cannot create that by hand, so it is not part of this script.",
    data: "Alicia Fernandez and Bryan Ho each register through the form.",
    steps: [
      "Sign in as Bryan Ho. Open `/events/<event id>/register`, press **Register**.",
      "Sign in as Alicia Fernandez. Open `/events/<event id>/register`: check **Email**, **Name** and **Contact number** are already filled in. Press **Register**.",
      "Sign in as Jason Chua (organiser) and as Rachel Tan (assigned coordinator). Each opens `/events/<event id>/registrations`.",
      "Sign in as Marcus Lim (another coordinator) and open the same address.",
      "As Rachel Tan open **Profile** (`/profile`).",
    ],
    expected: [
      "The form shows Alicia's own email, name and number. After Register she sees she is registered.",
      "Jason and Rachel see both Alicia's and Bryan's rows with email addresses and phone numbers.",
      "Marcus sees no registrant rows and no email address.",
      "Rachel's profile shows her own contact email and phone.",
    ],
  },
  "E2E-ACL-05": {
    setups: ["API", "S7", "S4"],
    preconditions: "An approved event assigned to Rachel Tan (S7) and a venue (S4). Marcus Lim is not assigned to it.",
    data: "Event id, venue id. POST `:4003/venue-bookings` body `{\"eventId\":\"<event id>\",\"venueId\":\"<venue id>\",\"date\":\"2031-11-14\",\"startTime\":\"10:00\",\"endTime\":\"12:00\"}`.",
    steps: [
      "With Marcus Lim's cookie (API) POST the body above.",
      "With Marcus Lim's cookie GET `:4003/events/<event id>/venue-bookings`.",
      "As Rachel Tan check the event has no booking.",
    ],
    expected: [
      "Both calls answer 404 (spec 98-S26 and 98-S27: Marcus cannot see an event assigned to someone else, so it looks as if it does not exist) and no booking exists.",
    ],
  },
  "E2E-ASSIGN-01": {
    setups: ["S0", "S1", "S2"],
    preconditions: "Two submitted, unassigned requests created a few minutes apart (S1 twice, with two names), the first with Expected attendance 55.",
    data: "Assign the older one to Marcus Lim.",
    steps: [
      "Sign in as Helen Ong. On the unassigned queue note the order, and the organiser and number of people on each row.",
      "On the older request open **Assign to…**, choose Marcus Lim and press **Confirm assigning <name>**.",
      "Look at the queue again.",
      "Sign in as Marcus Lim and open **Event requests**.",
    ],
    expected: [
      "Both requests are listed, oldest first, with Jason Chua as organiser and \"55 people\" on the older one.",
      "After the assignment the older request leaves the queue; the newer one stays.",
      "Marcus Lim sees the older request in his list.",
    ],
  },
  "E2E-ASSIGN-02": {
    setups: ["S0", "S1", "S2", "API"],
    preconditions: "An event assigned to Rachel Tan and under review (S1, S2, then Start review as Rachel Tan).",
    data: "Reassign to Marcus Lim.",
    steps: [
      "With each coordinator's cookie (API) GET `:4002/events/<event id>`: Rachel Tan, then Marcus Lim.",
      "As Helen Ong open `/lead/events/<event id>/reassign`, choose **Marcus Lim** and press **Confirm reassignment**.",
      "Repeat both GET calls.",
      "Open **Notifications** as Marcus Lim, as Rachel Tan and as Helen Ong.",
    ],
    expected: [
      "Before: Rachel's read answers 200, Marcus's 404.",
      "After the reassignment: Marcus's answers 200 and Rachel's 404.",
      "Marcus has one \"You are responsible for an event\" notification for the event; Rachel (replaced) and Helen (who made the change) have none for it.",
    ],
  },
  "E2E-ASSIGN-03": {
    setups: ["S0", "S1", "API"],
    preconditions: "A submitted, unassigned request (S1). Two Leads, Helen Ong and Samuel Tay, in two windows.",
    data: "Helen chooses Marcus Lim; Samuel assigns the same event to Priya Nair.",
    steps: [
      "As Helen Ong open `/lead/events/<event id>/assign` and choose **Marcus Lim**, but do not confirm yet.",
      "As Samuel Tay assign the same event to Priya Nair (queue row, **Assign to…**, **Confirm assigning**).",
      "Back in Helen's window press **Confirm assignment**.",
    ],
    expected: [
      "Helen's confirmation is refused with a message that the event has already been assigned.",
      "The event is still assigned to Priya Nair (check as Priya Nair, or in Samuel's coordinator overview).",
    ],
  },
  "E2E-ASSIGN-04": {
    setups: ["S0", "S1"],
    preconditions: "A submitted, unassigned request (S1). Helen Ong supervises Rachel Tan and Marcus Lim; Priya Nair is Samuel Tay's.",
    data: "Assign to Priya Nair.",
    steps: [
      "Sign in as Helen Ong, then as Samuel Tay: each opens the unassigned queue.",
      "As Helen Ong open **Coordinator overview**.",
      "On the request's row open **Assign to…**, choose **Priya Nair**, press **Confirm assigning <name>**.",
      "Open **Coordinator overview**, open Priya Nair.",
    ],
    expected: [
      "Both Leads see the request in the queue.",
      "The overview lists Rachel Tan (Helen's) and Priya Nair (Samuel's) with their workload.",
      "The request leaves the queue and shows on Priya Nair's page.",
    ],
  },
  "E2E-AUTH-01": {
    setups: ["S0"],
    preconditions: "The seeded accounts.",
    data: "One account per role from the accounts table.",
    steps: ["For each of the seven roles, open a private window and sign in through the form (S0)."],
    expected: ["Each lands on its own home: `/dashboard/<role>` with the sidebar visible straight away, and the Lead on `/lead/queue`."],
  },
  "E2E-AUTH-02": {
    setups: [],
    preconditions: "None.",
    data: "Alicia Fernandez's email; a wrong password; her correct password with the role set to Event Organiser.",
    steps: [
      "Open `/login`. Enter Alicia's email, the wrong password and role Attendee. Press **Sign in**.",
      "Reload `/login`. Enter her email, the right password and role **Event Organiser**. Press **Sign in**.",
    ],
    expected: [
      "Both attempts show an inline error (\"Invalid …\"), the same wording each time, so it does not say which part was wrong.",
      "The email stays filled in on the first attempt; you stay on `/login`; no session starts (opening `/dashboard/attendee` still sends you to `/login`).",
    ],
  },
  "E2E-AUTH-03": {
    setups: ["S0"],
    preconditions: "Signed out.",
    data: "Any event id for the register address.",
    steps: [
      "Signed out, open `/dashboard/attendee`, then `/booking-queue`.",
      "Open `/events/<any id>/register`: note the address you land on.",
      "Sign in as Alicia Fernandez (S0) on that page.",
    ],
    expected: [
      "The first two end on `/login`.",
      "The register address sends you to `/login?next=<the register address>`, and after signing in you land on the register page you were going to.",
    ],
  },
  "E2E-AUTH-04": {
    setups: ["S0"],
    preconditions: "Signed in as Alicia Fernandez.",
    data: "None.",
    steps: [
      "In the sidebar press **Log out**.",
      "Press the browser's **Back** button.",
      "Open `/dashboard/attendee`.",
    ],
    expected: [
      "Log out lands on `/login`, and the session is gone.",
      "Back does not show the dashboard again, and `/dashboard/attendee` ends on `/login`.",
    ],
  },
  "E2E-AUTH-05": {
    setups: ["S0"],
    preconditions: "One account per role.",
    data: "A desktop-width window (1280 px) and a phone-width window (375 px; use the browser's device mode).",
    steps: [
      "Sign in as each role. At 1280 px open `/dashboard/<role>` (the Lead: `/lead/queue`). Look at the sidebar.",
      "Resize to 375 px and open the same page again.",
      "Open the menu button and look at the list.",
    ],
    expected: [
      "The sidebar's **Home** item is highlighted, and only that one item.",
      "At 375 px the sidebar is hidden, the page does not scroll sideways, **Open menu** shows a menu that lists **Home**.",
    ],
  },
  "E2E-AUTH-06": {
    setups: [],
    preconditions: "A 375 px wide window.",
    data: "Alicia Fernandez.",
    steps: ["At 375 px open `/login`. Check for a sideways scroll bar. Sign in as Alicia Fernandez (Attendee). Check the home page."],
    expected: ["No sideways scroll on either page; sign-in works and ends on `/dashboard/attendee`."],
  },
};

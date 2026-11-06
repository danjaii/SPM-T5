// Manual test scripts, part 1: the set-ups the cases refer to. A manual tester has no database access, so each starting state is
// reached through the screens. A case names the set-ups it needs ("S3"), and docs/testing/e2e/02-test-cases.md prints them once at
// the top. Keep this file free of imports and of non-erasable TypeScript: Node loads it directly (scripts/e2e/generate.mjs).
//
// The automated tests arrange the same states with the service-role key instead (fixtures/data.ts); the steps here are what a
// person does to get there.

export const BASE_URL = "http://localhost:3000";

export const PASSWORD = "ConnectSphere2026!";

/** The seeded accounts. All use the password above. "Role" is the entry to pick in the sign-in form's "Continue as" list. */
export const ACCOUNTS_TABLE = [
  ["Jason Chua", "jason.chua@techconnect.example.com", "Event Organiser"],
  ["Wei Ling Ong", "weiling.ong@techconnect.example.com", "Event Organiser"],
  ["Rachel Tan", "rachel.tan@connectsphere.example.com", "Event Coordinator"],
  ["Marcus Lim", "marcus.lim@connectsphere.example.com", "Event Coordinator"],
  ["Priya Nair", "priya.nair@connectsphere.example.com", "Event Coordinator"],
  ["Helen Ong", "helen.ong@connectsphere.example.com", "Event Coordinator Lead"],
  ["Samuel Tay", "samuel.tay@connectsphere.example.com", "Event Coordinator Lead"],
  ["Kenneth Wong", "kenneth.wong@connectsphere.example.com", "Venue Staff"],
  ["Farah Ibrahim", "farah.ibrahim@connectsphere.example.com", "Venue Staff"],
  ["Aaron Koh", "aaron.koh@connectsphere.example.com", "Technical Support Staff"],
  ["Farah Ismail", "farah.ismail@connectsphere.example.com", "Safety Officer"],
  ["Alicia Fernandez", "alicia.fernandez@example.com", "Attendee"],
  ["Bryan Ho", "bryan.ho@example.com", "Attendee"],
  ["Dylan Heng", "dylan.heng@example.com", "Attendee"],
];

/**
 * Set-ups. Dates in the cases are 14 November 2031 (a far-future day, so nothing depends on today). Use a different browser
 * profile or a private window per person so two people can be signed in at once.
 */
export const SETUPS = [
  {
    id: "S0",
    title: "Sign in as a person",
    steps: [
      "Open http://localhost:3000/login.",
      "Type the person's email in **Work email** and the password in **Password**.",
      "Open the **Continue as** list and pick their role exactly (\"Event Coordinator\" is not \"Event Coordinator Lead\").",
      "Press **Sign in**. The Lead lands on the unassigned queue (`/lead/queue`); every other role lands on `/dashboard/<role>` with the sidebar on the left.",
    ],
  },
  {
    id: "S1",
    title: "A submitted event request (as Jason Chua, Event Organiser)",
    steps: [
      "Sign in as Jason Chua (S0). Open **New event request** in the sidebar.",
      "Step Basics: fill **Event name** (use a name you can find again, such as `E2E manual 1`), **Purpose** and **Description**. Press **Continue to Date & attendance**.",
      "Step Date & attendance: set **Starts** to 14 Nov 2031 09:00, **Ends** to 14 Nov 2031 17:00, **Expected attendance** to 40. Press **Continue to Venue needs**.",
      "Step Venue needs: fill **Venue requirements** and pick a **Room layout** (for example Theatre). Press **Continue to Equipment**.",
      "Step Equipment: fill **Equipment requirements**. Press **Continue to Registration**.",
      "Step Registration: press **No registration** (or **Yes, registration needed** and fill **Registration capacity**, **Registration opens** and **Registration closes**). Press **Continue to Review & submit**.",
      "Check the review shows the event name, then press **Submit request**.",
      "Open **My event requests**: the request is listed as **Submitted**.",
    ],
  },
  {
    id: "S2",
    title: "…assigned to a coordinator (as Helen Ong, Lead)",
    steps: [
      "Sign in as Helen Ong (S0): the Home page is the unassigned queue.",
      "On the row of the request, open **Assign to…**, choose the coordinator (Rachel Tan unless the case says otherwise) and press **Confirm assigning <event name>**.",
      "The row leaves the queue.",
    ],
  },
  {
    id: "S3",
    title: "…reviewed and approved (as the assigned coordinator)",
    steps: [
      "Sign in as the assigned coordinator (S0). Open **Event requests** in the sidebar and open the event.",
      "Press **Start review**, then in the **Review this request** group press **Approve request** and confirm **Approve request** in the dialog.",
      "The event now reads **Approved**. (To move it on, use **Change status**: pick **Planning** in **New status** and press **Save**.)",
    ],
  },
  {
    id: "S4",
    title: "A venue (as Kenneth Wong, Venue Staff)",
    steps: [
      "Sign in as Kenneth Wong (S0). Open **Venue catalogue**, then **Add venue**.",
      "Fill **Name** (a name you can find again), **Location**, **Capacity** (for example 100), **Opening time** 07:00 and **Closing time** 23:00. Tick a layout such as **Theatre**.",
      "Press **Add venue**. The venue's page opens.",
    ],
  },
  {
    id: "S5",
    title: "…with setup and turnaround times (as Kenneth Wong)",
    steps: [
      "On the venue's page press **Edit times**.",
      "Fill **Setup time (minutes)** and **Turnaround time (minutes)** (the cases say which) and press **Save times**.",
      "The form says the times were saved.",
    ],
  },
  {
    id: "S6",
    title: "Another event holds the venue on 14 Nov 2031, 10:00 to 12:00",
    steps: [
      "Create the event as in S1 (any name), assign it to **Marcus Lim** (S2) and approve it as Marcus Lim (S3).",
      "As Marcus Lim, open `/events/<that event's id>/venue-request` (the event page's venue request; the id is in the page address). Choose the venue in **Venue**, **Date** 14 Nov 2031, **Start time** 10:00, **End time** 12:00. Press **Submit request**. The booking is **Pending**.",
      "To make it Approved (the cases say when): sign in as Kenneth Wong (S0), open **Booking requests**, open the request and press **Approve request**, then **Yes, approve**.",
    ],
  },
  {
    id: "S7",
    title: "An approved event assigned to Rachel Tan",
    steps: [
      "S1, then S2 (assign to Rachel Tan), then S3 (approve as Rachel Tan).",
    ],
  },
  {
    id: "S8",
    title: "An item of equipment (as Aaron Koh, Technical Support Staff)",
    steps: [
      "Sign in as Aaron Koh (S0). Open **Inventory**, then **Manage catalogue**.",
      "In the **Add equipment** form fill **Name** (a name you can find again), **Type**, **Quantity** (the case says how many) and **Location**. Press **Add equipment**.",
      "The item is listed as Available.",
    ],
  },
  {
    id: "S9",
    title: "A Confirmed event with registration open",
    steps: [
      "Follow the golden journey, E2E-JRN-01, steps 1 to 8: submit a request with registration needed (the registration window must be open now and close before the event), assign it, approve it, move it to Planning, book a venue and have Venue Staff approve it, get any equipment arranged, have the Safety Officer approve the safety check, then confirm the event.",
    ],
  },
  {
    id: "API",
    title: "Calling a service directly (for the cases that check what the screens hide)",
    steps: [
      "Sign in through the service: `curl -i -X POST http://localhost:4001/auth/login -H \"Content-Type: application/json\" -d '{\"email\":\"<email>\",\"password\":\"ConnectSphere2026!\",\"role\":\"<role value>\"}'`. The role value is the machine name: `event_organiser`, `event_coordinator`, `event_coordinator_lead`, `venue_staff`, `technical_support_staff`, `safety_officer` or `attendee`. Copy the `cs_session=…` cookie from the `Set-Cookie` header.",
      "Call a service with `curl -i -H \"Cookie: cs_session=<value>\" <url>` (add `-X POST -H \"Content-Type: application/json\" -d '<json>'` for a POST). The services are on 4001 (auth), 4002 (event), 4003 (venue), 4004 (equipment), 4005 (notification).",
      "A call without the `Cookie` header must answer 401; a call as the wrong role must answer 403.",
    ],
  },
];

// The single source for every E2E case (docs/testing/e2e/01-e2e-test-plan.md, section 3). Specs take their title, tags and
// annotations from here through `tc()` (fixtures/tc.ts), and scripts/e2e reads this file to write the generated docs, so a
// title can't drift from the catalogue.
//
// Keep this file free of imports and of non-erasable TypeScript (enums, parameter properties): Node loads it directly.
//
// `refs` are the story and acceptance-criterion references exactly as docs/specs writes them: `103-S1` (a scenario ID),
// `SCRUM-99/AC7` (an AC) or `SCRUM-65` (a whole story, used where the spec has no scenario table or no spec exists). A ref
// that ends in "?" means the AC still has to be confirmed against Jira.

export type Priority = "P0" | "P1" | "P2";
export type CaseType = "normal" | "boundary" | "conflict" | "failure" | "access-control";

export interface CaseDef {
  id: string;
  /** Short phrase that follows the ID in the test title. */
  title: string;
  /** One sentence for 02-test-cases. */
  scenario: string;
  refs: string[];
  priority: Priority;
  type: CaseType;
  /** Core feature numbers 1-20 (CLAUDE.md, Feature scope). */
  features: number[];
  /** Week 7 customer changes C1-C6. */
  changes: string[];
  preconditions?: string;
  steps?: string;
  data?: string;
  expected?: string;
}

const N = "normal", B = "boundary", C = "conflict", F = "failure", A = "access-control";

function c(
  id: string, title: string, scenario: string, refs: string[],
  priority: Priority, type: CaseType, features: number[], changes: string[] = [],
): CaseDef {
  return { id, title, scenario, refs, priority, type, features, changes };
}

export const CATALOGUE: CaseDef[] = [
  // JRN: golden journey
  c("E2E-JRN-01", "golden journey from draft to withdrawn registration and change request",
    "Organiser drafts, saves, resumes and submits; Lead assigns; Coordinator approves, searches, books; Venue Staff approve; Technical Support arranges equipment; Safety Officer approves; Coordinator confirms; Attendee registers and withdraws; Organiser raises a change request; each stage notifies the right user.",
    ["SCRUM-49", "SCRUM-53", "SCRUM-54", "SCRUM-77", "SCRUM-78", "SCRUM-24?", "SCRUM-65", "SCRUM-109", "SCRUM-32", "38-S1", "SCRUM-86", "SCRUM-87", "SCRUM-88", "SCRUM-171", "SCRUM-99/AC5", "SCRUM-83", "SCRUM-73", "66-S6", "SCRUM-47"],
    "P0", N, [2, 3, 4, 5, 6, 10, 11, 12, 13, 15, 18, 19, 20], ["C5", "C6"]),

  // AUTH and ACL
  c("E2E-AUTH-01", "signing in lands each role on its own home", "Signing in through the form lands each of the 7 roles on its own home.", ["SCRUM-122/AC1"], "P1", N, [1]),
  c("E2E-AUTH-02", "refuses a wrong password and a role that does not match", "Wrong password, and a role that does not match the account, are refused with a message and no session.", ["SCRUM-122/AC2"], "P1", F, [1]),
  c("E2E-AUTH-03", "sends a guarded page without a session to login and keeps next", "A guarded page without a session goes to /login; the register page keeps ?next= and returns there after sign-in.", ["SCRUM-177/AC2"], "P1", A, [1]),
  c("E2E-AUTH-04", "logout ends the session", "Logout ends the session and Back does not reopen a guarded page.", ["SCRUM-17/AC1", "SCRUM-17/AC2", "SCRUM-17/AC3", "SCRUM-17/AC4"], "P2", N, [1]),
  c("E2E-AUTH-05", "sidebar highlights home and collapses on a phone", "For each role the home page shows the shared sidebar with its home item highlighted once, and at 375 px the navigation collapses into a menu and the page does not scroll sideways.", ["SCRUM-121/AC1", "SCRUM-121/AC3"], "P2", N, [1]),
  c("E2E-AUTH-06", "sign-in works at 375 px", "At a 375 px wide screen the sign-in page does not scroll sideways and a person can still sign in and reach their home.", ["SCRUM-122/AC8"], "P2", B, [1]),
  c("E2E-ACL-01", "each role is refused another role's guarded URL", "For each role, opening a URL guarded for another role lands on the access-denied page.", ["SCRUM-122/AC3", "SCRUM-77-AC7", "SCRUM-78-AC9"], "P0", A, [1], ["C5"]),
  c("E2E-ACL-02", "wrong-role API calls are refused or see no rows", "Calling a service with the wrong role's cookie gets 403, or rows that row-level security hides.", ["SCRUM-77-AC7", "SCRUM-78-AC9", "98-S28", "19-S13", "39-S7", "SCRUM-99/AC7"], "P0", A, [1], ["C5"]),
  c("E2E-ACL-03", "a coordinator cannot reach another coordinator's event", "A coordinator cannot open or act on an event assigned to another coordinator.", ["156-S1", "156-S8", "102-S21"], "P1", A, [5], ["C5"]),
  c("E2E-ACL-05", "an unassigned coordinator is refused with 403 for another coordinator's event bookings", "A coordinator the event is not assigned to cannot request a venue for it or list its bookings: 403 and no booking (spec 98). Expected to fail while defect D-002 is open: the real stack answers 404 since SCRUM-156 hides the event.", ["98-S26", "98-S27"], "P1", A, [12], ["C3", "C5"]),
  c("E2E-ACL-04", "attendees' contact details reach only the people who need them", "The organiser and the assigned coordinator see every registrant's name, email and phone; another coordinator gets neither the rows nor the details; a person still sees their own details.", ["SCRUM-154/AC3", "SCRUM-154/AC4", "SCRUM-154/AC5"], "P2", A, [1]),

  // EVT, ASSIGN
  c("E2E-EVT-01", "organiser creates and submits an event request", "Organiser fills the 6-step form and submits; the request shows as Submitted in My event requests.", ["SCRUM-49/AC1", "SCRUM-52"], "P1", N, [2]),
  c("E2E-EVT-02", "organiser saves a draft, resumes it and submits", "Save as draft, leave, resume from the Drafts tab, edit, submit.", ["SCRUM-53", "SCRUM-54", "SCRUM-124?"], "P1", N, [3]),
  c("E2E-EVT-03", "coordinator reviews: clarification, reject with reason, approve", "Coordinator starts review, requests clarification, rejects one request with a reason and approves another; the organiser sees each status and reason.", ["SCRUM-24?", "SCRUM-44?", "SCRUM-45?"], "P1", N, [4, 6]),
  c("E2E-EVT-04", "critical edit shows affected arrangements and sends them back", "A minor edit saves; a critical edit (date) lists the affected arrangements and Save anyway sends them back to Pending.", ["SCRUM-111", "112-S8", "112-S14", "113-S1", "113-S9"], "P1", N, [7]),
  c("E2E-ASSIGN-01", "lead assigns from the unassigned queue", "The Lead's queue lists unassigned submitted requests oldest first; assigning removes the request from the queue and shows the coordinator on the event.", ["SCRUM-77-AC1", "SCRUM-77-AC2", "SCRUM-77-AC3", "SCRUM-77-AC4", "SCRUM-78-AC2", "SCRUM-78-AC3"], "P1", N, [5], ["C5"]),
  c("E2E-ASSIGN-02", "lead reassigns and access follows the new coordinator", "Lead reassigns; the old coordinator loses access, the new one gains it.", ["SCRUM-79", "156-S4"], "P1", N, [5], ["C5"]),
  c("E2E-ASSIGN-03", "second assignment of the same event is refused", "A second Lead assigns while the first has the page open; the first confirm is refused with 'already assigned' and the assignment is unchanged.", ["SCRUM-78-AC5"], "P1", C, [5], ["C5"]),
  c("E2E-ASSIGN-04", "either Lead sees every request and every coordinator and can assign across them", "Both Leads see an unassigned request; the overview lists the coordinators of both Leads; a Lead assigns the request to the other Lead's coordinator and sees it on that coordinator's page.", ["184-S1", "184-S2", "184-S3"], "P2", N, [5], ["C5"]),

  // VEN
  c("E2E-VEN-01", "venue search returns only matching venues", "Search by date, time, people, location, layout and facility returns only matching venues; Reset clears.", ["SCRUM-65"], "P1", N, [8, 10]),
  c("E2E-VEN-02", "suitability report and override reason", "The suitability report shows Suitable, Not suitable, Not met, Check manually; an unsuitable venue needs a reason to go ahead.", ["SCRUM-109", "SCRUM-110"], "P1", N, [11]),
  c("E2E-VEN-03", "venue staff add and edit a venue, a coordinator cannot", "Venue Staff add a venue and edit it; a coordinator cannot.", ["SCRUM-57", "SCRUM-58", "SCRUM-155"], "P2", N, [8]),
  c("E2E-VEN-04", "venue staff manage room layout types", "Venue Staff add, rename and delete a room layout type.", ["SCRUM-181"], "P2", N, [8]),
  c("E2E-VEN-05", "setup and turnaround show on the calendar", "Venue Staff save 30 and 45 minutes; the calendar shows Setup 09:30-10:00, Event 10:00-12:00, Turnaround 12:00-12:45.", ["SCRUM-101", "103-S5"], "P1", N, [8, 9], ["C1"]),
  c("E2E-VEN-06", "calendar shows pending as tentatively held and approved as confirmed", "The venue calendar shows a Pending request as Tentatively Held and an Approved booking as Confirmed to Event Coordinators, Venue Staff and Technical Support Staff, and refuses the Lead and the Safety Officer.", ["SCRUM-84/AC2", "SCRUM-84/AC8", "SCRUM-130/AC1"], "P2", N, [9]),

  // BOOK
  c("E2E-BOOK-01", "coordinator requests a venue and venue staff approve", "Coordinator requests a venue; it is Pending; Venue Staff see it in the queue and approve; the coordinator sees Approved.", ["SCRUM-32", "37-S1", "38-S1"], "P1", N, [12, 13]),
  c("E2E-BOOK-02", "rejected booking keeps its reason", "Venue Staff reject with a reason; the coordinator sees the reason; it is kept and the slot is free again.", ["39-S1", "39-S4"], "P1", F, [13]),
  c("E2E-BOOK-03", "rejection with a suggested alternative is accepted", "Venue Staff reject and suggest an alternative; the coordinator accepts it.", ["SCRUM-40"], "P1", N, [13]),
  c("E2E-BOOK-04", "cancelling one of three bookings leaves the others", "An event with three bookings: each is checked on its own; cancelling one with a reason leaves the other two and the event status unchanged.", ["98-S1", "98-S17", "102-S12", "102-S20", "98-S24"], "P1", N, [12], ["C3"]),
  c("E2E-BOOK-05", "changing a booking: back to pending, clash refused, own period allowed", "Changing an Approved booking sends it back to Pending; changing it into a clash is refused and changes nothing; moving within its own period is allowed.", ["102-S2", "102-S4", "102-S6"], "P1", B, [12], ["C3"]),

  // CONF
  c("E2E-CONF-01", "refuses an overlapping booking", "A request overlapping another event's pending or approved booking at a venue with no buffers is refused with '<venue> is occupied from 10:00 to 12:00' (no setup/turnaround suffix); no booking is created.", ["36-S1", "103-S6"], "P0", C, [14]),
  c("E2E-CONF-02", "refuses a booking inside the setup and turnaround buffers", "10:00-12:00 with 30/45 minutes occupies 09:30-12:45; 12:30-14:00 and 08:00-08:50 are refused with the occupied period.", ["103-S1", "103-S3"], "P0", C, [14], ["C1"]),
  c("E2E-CONF-03", "accepts padded periods that only touch", "A request at 13:15-15:00 is accepted: the padded periods only touch.", ["103-S2"], "P0", B, [14], ["C1"]),
  c("E2E-CONF-04", "same event cannot hold the same venue twice at overlapping times", "The same event asking for the same venue overlapping its own booking is refused as a duplicate; a different venue is fine.", ["98-S13", "98-S4", "103-S9"], "P1", C, [12, 14], ["C3"]),
  c("E2E-CONF-05", "refuses a request inside an unavailable period", "A request into a venue's unavailable period is refused with the exact period; one that only touches the padded block is accepted.", ["105-S4", "105-S5"], "P1", C, [14], ["C2"]),

  // CHG
  c("E2E-CHG-01", "raising buffers flags clashing bookings without removing them", "Raising buffers to 30/45 flags two bookings that now clash, each naming the other, and removes neither; Approve is hidden on a flagged Pending one; lowering to 15/15 clears both flags.", ["104-S1", "104-S2", "104-S4", "104-S5"], "P1", C, [14], ["C1"]),
  c("E2E-CHG-02", "marking a venue unavailable flags its bookings and notifies the coordinator", "Venue Staff mark a venue unavailable with a reason; the booking inside is flagged, still Approved, and its coordinator (only) gets one notification.", ["105-S1", "106-S1", "106-S2", "106-S5"], "P1", N, [9, 20], ["C2"]),
  c("E2E-CHG-03", "replacement venue flow", "The coordinator finds a replacement for the flagged booking; Venue Staff approve it and the original shows 'Replaced by'; a rejected replacement leaves the original flagged.", ["107-S1", "107-S2", "107-S3", "107-S4"], "P1", N, [12, 19], ["C2"]),
  c("E2E-CHG-04", "attendance increase lists the venue booking and sends it back", "Raising attendance past capacity lists the venue booking in the warning; going back changes nothing; Save anyway saves and sends the booking back to Pending.", ["112-S4", "112-S13", "112-S14", "113-S1"], "P1", N, [7, 19]),
  c("E2E-CHG-05", "organiser change request is approved or rejected by the coordinator", "Organiser submits a change request; the coordinator approves one and rejects another with a reason; the organiser sees both outcomes.", ["66-S1", "66-S6", "66-S7", "SCRUM-67"], "P1", N, [19]),
  c("E2E-CHG-06", "second change to the same field is held", "A second change to the same field while one is pending is refused and says so; a different field is accepted.", ["176-S1", "176-S4", "176-S8"], "P1", C, [19]),
  c("E2E-CHG-07", "venue block returns a confirmed event to planning and lifting releases flags", "A block over a Confirmed event's venue returns it to Planning and tells its coordinator; lifting the block clears the flag on the booking and tells the coordinator it is no longer affected. (The replacement-confirmed notice is E2E-NOTIF-03.)", ["SCRUM-185/AC1", "SCRUM-185/AC2"], "P2", N, [9, 19], ["C2"]),

  // EQP
  c("E2E-EQP-01", "overlapping reservations reduce availability", "10 units, 4 reserved for an overlapping period: availability shows 6 and a reservation for 6 succeeds; 4 in the morning and 4 in the afternoon leave 6 for the whole day.", ["18-S1", "19-S1", "19-S3", "19-S11"], "P0", C, [16, 17]),
  c("E2E-EQP-02", "reservation above availability is refused", "Asking for 8 when 6 are available is refused with the shortfall and saves nothing.", ["18-S3", "19-S4"], "P1", F, [16, 17]),
  c("E2E-EQP-03", "equipment request is reviewed: cannot fulfil keeps its reason", "The coordinator adds an equipment item against an approved venue booking (Submitted); Technical Support set it to Cannot Fulfil with a reason, which the coordinator sees on the Equipment tab. (The Arranged path is in E2E-JRN-01.)", ["SCRUM-86", "SCRUM-87", "SCRUM-88"], "P1", N, [15]),
  c("E2E-EQP-04", "equipment under maintenance drops out of availability", "Technical Support add, edit and mark equipment under maintenance; it drops out of availability.", ["SCRUM-182"], "P2", N, [15]),

  // SAFE
  c("E2E-SAFE-01", "safety queue lists ready events with their details", "An event with all arrangements complete shows in the Safety Officer's queue with the safety details; an incomplete one does not.", ["SCRUM-99/AC1", "SCRUM-99/AC2", "SCRUM-99/AC3"], "P1", N, [], ["C6"]),
  c("E2E-SAFE-02", "request changes returns the event to planning", "Request changes with comments: the event returns to Planning, the coordinator is told, and the decision is recorded with officer, time and comments.", ["SCRUM-99/AC4", "SCRUM-99/AC8", "SCRUM-100", "SCRUM-171"], "P0", F, [], ["C6"]),
  c("E2E-SAFE-03", "reject needs a reason", "Reject without a reason is refused; with a reason the event cannot proceed.", ["SCRUM-99/AC6"], "P1", F, [], ["C6"]),
  c("E2E-SAFE-04", "nobody can confirm before a safety approval", "Before an Approve, the coordinator's confirm is refused with the safety message.", ["SCRUM-99/AC7"], "P1", A, [6], ["C6"]),
  c("E2E-SAFE-05", "approve then confirm", "Approve, then the coordinator confirms; the event shows Confirmed and Safety Approved.", ["SCRUM-99/AC5", "SCRUM-99/AC8"], "P1", N, [6], ["C6"]),

  // REG
  c("E2E-REG-01", "attendee registers and organiser sees the registration", "Attendee browses Confirmed events, registers, and sees the registration in My registrations; the organiser and coordinator see the attendee in the event's registrations.", ["SCRUM-83", "SCRUM-72?"], "P1", N, [18]),
  c("E2E-REG-02", "attendee withdraws", "Attendee withdraws from My registrations after confirming; the registration shows Withdrawn and is not on the active list.", ["SCRUM-73"], "P1", N, [18]),
  c("E2E-REG-03", "registration at capacity", "Event with capacity 1: the first attendee registers, the second is told the event is full (or is put on pending, as SCRUM-169 decides).", ["SCRUM-169?"], "P1", B, [18]),
  c("E2E-REG-04", "registration is closed while the event is back in planning", "While an event is back in Planning, registration is closed and the coordinator can adjust capacity and window.", ["SCRUM-185/AC4"], "P2", B, [18], ["C2"]),

  // NOTIF
  c("E2E-NOTIF-01", "bell and list: unread, mark as read, open", "The bell shows the unread count; the page lists notifications with unread ones marked in words; Mark as read changes one (the bell follows after a reload); opening one goes to what it is about and marks it read. (Acknowledge is not covered: it needs an action-needed notification.)", ["SCRUM-46"], "P1", N, [20]),
  c("E2E-NOTIF-02", "one action notifies exactly the right user", "One action sends one notification to the right user and none to others: assignment, approval, booking decision, venue flag.", ["SCRUM-47", "SCRUM-172", "106-S5"], "P1", A, [20]),
  c("E2E-NOTIF-03", "replacement-confirmed notice reaches the right people", "The replacement-confirmed notice reaches the organiser and the affected attendees, not a withdrawn one.", ["SCRUM-185/AC3", "SCRUM-172"], "P2", A, [20], ["C2"]),
];

const byId = new Map(CATALOGUE.map((x) => [x.id, x]));

export function getCase(id: string): CaseDef {
  const found = byId.get(id);
  if (!found) throw new Error(`${id} is not in tests/e2e/catalogue.ts`);
  return found;
}

/** The story key a reference belongs to: `103-S1` -> SCRUM-103, `SCRUM-99/AC7` -> SCRUM-99, `SCRUM-77-AC1` -> SCRUM-77. */
export function storyOf(ref: string): string {
  const clean = ref.replace(/\?$/, "");
  const scenario = /^(\d+)-S\d+/.exec(clean);
  if (scenario) return `SCRUM-${scenario[1]}`;
  const story = /^(SCRUM-\d+)/.exec(clean);
  if (story) return story[1];
  throw new Error(`cannot read a story from ref "${ref}"`);
}

export function areaOf(id: string): string {
  return id.split("-")[1];
}

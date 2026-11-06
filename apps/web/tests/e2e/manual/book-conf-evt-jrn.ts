// Manual test scripts, part 3: BOOK, CONF, EVT and JRN. See setups.ts for S0 to S9 and API. Free of imports.

const REQUEST_VENUE =
  "As the coordinator open `/events/<event id>/venue-request`. Choose the **Venue** (its option reads \"<name> (capacity <n>)\"), type the **Date**, **Start time** and **End time**, press **Submit request**.";

export const MANUAL = {
  "E2E-JRN-01": {
    setups: ["S0"],
    preconditions: "Two venues exist that are open 07:00 to 23:00 with the Theatre layout: one holding 100 people and one holding only 10 (S4 twice). One item of equipment with 5 units (S8). The seeded accounts. One private window per person.",
    data: "Event `E2E journey`, 14 Nov 2031 09:00 to 17:00, 40 people, Theatre layout, registration for 30 people open now and closing before the event.",
    steps: [
      "1. Organiser (Jason Chua): fill the New event request form up to the Equipment step and press **Save as draft** (\"Draft saved.\"). Leave; open **My event requests**, open the draft: it opens on the Equipment step with its text back; press **Back** three times and check the **Event name** is back. Continue to Registration, choose **Yes, registration needed** (capacity 30, opens yesterday, closes before the event), **Continue to Review & submit**, **Submit request**.",
      "2. Lead (Helen Ong): the request is in the unassigned queue. Assign it to Rachel Tan.",
      "3. Coordinator (Rachel Tan): **Event requests**, open it, **Start review**, **Approve request** and confirm. Then **Change status** to **Planning**.",
      "4. Rachel: on the event press **Find a venue**: the 100-person venue is offered and the 10-person venue is not. Open the venue request form, pick the 100-person venue, 14 Nov 2031 09:00 to 17:00, press **Check suitability** (the report says Suitable), then **Submit request**.",
      "5. Venue Staff (Kenneth Wong): **Booking requests**, open the request, **Approve request**, **Yes, approve**.",
      "6. Rachel: on the event's **Equipment** tab press **Add item**, pick your item, quantity 2, **Save**; the row shows Submitted. Technical Support (Aaron Koh): open the request, set **New status** to **Arranged**, **Save status**.",
      "7. Safety Officer (Farah Ismail): **Safety checks**, open the event, choose **Approve**, add a comment, **Submit decision**.",
      "8. Rachel: on the event **Change status** to **Confirmed**, **Save**.",
      "9. Attendee (Alicia Fernandez): **Browse events**, search the event name, **Register**, fill Name, Email, Contact number, **Register**. Open **My registrations**, **Withdraw**, confirm **Yes, withdraw**.",
      "10. Organiser: open the event's **Change requests** tab, set **Expected attendance** to 60, **Submit change request**.",
      "11. For Rachel, Jason Chua and Helen Ong open **Notifications**. As Marcus Lim, Priya Nair, Wei Ling Ong and Bryan Ho open it too.",
    ],
    expected: [
      "1. The draft is kept and resumes with the saved values; after submitting the request is Submitted and both Leads are told.",
      "2. The request leaves the queue; only Rachel Tan is told she is responsible.",
      "3. The event is Approved, then Planning; Jason Chua is told of the approval.",
      "4. The 10-person venue is not offered; the booking is created Pending.",
      "5. The booking is Approved; with no equipment asked for yet the event moves to Awaiting Arrangements by itself; Rachel is told.",
      "6. The equipment row is Submitted while the event stays Awaiting Arrangements, then the item is reserved after Arranged.",
      "7. The page says \"Safety Approved\"; Rachel and Jason are told.",
      "8. The event is Confirmed; Jason is told, Rachel (who did it) is not.",
      "9. The confirmed event is offered to the attendee; the registration shows, then shows Withdrawn and is kept as history.",
      "10. The change request is Pending and the event still says 40 people.",
      "11. Rachel, Jason and Helen see their own messages for this event; Marcus, Priya, Wei Ling and Bryan have none.",
    ],
  },
  "E2E-BOOK-01": {
    setups: ["S0", "S4", "S7"],
    preconditions: "A venue (S4) and an approved event assigned to Rachel Tan (S7).",
    data: "14 Nov 2031, 10:00 to 12:00.",
    steps: [
      REQUEST_VENUE,
      "Sign in as Kenneth Wong. Open **Booking requests** and check the request is listed. Open it, press **Approve request**, then **Yes, approve**. Look at **Booking requests** again.",
      "As Rachel Tan open the booking page.",
    ],
    expected: [
      "The booking page says Pending after the request.",
      "The request is in Venue Staff's queue; after Approve it has left the queue.",
      "Rachel's booking page says Approved.",
    ],
  },
  "E2E-BOOK-02": {
    setups: ["S0", "S4", "S7"],
    preconditions: "A venue; two approved events assigned to Rachel Tan (S7 twice); a Pending request for the first event at 10:00 to 12:00 on 14 Nov 2031.",
    data: "Reason: `Reserved for a maintenance inspection that day.`",
    steps: [
      "As Kenneth Wong open the request, press **Reject request**, type the reason in **Reason for rejection**, press **Reject request** in the dialog.",
      "As Rachel Tan open the booking page.",
      "As Rachel Tan request the same venue and period for the second event (REQUEST VENUE step of E2E-BOOK-01).",
    ],
    expected: [
      "The dialog closes; the request leaves the queue.",
      "Rachel's page says Rejected and shows the reason in full.",
      "The second request is accepted (Pending): the rejected request no longer holds the slot.",
    ],
  },
  "E2E-BOOK-03": {
    setups: ["S0", "S4", "S7"],
    preconditions: "Two venues (S4 twice: First choice and Suggested); an approved event assigned to Rachel Tan; a Pending request for the first venue, 14 Nov 2031 10:00 to 12:00.",
    data: "Suggestion: the second venue, 15 Nov 2031, 09:00 to 17:00. Reason: `The hall is taken that morning.`",
    steps: [
      "As Kenneth Wong open the request, **Reject request**, fill the reason, tick **Suggest an alternative**, pick **Suggested venue**, fill **Suggested date**, **Suggested start time**, **Suggested end time**, press **Reject request**.",
      "As Rachel Tan open the booking page.",
      "Press **Accept suggested alternative**.",
    ],
    expected: [
      "The dialog closes and the original request is Rejected.",
      "Rachel sees a **Suggested alternative** heading naming the venue and date.",
      "A new Pending request exists for the suggested venue and time (on the event's venue list, with the original still Rejected).",
    ],
  },
  "E2E-BOOK-04": {
    setups: ["S0", "S4", "S7"],
    preconditions: "An approved event assigned to Rachel Tan with three bookings at three venues (Hall, Room, Lobby; S4 three times): Hall 09:00 to 12:00 and Room 10:00 to 11:00 both Approved (request, then Venue Staff approve), Lobby 13:00 to 15:00 left Pending. All on 14 Nov 2031.",
    data: "Reason: `The partner session moved online.`",
    steps: [
      "As Rachel Tan open the event's **Venues** tab (`/events/<event id>?tab=venues`).",
      "Press **Cancel the Room venue booking**, fill **Reason for cancelling**, press **Cancel venue booking**.",
      "Look at the tab again and at the event's status.",
    ],
    expected: [
      "All three venues are listed.",
      "The Room booking shows as cancelled, with the reason.",
      "Hall stays Approved, Lobby stays Pending, and the event is still Approved (cancelling a venue does not cancel the event).",
    ],
  },
  "E2E-BOOK-05": {
    setups: ["S0", "S4", "S5", "S6", "S7"],
    preconditions: "A venue with no setup/turnaround held by another event 10:00 to 12:00 (S6, approved), and an Approved booking for Rachel Tan's event at the same venue 08:00 to 09:00 on 14 Nov 2031.",
    data: "Change 1: 09:30 to 10:30 (clashes). Change 2: 08:00 to 09:30 (stretch within its own period).",
    steps: [
      "As Rachel Tan open the booking's change page (`/venue-bookings/<booking id>/change`), set **Start time** 09:30 and **End time** 10:30, press **Save change**.",
      "Open the change page again, set 08:00 and 09:30, press **Save change**.",
    ],
    expected: [
      "The first change is refused with a message that the venue is occupied from 10:00 to 12:00; the booking keeps 08:00 to 09:00 and stays Approved.",
      "The second is saved (it does not clash with itself) and the booking goes back to Pending for Venue Staff to decide again.",
    ],
  },
  "E2E-CONF-01": {
    setups: ["S0", "S4", "S6", "S7"],
    preconditions: "A venue with no setup/turnaround held by another event 10:00 to 12:00 on 14 Nov 2031 (S6), once Pending and once Approved (run twice with a new venue), and an approved event assigned to Rachel Tan.",
    data: "Requests: 11:00 to 13:00 and 09:00 to 10:30, on 14 Nov 2031.",
    steps: [
      "Request the first time range for Rachel's event (the REQUEST VENUE step of E2E-BOOK-01: open `/events/<event id>/venue-request`, pick the venue, date, start and end, **Submit request**).",
      "Read the message. Check the booking list of Rachel's event.",
      "Repeat for the second time range, then with the holder in the other state.",
    ],
    expected: [
      "Each request is refused, you stay on the form, and Rachel's event has no booking. With an Approved holder the message is `<venue> is occupied from 10:00 to 12:00`; with a Pending holder (a tentative hold) it is `<venue> is tentatively held from 10:00 to 12:00`. Neither mentions setup or turnaround (this venue has none).",
    ],
  },
  "E2E-CONF-02": {
    setups: ["S0", "S4", "S5", "S6", "S7"],
    preconditions: "A venue with Setup 30 minutes and Turnaround 45 minutes (S5) held 10:00 to 12:00 on 14 Nov 2031 by another event (S6), which therefore occupies 09:30 to 12:45. An approved event assigned to Rachel Tan.",
    data: "Requests: 12:30 to 14:00 and 08:00 to 08:50.",
    steps: ["Request each period for Rachel's event (REQUEST VENUE step of E2E-BOOK-01) and read the message."],
    expected: ["Both are refused with `<venue> is occupied from 09:30 to 12:45, including setup and turnaround`; no booking is created."],
  },
  "E2E-CONF-03": {
    setups: ["S0", "S4", "S5", "S6", "S7"],
    preconditions: "As E2E-CONF-02: the holder occupies 09:30 to 12:45.",
    data: "Request 13:15 to 15:00 on 14 Nov 2031.",
    steps: ["Request that period for Rachel's event."],
    expected: ["It is accepted: the booking page says Pending. The padded periods only touch at 12:45, which is not an overlap."],
  },
  "E2E-CONF-04": {
    setups: ["S0", "S4", "S7"],
    preconditions: "Two venues (Hall, Annex); an approved event assigned to Rachel Tan with a Pending request for the Hall 10:00 to 12:00 on 14 Nov 2031.",
    data: "Request: the Hall again 11:00 to 13:00; then the Annex 11:00 to 13:00.",
    steps: ["Request the Hall 11:00 to 13:00 for the same event.", "Request the Annex 11:00 to 13:00 for the same event."],
    expected: [
      "The Hall request is refused with \"This event already holds this venue for part of that period.\"; the event still has one booking.",
      "The Annex request is accepted; the event now has two bookings.",
    ],
  },
  "E2E-CONF-05": {
    setups: ["S0", "S4", "S7"],
    preconditions: "A venue with Setup 30 minutes (S5) that Venue Staff marked unavailable from 14 Nov 2031 08:00 to 16 Nov 2031 18:00, reason Maintenance (venue page, **Mark unavailable**: **Start date**, **Start time**, **End date**, **End time**, **Reason**, **Save unavailable period**). An approved event assigned to Rachel Tan.",
    data: "Requests: 15 Nov 09:00 to 17:00; 16 Nov 18:15 to 20:00; 16 Nov 18:30 to 20:00.",
    steps: ["Request each period in turn for Rachel's event and read the message."],
    expected: [
      "15 Nov and 16 Nov 18:15 are refused with `<venue> is unavailable from 14 Nov 08:00 to 16 Nov 18:00`; the message gives the period, not the reason (no word \"maintenance\"). 18:15 is refused because the 30-minute setup would run into the block.",
      "16 Nov 18:30 is accepted (the padded period only touches the block's end): one booking exists.",
    ],
  },
  "E2E-EVT-01": {
    setups: ["S0", "S1"],
    preconditions: "Signed in as Jason Chua.",
    data: "Event `E2E request`, purpose `Customer appreciation evening`, 14 Nov 2031 18:00 to 21:00, 60 people, Banquet layout, no registration.",
    steps: ["Do S1 with these values. After **Submit request** open **My event requests**."],
    expected: ["The review step shows the event name before submitting. The request is saved as submitted, not a draft, with 60 people and the purpose typed; **My event requests** lists it as **Submitted**."],
  },
  "E2E-EVT-02": {
    setups: ["S0", "S1", "S2"],
    preconditions: "Jason Chua and Helen Ong signed in.",
    data: "Event `E2E draft`, purpose `Team offsite`, 14 Nov 2031 09:00 to 17:00, 25 people (later changed to 35), Classroom layout.",
    steps: [
      "As Jason: New event request, fill Basics, **Continue to Date & attendance**, fill Starts, Ends and 25 people, press **Save as draft** (\"Draft saved.\").",
      "Open **My event requests**: find the draft. As Helen Ong check the unassigned queue.",
      "As Jason open the draft from the list: it opens on the Date & attendance step. Check **Expected attendance** is 25, press **Back** and check **Event name**, then **Continue to Date & attendance** again; change the attendance to 35; **Save as draft**.",
      "Continue through Venue needs (Classroom), Equipment, Registration (**No registration**), **Review & submit**, press **Submit request**.",
      "As Helen Ong look at the unassigned queue.",
    ],
    expected: [
      "The draft is saved. **My event requests** shows it as a Draft; Helen does not see it in her queue.",
      "Resuming opens the form on the step where it was saved (Date & attendance, with 25), and **Back** shows the Event name restored; saving again updates the same draft (the list still has one entry).",
      "After submitting, the request is in Helen's queue.",
    ],
  },
  "E2E-EVT-03": {
    setups: ["S0", "S1", "S2"],
    preconditions: "Three requests assigned to Rachel Tan: one Submitted (A), two put under review (B, C: **Start review**).",
    data: "Question: `Can you confirm whether the catering needs a halal kitchen?` Rejection reason: `The date clashes with the venue's annual closure.`",
    steps: [
      "As Rachel open A and press **Start review**.",
      "Press **Request clarification**, type the question under **Your question for the organiser**, press **Send question**.",
      "As Jason Chua open A.",
      "As Rachel open B, press **Reject**, type the reason in **Reason for rejection**, press **Reject request**. As Jason open B.",
      "As Rachel open C, press **Approve request** and confirm.",
    ],
    expected: [
      "A moves to Under Review. Jason is told (Notifications) and reads the question on the event page.",
      "B becomes Rejected, Jason is told, and sees the reason.",
      "C becomes Approved and Jason is told.",
    ],
  },
  "E2E-EVT-04": {
    setups: ["S0", "S9"],
    preconditions: "A Confirmed event on 14 Nov 2031 09:00 to 17:00 with one Approved venue booking, assigned to Rachel Tan (S9, or an approved booking and **Change status** to **Confirmed** after the safety approval).",
    data: "Purpose `A refreshed purpose statement.`; new date 15 Nov 2031.",
    steps: [
      "As Rachel open the event's **Edit event details** page. Change **Purpose**, press **Save changes**.",
      "Open it again. Change **Date** and **End date** to 15 Nov 2031. Press **Save changes**.",
      "Read the **Check affected arrangements** dialog. Press **Go back**. Check the booking, then repeat the date change and press **Save anyway**.",
    ],
    expected: [
      "The purpose change saves at once (`?saved=1`); the event stays Confirmed and the booking Approved.",
      "The date change shows a dialog listing the venue booking (one affected item) and saves nothing yet.",
      "After **Save anyway** the booking is Pending again and the Confirmed event is back in Planning.",
    ],
  },
};

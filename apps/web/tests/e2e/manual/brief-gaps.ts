// Manual test scripts, part 5: cases added after the project brief and the customer's Week 4, 7 and 9 answers were checked against the
// suite (EVT-05, CHG-08, SAFE-06, REG-05, VEN-07, VEN-08, ASSIGN-05). See setups.ts for S0 to S9 and API. Free of imports.

export const MANUAL = {
  "E2E-EVT-05": {
    setups: ["S0", "S9"],
    preconditions: "An event in Planning on 14 Nov 2031, assigned to Rachel Tan, organised by Jason Chua, with an Approved venue booking and a reserved item of equipment (S9, then book equipment as in E2E-EQP-01). Three attendees are registered for it: Alicia Fernandez (registered), Chen Wei Jie (registered but waiting, if the event is full) and Bryan Ho, who registered and then withdrew. Jason has a change request waiting (E2E-CHG-05 step 1).",
    data: "Reason `Organiser withdrew the event`.",
    steps: [
      "As Rachel Tan open the event page. In **Change status** pick **Cancelled** in **New status**. Look at the reason box. Press **Save** with the reason empty.",
      "Type the reason in **Reason (required)** and press **Save**.",
      "Open the event's venue and equipment tabs, and Jason's change request.",
      "Open **Notifications** as Jason Chua, Alicia Fernandez, Chen Wei Jie, Bryan Ho and Rachel Tan.",
      "As Rachel open the event page again.",
    ],
    expected: [
      "Choosing Cancelled shows the box **Reason (required)**; Save with no reason shows \"A reason is required to cancel an event.\" and the event is still Planning.",
      "The event becomes Cancelled and its history keeps the reason.",
      "The venue booking is cancelled with the reason \"The event was cancelled.\"; the equipment is cancelled and its units are free for another event; Jason's change request is rejected with \"Closed automatically: the event was cancelled.\"",
      "Jason, Alicia and Chen Wei Jie each have one cancellation notice with the reason. Bryan Ho (withdrew) and Rachel (who cancelled) have none.",
      "The page says \"This event was cancelled, so its status can no longer change.\" and offers no status change.",
    ],
  },
  "E2E-CHG-08": {
    setups: ["S0", "S9"],
    preconditions: "An event in Planning on 14 Nov 2031 09:00 to 17:00, assigned to Rachel Tan, with an Approved venue booking and an Arranged equipment request (the item's request set to **Arranged** by Aaron Koh, as in E2E-JRN-01 step 6).",
    data: "New date 15 Nov 2031.",
    steps: [
      "As Rachel Tan open **Edit event details**. Change **Date** and **End date** to 15 Nov 2031. Press **Save changes**.",
      "Read the **Check affected arrangements** dialog. Press **Go back**. Look at the booking and the equipment request.",
      "Press **Save changes** again, then **Save anyway**.",
      "Look at the booking and the equipment request again.",
    ],
    expected: [
      "The dialog lists two affected arrangements: the venue booking (with its venue name) and the equipment request (with the item's name). Nothing is saved yet: the booking is Approved and the equipment Arranged.",
      "After **Go back** nothing changed.",
      "After **Save anyway** the booking is Pending again for Venue Staff and the equipment request is Submitted again for Technical Support. The event stays in Planning.",
    ],
  },
  "E2E-SAFE-06": {
    setups: ["S0", "S9"],
    preconditions: "A Confirmed event on 14 Nov 2031 with an Approved venue booking and a Safety Approval (S9), assigned to Rachel Tan.",
    data: "New date 15 Nov 2031. Safety comment `Re-checked after the date change.`",
    steps: [
      "As Rachel Tan open **Edit event details**, change **Date** and **End date** to 15 Nov 2031, press **Save changes**, then **Save anyway**.",
      "As Kenneth Wong open **Booking requests**, open the booking's request, press **Approve request**, **Yes, approve**.",
      "As Rachel Tan open the event and use **Change status**: pick **Confirmed**, press **Save**.",
      "As Farah Ismail open **Safety checks**, open the event's review, choose **Approve**, add a comment, press **Submit decision**.",
      "As Rachel Tan use **Change status** to **Confirmed** again.",
    ],
    expected: [
      "After the date change the event is back in Planning and its earlier Safety Approval no longer counts.",
      "After Venue Staff approve the booking the event moves to Awaiting Arrangements by itself and is in the Safety Officer's queue again.",
      "Confirming is refused: \"This event can't move to preparation until it is Safety Approved.\"",
      "The Safety Officer's new approval is recorded (\"Safety Approved\").",
      "Now Rachel can confirm: the event reads Confirmed.",
    ],
  },
  "E2E-REG-05": {
    setups: ["S0", "S9"],
    preconditions: "A Confirmed event with registration open for 1 place, organised by Jason Chua, with an Approved booking at a venue that holds 5 (S9 with capacity 1 and a small venue). Alicia Fernandez and Bryan Ho have not registered. Chen Wei Jie has an attendee account.",
    data: "VIP: `chen.wei.jie@example.com`.",
    steps: [
      "As Alicia Fernandez register for the event (E2E-REG-01 steps).",
      "As Bryan Ho register for the same event. Read the message.",
      "As Jason Chua open **Event registrations**, choose the event. In **Attendee's email** type the VIP's email and press **Add VIP**.",
      "Look at Bryan's row and press **Confirm** on it.",
      "Press **Decline** on Bryan's row.",
    ],
    expected: [
      "Alicia is Confirmed. Bryan is told the event is full and is waiting for the organiser (Pending).",
      "\"chen.wei.jie@example.com is now Confirmed as a VIP.\" appears; the list shows a row with a VIP badge; the summary now shows two Confirmed on an event whose registration limit is 1.",
      "Bryan's row shows Pending with **Confirm** and **Decline** buttons. Confirm is refused with \"This event is full. A place must be freed before you can confirm this registration.\" and he stays Pending.",
      "Bryan's row reads Rejected and no longer has Confirm or Decline.",
    ],
  },
  "E2E-VEN-07": {
    setups: ["S0", "S4"],
    preconditions: "Five venues open 07:00 to 23:00 (S4, with these settings): Alpha (100 people, Theatre, accessible, Projector & Screen), Gamma (100, Theatre, not accessible, no projector), Epsilon (100, Theatre, accessible, no projector), Beta (100, Classroom only, accessible, projector), Delta (20 people, Theatre, accessible, projector). Signed in as Rachel Tan.",
    data: "14 Nov 2031, 13:00 to 15:00, 50 people. Searches: Theatre; Theatre + Accessible venue; Theatre + Projector & Screen; all three; Theatre with 120 people.",
    steps: [
      "Open **Venue catalogue**, press **Filters**. Fill **Start date**, **End date**, **Start time**, **End time** and **People** 50. Press the **Theatre** button, then **Apply filters**.",
      "Press **Reset**, refill the times and people, press **Theatre** and tick **Accessible venue**, apply.",
      "Reset; Theatre and tick **Projector & Screen**; apply.",
      "Reset; Theatre, Accessible venue and Projector & Screen; apply.",
      "Reset; set **People** 120 and Theatre; apply.",
    ],
    expected: [
      "Theatre alone: Alpha, Gamma and Epsilon. Beta (no Theatre) and Delta (holds only 20) are not offered.",
      "With Accessible venue: Alpha and Epsilon.",
      "With the projector: Alpha only.",
      "All three together: Alpha only.",
      "120 people: none of these five venues (each holds at most 100).",
    ],
  },
  "E2E-VEN-08": {
    setups: ["S0", "S4", "S7"],
    preconditions: "An approved event with 80 expected attendance whose room layout is Theatre (choose Theatre as the **Room layout** when creating it, S1), assigned to Rachel Tan. Two venues holding 100: one with only the Classroom layout, one with Theatre (S4).",
    data: "14 Nov 2031, 10:00 to 12:00.",
    steps: [
      "As Rachel open the event's venue request form, choose the Classroom-only venue and the date and times, press **Check suitability**.",
      "Read each line of the report, including Facilities.",
      "Choose the Theatre venue and press **Check suitability** again.",
    ],
    expected: [
      "Not suitable, with the layout line **Not met** and the capacity line **Met**.",
      "The Facilities line says **Not checked**: the event has no required-facilities field, so facilities are not judged (spec 109; the venue's own facilities are on its page).",
      "Suitable, with the layout line **Met**.",
    ],
  },
  "E2E-ASSIGN-05": {
    setups: ["S0", "S1", "S2", "S3"],
    preconditions: "Events: one assigned to Rachel Tan in Planning on 14 Nov 2031 (\"later\"), one assigned to Rachel Tan Approved on 13 Nov (\"earlier\"), one assigned to Priya Nair Approved on 16 Nov, one unassigned submitted request, and one Completed event assigned to Rachel Tan. Give each a recognisable name.",
    data: "Helen Ong (Lead) and Rachel Tan.",
    steps: [
      "As Helen Ong open the unassigned queue and press **View all active events**. Look at the sidebar.",
      "Read the list.",
      "Open the **Coordinator** filter and choose Priya Nair.",
      "Press **Clear filters**. Choose Coordinator Rachel Tan and Status Planning.",
      "Press **Clear filters**. Type `earlier` in **Search**. Then press **Clear filters**.",
      "Type a name that matches nothing.",
      "As Rachel Tan open `/lead/events`.",
    ],
    expected: [
      "The Active events page opens and the sidebar item **Active events** is highlighted.",
      "The three assigned active events are listed with status, coordinator, date and attendance, earliest first (13 Nov, 14 Nov, 16 Nov). The unassigned request and the Completed event are not.",
      "Only Priya Nair's event remains; the text reads \"Showing n of m active events\".",
      "Only Rachel's Planning event remains (the Approved one is hidden).",
      "Only the \"earlier\" event shows; clearing shows all again.",
      "\"No events match these filters.\" with a **Clear filters** button that brings the list back.",
      "Rachel Tan is sent to the access-denied page.",
    ],
  },
  "E2E-REG-06": {
    setups: ["S0", "S9"],
    preconditions: "As E2E-REG-05: a Confirmed event with registration for 1 place and an Approved booking at a venue that holds 5 (S9). Alicia Fernandez is Confirmed and Bryan Ho is waiting (Pending). KNOWN DEFECT D-006: in the production build step 3 fails, so this case is expected to FAIL there.",
    data: "VIP: `chen.wei.jie@example.com`.",
    steps: [
      "As Jason Chua open **Event registrations** and choose the event. Bryan's row is Pending with **Confirm** and **Decline**.",
      "In **Attendee's email** type the VIP's email and press **Add VIP**. Read the message.",
      "Look at the list and the summary, without reloading. Then reload the page.",
    ],
    expected: [
      "Bryan is waiting (Pending).",
      "\"chen.wei.jie@example.com is now Confirmed as a VIP.\" appears.",
      "The list shows a new row for the VIP with a VIP badge, and the summary counts two Confirmed, without a reload. Today (production build) the old rows stay until you reload, and only then does the VIP appear: record this against D-006 in `defects.md`.",
    ],
  },
};

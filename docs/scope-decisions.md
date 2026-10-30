# Scope decisions

Requirements we considered and chose not to build, or to build only in part, for Release 1. Each row says what the
customer said and where the decision is recorded, so the reasoning can be found from the requirement's own name.

Customer sources are cited as the file and the person who asked the question:

- **Briefing**: `Project Brief.pdf` (IS212 Customer Briefing), by page and section.
- **Week 2**: `G1G2 Week2 Clarification.xlsx`, by page of the PDF export and asker.
- **Week 9**: `G1G2 clarification Answers wk9.xlsx`, by page of the PDF export and asker.

| Requirement considered | Decision | Why (the customer's words) | Recorded in |
| --- | --- | --- | --- |
| Guarded status transitions: limiting which status an event can move to from its current one | Not built for Release 1. The one rule the customer insists on is already enforced: an event cannot be Confirmed until it is Safety Approved (`events_safety_gate`, migration 37), and it only reaches the safety check once every venue booking and equipment request is approved (`is_ready_for_safety_check()`, same migration). | Week 2, Rey (G2), p. 1: transition rules "are open to design assumptions; status progression is generally flexible for now. More details will be shared if this feature is considered for initial release." Week 2, Claris (G2), p. 3: "Change of status requires the proper discussion of workflow later when it is needed for implementation." The briefing (p. 5, Event Status Management) asks only that events "progress through suitable statuses so that users can understand their current stage". The rule that is required: Week 9, Jacob (G1), p. 2: "All required venue and technical arrangements must be approved, and safety check completed, before the Coordinator marks the event as Confirmed." | SCRUM-174 (Out of scope), [cancel-event.md](specs/cancel-event.md) |
| Organisers cancelling an event themselves | Not built. Organisers ask their coordinator, who cancels it (SCRUM-174). | Week 2, Bryan (G1), p. 1: "Organisers can request changes/cancellation at any point in time." Week 9, Dhejassri (G2), p. 1: "modifications or withdrawals must be requested through the Coordinator." | SCRUM-174 (Out of scope), [cancel-event.md](specs/cancel-event.md) |

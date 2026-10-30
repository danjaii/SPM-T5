# Scope decisions

Requirements we considered and chose not to build, or to build only in part, for Release 1. Each row says what the
customer said and where the decision is recorded, so the reasoning can be found from the requirement's own name.

The customer's answers come from the weekly Q&A spreadsheets (Week 2: `G1G2 Week2 Clarification.xlsx`, Week 9:
`G1G2 clarification Answers wk9.xlsx`) and the customer briefing (`Project Brief.pdf`).

| Requirement considered | Decision | Why | Recorded in |
| --- | --- | --- | --- |
| Guarded status transitions: limiting which status an event can move to from its current one | Not built for Release 1. The one rule the customer insists on is already enforced: an event cannot be Confirmed until it is Safety Approved (`events_safety_gate`, migration 37), and it only reaches the safety check once every venue booking and equipment request is approved (`is_ready_for_safety_check()`, same migration). | The customer said in the Week 2 Q&A that transition rules "are open to design assumptions; status progression is generally flexible for now", and that changes of status need "the proper discussion of workflow later when it is needed for implementation". The customer briefing asks only that events "progress through suitable statuses so that users can understand their current stage". The one rule the customer did set, in the Week 9 Q&A: "All required venue and technical arrangements must be approved, and safety check completed, before the Coordinator marks the event as Confirmed." | SCRUM-174 (Out of scope), [cancel-event.md](specs/cancel-event.md) |
| Organisers cancelling an event themselves | Not built. Organisers ask their coordinator, who cancels it (SCRUM-174). | The customer said in the Week 2 Q&A that "Organisers can request changes/cancellation at any point in time", and in the Week 9 Q&A that "modifications or withdrawals must be requested through the Coordinator." | SCRUM-174 (Out of scope), [cancel-event.md](specs/cancel-event.md) |

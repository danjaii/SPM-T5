-- SCRUM-105 (docs/specs/venue-unavailability.md): Venue Staff can give "Equipment failure" as the reason a venue is unavailable.
-- Kept in its own file because a new enum value cannot be used in the transaction that adds it (the function in 38 only
-- compares the reason as text, but the rule is the same as for 05_venue_booking_withdrawn.sql).

alter type venue_unavailability_reason add value if not exists 'equipment_failure';

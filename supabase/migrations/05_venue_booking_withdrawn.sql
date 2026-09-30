-- SCRUM-35 (docs/specs/venue-booking-request.md, DR4): a Coordinator can withdraw a Pending request.
-- The API status WITHDRAWN maps to this enum value. Kept in its own file because a new enum value
-- cannot be used in the same transaction that adds it (migration 06 uses it).

alter type venue_booking_status add value if not exists 'withdrawn';

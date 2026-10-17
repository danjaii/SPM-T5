-- A venue booking can be replaced by another venue's (SCRUM-107, docs/specs/replacement-venue.md).
-- Alone in its file: a new enum value cannot be used in the transaction that adds it, so 46 (which names it) is a separate file.
alter type venue_booking_status add value if not exists 'replaced';

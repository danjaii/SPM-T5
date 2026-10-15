-- SCRUM-87 (docs/specs/equipment-requests.md): the Under Review status for equipment requests.
--
-- Requested (Submitted), approved/reserved (Arranged) and rejected (Cannot Fulfil) already exist; Under Review is
-- new. It is added on its own because Postgres cannot use a new enum value in the transaction that adds it, and
-- migration 32's functions refer to it.
--
-- SCRUM-18 availability and reserve_equipment() (migration 12) count only 'approved' and 'reserved' rows, so a
-- request Under Review never reduces availability.
--
-- Affects equipment-service only. Adds one enum value; changes no existing data.

alter type equipment_reservation_status add value if not exists 'under_review' after 'requested';

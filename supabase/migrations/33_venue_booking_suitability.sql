-- SCRUM-110 (docs/specs/venue-request-suitability.md): a venue booking request carries the result of the
-- suitability check (SCRUM-109) from the moment it is submitted, so Venue Staff never receive an unsuitable
-- request without an explanation.
--
-- A snapshot, like the snapshot_* columns of migration 06 (DR8): taken at submission and never rewritten when the
-- venue or the event changes later. Nullable because older requests were never checked.
--   suitability                  'suitable' or 'not_suitable'
--   suitability_unmet            the requirements that were not met, [{ key, label, message }]
--   suitability_override_reason  why the coordinator went ahead anyway; required when not suitable
--
-- Migration 07 narrowed UPDATE on venue_bookings to a column list; these columns are not on it, so nobody can
-- change them after the insert.

alter table venue_bookings
  add column suitability                 text  check (suitability in ('suitable', 'not_suitable')),
  add column suitability_unmet           jsonb,
  add column suitability_override_reason text;

-- A changed booking (SCRUM-102, migration 30) goes back to PENDING with new numbers, so the stored result must be made
-- afresh for them, in the same step. change_venue_booking() gets three optional arguments for it; null leaves the stored
-- result alone. Postgres cannot add arguments to a function in place, so the five-argument version is dropped and
-- re-created with the same body (migration 30) plus the three columns, and its grants are repeated.
drop function if exists public.change_venue_booking(uuid, timestamptz, timestamptz, int, text);

create or replace function public.change_venue_booking(
  p_booking_id                  uuid,
  p_start                       timestamptz,
  p_end                         timestamptz,
  p_expected_attendance         int,
  p_venue_requirements          text,
  p_suitability                 text  default null,
  p_suitability_unmet           jsonb default null,
  p_suitability_override_reason text  default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking venue_bookings := public.venue_booking_for_coordinator(p_booking_id);
  v_moved   boolean;
begin
  if v_booking.status not in ('requested', 'approved') then
    return false;
  end if;
  v_moved := p_start <> v_booking.event_start_datetime or p_end <> v_booking.event_end_datetime;

  update venue_bookings set
    event_start_datetime         = p_start,
    event_end_datetime           = p_end,
    -- setup and teardown keep the same buffer around the new period
    setup_start_datetime         = p_start - (v_booking.event_start_datetime - setup_start_datetime),
    teardown_end_datetime        = p_end + (teardown_end_datetime - v_booking.event_end_datetime),
    snapshot_expected_attendance = p_expected_attendance,
    snapshot_venue_requirements  = p_venue_requirements,
    -- SCRUM-110: the result for the new numbers (the reason is cleared when it is now suitable)
    suitability                  = coalesce(p_suitability, suitability),
    suitability_unmet            = case when p_suitability is null then suitability_unmet else p_suitability_unmet end,
    suitability_override_reason  = case when p_suitability is null then suitability_override_reason else p_suitability_override_reason end,
    -- 102-S2: venue staff decide on it afresh
    status                       = 'requested',
    reviewed_by                  = null,
    reviewed_at                  = null,
    review_notes                 = null
  where id = p_booking_id;

  -- AC8: its equipment follows the new period and goes back to technical support; a change to the numbers alone leaves it
  if v_moved then
    update equipment_reservations set
      start_datetime    = p_start,
      end_datetime      = p_end,
      status            = 'requested',
      quantity_reserved = null,
      reviewed_by       = null
    where venue_booking_id = p_booking_id and status <> 'cancelled';
  end if;
  return true;
end;
$$;

revoke execute on function public.change_venue_booking(uuid, timestamptz, timestamptz, int, text, text, jsonb, text) from public, anon;
grant execute on function public.change_venue_booking(uuid, timestamptz, timestamptz, int, text, text, jsonb, text) to authenticated;
notify pgrst, 'reload schema';

alter table venue_bookings
  add constraint venue_bookings_unsuitable_has_reason check (
    suitability is distinct from 'not_suitable'
    or (suitability_override_reason is not null and char_length(btrim(suitability_override_reason)) between 1 and 500)
  );

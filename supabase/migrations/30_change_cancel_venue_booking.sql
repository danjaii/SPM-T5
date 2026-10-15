-- SCRUM-102 (docs/specs/change-cancel-venue-booking.md): an Event Coordinator changes or cancels one venue booking of their
-- event without affecting its others. Follows 28_multiple_venue_bookings.sql (29 is SCRUM-73's).
--
-- Coordinators may only update a venue booking's status directly (07's column grants), on purpose. So changing and cancelling
-- go through two security definer functions that check the caller, the event and the venue booking, then update, in one step
-- (like reserve_equipment() in 12). They also update the venue booking's equipment requests (equipment_reservations with this
-- venue_booking_id, migration 25) in the same step, so the two cannot get out of step:
--   change_venue_booking()  AC1, AC8  new period and own numbers; PENDING again with its decision cleared. A new period
--                                     moves its equipment requests to it and sends them back to Submitted (requested).
--   cancel_venue_booking()  AC2, AC7  cancelled with who, when and why; its equipment requests are released (cancelled), so
--                                     Arranged equipment is free for other events (18-S8 counts only approved/reserved).
--
-- Both refuse with:
--   42501  the caller is not the event's current assigned coordinator (AC6; a Lead's reassignment moves the right with it)
--   CS102  the event is not Approved, Planning or Awaiting arrangements (DR9; a Confirmed event's venues are SCRUM-111 to 113)
-- and return false, changing nothing, when the venue booking is not PENDING or APPROVED (NOT_ACTIVE). Another event holding
-- the venue is still venue_bookings_no_overlap (06), which ignores the row being changed (23P01, SLOT_CONFLICT).
--
-- Affects venue-service (PATCH /venue-bookings/:id, POST /venue-bookings/:id/cancel) and equipment-service, whose rows the
-- functions update. Adds three columns; changes no existing data.

alter table venue_bookings
  add column if not exists cancelled_by        uuid references users(id),
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancellation_reason text;

-- The checks both functions share. Locks the venue booking so a decision made at the same moment waits for this one.
create or replace function public.venue_booking_for_coordinator(p_booking_id uuid)
returns venue_bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking venue_bookings;
  v_event   events;
begin
  select * into v_booking from venue_bookings where id = p_booking_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  select * into v_event from events where id = v_booking.event_id;
  -- AC6: only the event's current assigned coordinator, whoever made the venue booking
  if public.current_user_role() is distinct from 'event_coordinator' or v_event.assigned_coordinator_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  if v_event.status not in ('approved', 'planning', 'awaiting_arrangements') then
    raise exception using errcode = 'CS102', message = 'EVENT_NOT_ELIGIBLE';
  end if;
  return v_booking;
end;
$$;

create or replace function public.change_venue_booking(
  p_booking_id          uuid,
  p_start               timestamptz,
  p_end                 timestamptz,
  p_expected_attendance int,
  p_venue_requirements  text
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

create or replace function public.cancel_venue_booking(p_booking_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking venue_bookings := public.venue_booking_for_coordinator(p_booking_id);
begin
  if v_booking.status not in ('requested', 'approved') then
    return false;
  end if;
  -- 102-S13: the service requires a reason; the database insists too
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'A reason is required.';
  end if;

  update venue_bookings set
    status              = 'cancelled',
    cancelled_by        = auth.uid(),
    cancelled_at        = now(),
    cancellation_reason = btrim(p_reason)
  where id = p_booking_id;

  -- AC7: release its equipment, so Arranged units are free for other events
  update equipment_reservations set status = 'cancelled'
  where venue_booking_id = p_booking_id and status <> 'cancelled';
  return true;
end;
$$;

-- Functions default to executable by PUBLIC (and so anon); only signed-in users need these. The shared check is internal.
revoke execute on function public.venue_booking_for_coordinator(uuid) from public, anon, authenticated;
revoke execute on function public.change_venue_booking(uuid, timestamptz, timestamptz, int, text) from public, anon;
revoke execute on function public.cancel_venue_booking(uuid, text) from public, anon;
grant execute on function public.change_venue_booking(uuid, timestamptz, timestamptz, int, text) to authenticated;
grant execute on function public.cancel_venue_booking(uuid, text) to authenticated;

-- ask PostgREST to pick up the new functions straight away (harmless if it already has)
notify pgrst, 'reload schema';

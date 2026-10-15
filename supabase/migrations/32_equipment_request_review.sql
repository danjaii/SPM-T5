-- SCRUM-87 (docs/specs/equipment-requests.md): Technical Support Staff review equipment requests.
--
-- A request is a row in equipment_reservations (migration 25). Staff move it from Submitted ('requested') or Under
-- Review ('under_review') to Under Review, Arranged ('approved') or Cannot Fulfil ('rejected', with a reason).
--
--   review_reason, reviewed_at          new nullable columns: why it cannot be fulfilled (AC5), and when it was last
--                                       reviewed. reviewed_by already exists.
--   equipment_free_units(item, s, e)   how many units of the item are free in [s, e): the same rule as SCRUM-18's
--                                       check and reserve_equipment() (migration 12). Only 'approved' and 'reserved'
--                                       rows hold units, the peak at any one moment counts, and an item that is not
--                                       'available' has none free.
--   review_equipment_request(...)       the one way to change a request's status. Decision (2026-10-14): Arranged
--                                       holds units, so it is refused when too few are free, checked and saved in
--                                       one step with the item locked, like reserve_equipment(). Only Technical
--                                       Support Staff (AC7); only Submitted or Under Review requests (AC4); a reason
--                                       for Cannot Fulfil (AC5); not for a finished event (same list as
--                                       equipment_request_event_open(), migration 25).
--   restrictive UPDATE policy           AC7: only Technical Support Staff can change a row directly. Restrictive
--                                       policies are ANDed with the blanket policy from 02_rls.sql. The functions
--                                       above run as the owner, so they are not affected.
--   venue_bookings_select_technical_support
--                                       Technical Support Staff can read a venue booking that an equipment request
--                                       names, so the queue and the event page show its venue. They could not read
--                                       any venue booking before (07_venue_bookings_rls.sql).
--
-- review_equipment_request() returns one row: outcome is 'updated', 'not_found', 'not_reviewable', 'event_locked' or
-- 'insufficient' (with how many were free). It raises 42501 for a caller who is not Technical Support Staff.
--
-- Affects equipment-service (and venue_bookings reads for Technical Support Staff). Adds two columns, three
-- functions and two policies; changes no existing data.

alter table equipment_reservations
  add column if not exists review_reason text,
  add column if not exists reviewed_at timestamptz;

create or replace function public.equipment_free_units(p_equipment_id uuid, p_start timestamptz, p_end timestamptz)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total  int;
  v_status equipment_operational_status;
  v_peak   int;
begin
  select e.total_quantity, e.operational_status into v_total, v_status from equipment e where e.id = p_equipment_id;
  if not found or v_status <> 'available' then
    return 0;
  end if;

  -- The peak is always at the start of the period or of some reservation, so check those instants (migration 12).
  with holding as (
    select greatest(r.start_datetime, p_start)                 as s,
           least(r.end_datetime, p_end)                        as e,
           coalesce(r.quantity_reserved, r.quantity_requested) as units
    from equipment_reservations r
    where r.equipment_id = p_equipment_id
      and r.status in ('approved', 'reserved')
      and r.start_datetime < p_end and r.end_datetime > p_start
  )
  select coalesce(max(out_then), 0) into v_peak
  from (
    select (select coalesce(sum(h2.units), 0) from holding h2 where h2.s <= h.s and h.s < h2.e) as out_then
    from holding h
  ) at_each_start;

  return greatest(v_total - v_peak, 0);
end;
$$;

create or replace function public.review_equipment_request(
  p_request_id uuid,
  p_status     equipment_reservation_status,
  p_reason     text
)
returns table (outcome text, available int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_request equipment_reservations%rowtype;
  v_event   event_status;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_free    int;
begin
  -- AC7: only Technical Support Staff (the service checks this too; this is the lock on the database side).
  if public.current_user_role() is distinct from 'technical_support_staff' then
    raise exception 'Only Technical Support Staff can review equipment requests' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('under_review', 'approved', 'rejected') then
    raise exception 'A request can only be moved to Under Review, Arranged or Cannot Fulfil' using errcode = '22023';
  end if;
  -- AC5: Cannot Fulfil needs a reason.
  if p_status = 'rejected' and v_reason is null then
    raise exception 'Give a reason why the request cannot be fulfilled' using errcode = '22023';
  end if;

  -- Lock the request, so two staff saving at once are applied one after the other.
  select * into v_request from equipment_reservations r where r.id = p_request_id for update;
  if not found then
    return query select 'not_found'::text, null::int;
    return;
  end if;

  -- AC4: only Submitted or Under Review requests are waiting for action.
  if v_request.status not in ('requested', 'under_review') then
    return query select 'not_reviewable'::text, null::int;
    return;
  end if;

  select e.status into v_event from events e where e.id = v_request.event_id;
  if not public.equipment_request_event_open(v_event) then
    return query select 'event_locked'::text, null::int;
    return;
  end if;

  -- Decision: Arranged holds the units, so they must be free. Locking the item makes anyone else arranging or
  -- reserving it (reserve_equipment() takes the same lock) wait until this transaction ends.
  if p_status = 'approved' then
    perform 1 from equipment e where e.id = v_request.equipment_id for update;
    v_free := public.equipment_free_units(v_request.equipment_id, v_request.start_datetime, v_request.end_datetime);
    if v_request.quantity_requested > v_free then
      return query select 'insufficient'::text, v_free;
      return;
    end if;
  end if;

  update equipment_reservations r set
    status            = p_status,
    quantity_reserved = case when p_status = 'approved' then r.quantity_requested end,
    review_reason     = case when p_status = 'rejected' then v_reason end,
    reviewed_by       = v_user,
    reviewed_at       = now()
  where r.id = p_request_id;

  return query select 'updated'::text, null::int;
end;
$$;

-- security definer, like is_requestable_booking() (migration 25): reads equipment_reservations whatever its RLS.
create or replace function public.is_equipment_request_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.equipment_reservations r where r.venue_booking_id = p_booking_id)
$$;

revoke execute on function public.equipment_free_units(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.review_equipment_request(uuid, equipment_reservation_status, text) from public, anon;
revoke execute on function public.is_equipment_request_booking(uuid) from public, anon;
grant execute on function public.equipment_free_units(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.review_equipment_request(uuid, equipment_reservation_status, text) to authenticated;
grant execute on function public.is_equipment_request_booking(uuid) to authenticated;

-- AC7: only Technical Support Staff can change a request directly.
drop policy if exists equipment_reservations_update_technical_support on equipment_reservations;
create policy equipment_reservations_update_technical_support on equipment_reservations
  as restrictive
  for update to authenticated
  using (public.current_user_role() = 'technical_support_staff')
  with check (public.current_user_role() = 'technical_support_staff');

-- Technical Support Staff see the venue of the requests they review.
drop policy if exists venue_bookings_select_technical_support on venue_bookings;
create policy venue_bookings_select_technical_support on venue_bookings
  for select to authenticated
  using (public.current_user_role() = 'technical_support_staff' and public.is_equipment_request_booking(id));

notify pgrst, 'reload schema';

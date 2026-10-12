-- ConnectSphere: reserve_equipment(), reserve equipment for an event, all-or-nothing (SCRUM-19)
-- Follows 10_list_public_events.sql
--
-- "Is enough free?" and "save the reservation" must be ONE step. If equipment-service checked first and
-- saved second, two Technical Support Staff reserving the last units at the same moment would both pass the
-- check and both save, so the same units would be committed to two events (SCRUM-19's whole point).
--
-- A function runs in one transaction, and `for update` on the equipment row makes a second caller wait until
-- the first has finished, so the second one counts AFTER the first one's reservation exists.
--
-- Availability follows the same rules as SCRUM-18's check (services/equipment-service/src/services/availabilityService.ts):
--   * only 'approved' and 'reserved' reservations hold units;
--   * the number out is the PEAK at any one moment of the period, not the sum of every overlapping booking;
--   * equipment that is not 'available' (damaged / under_maintenance / retired) has none free.
--
-- security definer: runs as the function owner, so it can lock the equipment row whatever RLS later allows. In
-- exchange it checks the caller's role itself (only technical_support_staff), and takes the reserving user from
-- the caller's verified JWT (auth.uid()), never from a parameter, so it cannot be spoofed. search_path is pinned
-- so a caller cannot shadow public tables (same as 07 and 10).
--
-- Returns one row. Reserved: ok = true, the new reservation's id, and how many are still free afterwards.
-- Refused (not enough free, or the equipment cannot be used): ok = false, no id, and how many are free.
--
-- Affects equipment-service (POST /equipment-reservations). Adds one function; no table or policy changes.

create or replace function public.reserve_equipment(
  p_event_id     uuid,
  p_equipment_id uuid,
  p_quantity     int,
  p_start        timestamptz,
  p_end          timestamptz
)
returns table (ok boolean, reservation_id uuid, available int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_total  int;
  v_status equipment_operational_status;
  v_peak   int;
  v_free   int;
  v_new_id uuid;
begin
  -- Only Technical Support Staff (the service checks this too; this is the lock on the database side).
  if not exists (select 1 from users u where u.id = v_user and u.role = 'technical_support_staff') then
    raise exception 'Only Technical Support Staff can reserve equipment' using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1' using errcode = '22023';
  end if;
  if p_end <= p_start then
    raise exception 'The end must be after the start' using errcode = '22023';
  end if;

  -- Lock this equipment's row: anyone else reserving it waits here until this transaction ends.
  select e.total_quantity, e.operational_status into v_total, v_status
  from equipment e where e.id = p_equipment_id for update;
  if not found then
    raise exception 'Equipment not found' using errcode = 'P0002';
  end if;

  -- Damaged, under maintenance or retired: none of it is free, whatever the bookings say.
  if v_status <> 'available' then
    return query select false, null::uuid, 0;
    return;
  end if;

  -- The most units out at any one moment of the period. Units out at an instant = every holding reservation
  -- that has started and not ended by then. The peak is always at the start of the period or at the start of
  -- some reservation, so check those instants.
  with holding as (
    select greatest(r.start_datetime, p_start)                       as s,
           least(r.end_datetime, p_end)                              as e,
           coalesce(r.quantity_reserved, r.quantity_requested)       as units
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

  v_free := greatest(v_total - v_peak, 0);

  -- Not enough: refuse, and save nothing (so availability is unchanged).
  if p_quantity > v_free then
    return query select false, null::uuid, v_free;
    return;
  end if;

  -- A Technical Support Staff member decides themselves whether equipment can be reserved (project brief), so the
  -- reservation is saved as 'reserved' straight away, requested and reviewed by the same person.
  insert into equipment_reservations
    (event_id, equipment_id, quantity_requested, quantity_reserved, status, requested_by, reviewed_by,
     start_datetime, end_datetime)
  values
    (p_event_id, p_equipment_id, p_quantity, p_quantity, 'reserved', v_user, v_user, p_start, p_end)
  returning id into v_new_id;

  -- The new reservation covers the whole period, so the peak rises by exactly its quantity.
  return query select true, v_new_id, v_free - p_quantity;
end;
$$;

revoke execute on function public.reserve_equipment(uuid, uuid, int, timestamptz, timestamptz) from public, anon;
grant execute on function public.reserve_equipment(uuid, uuid, int, timestamptz, timestamptz) to authenticated;

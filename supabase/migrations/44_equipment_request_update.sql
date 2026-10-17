-- SCRUM-88 (docs/specs/equipment-requests.md): the assigned Event Coordinator changes an equipment request.
--
-- A request is a row in equipment_reservations (migration 25). Migration 32's restrictive update policy lets only
-- Technical Support Staff change a row directly, so the coordinator's change goes through one function, like
-- review_equipment_request().
--
--   last_edited_by, last_edited_at      new nullable columns: who last changed the request and when (AC8). Only the
--                                       coordinator's changes set them; a status change by staff does not.
--   update_equipment_request(...)       AC1: saves the new item, quantity, venue and notes. AC2 and open question 6
--                                       (decision 2026-10-15): any change sends it back to Submitted ('requested'),
--                                       releasing units an Arranged request held and clearing the last review, so
--                                       staff look at it afresh. AC5, AC6: only the event's assigned coordinator
--                                       (can_request_equipment_for(), migration 25, which follows a Lead's
--                                       reassignment). AC4: not for a finished event. Decision: not for Released
--                                       ('cancelled') equipment. The venue, when given, must be one of the event's
--                                       approved bookings (is_requestable_booking(), migration 25).
--
-- update_equipment_request() returns one outcome: 'updated', 'not_found', 'not_editable', 'event_locked' or
-- 'venue_invalid'. It raises 42501 for a caller who is not the event's assigned coordinator.
--
-- AC7 (a new safety check after the Safety Officer approved) is not built: the safety check is SCRUM-111 to 113.
--
-- Affects equipment-service. Adds two columns and one function; changes no existing data.

alter table equipment_reservations
  add column if not exists last_edited_by uuid references users(id),
  add column if not exists last_edited_at timestamptz;

create or replace function public.update_equipment_request(
  p_request_id       uuid,
  p_equipment_id     uuid,
  p_quantity         int,
  p_venue_booking_id uuid,
  p_notes            text,
  p_start            timestamptz,
  p_end              timestamptz
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request equipment_reservations%rowtype;
  v_event   event_status;
begin
  -- Lock the request, so a change and a status change from staff are applied one after the other.
  select * into v_request from equipment_reservations r where r.id = p_request_id for update;
  if not found then
    return 'not_found';
  end if;

  -- AC5, AC6: only the coordinator assigned to the event now (the service checks this too; this is the database's lock).
  if public.current_user_role() is distinct from 'event_coordinator'
     or not exists (select 1 from events e where e.id = v_request.event_id and e.assigned_coordinator_id = auth.uid()) then
    raise exception 'Only the event''s assigned coordinator can change its equipment requests' using errcode = '42501';
  end if;

  select e.status into v_event from events e where e.id = v_request.event_id;
  if not public.equipment_request_event_open(v_event) then
    return 'event_locked';
  end if;

  if v_request.status = 'cancelled' then
    return 'not_editable';
  end if;

  if p_venue_booking_id is not null and not public.is_requestable_booking(p_venue_booking_id, v_request.event_id) then
    return 'venue_invalid';
  end if;

  update equipment_reservations r set
    equipment_id       = p_equipment_id,
    quantity_requested = p_quantity,
    venue_booking_id   = p_venue_booking_id,
    notes              = nullif(btrim(coalesce(p_notes, '')), ''),
    start_datetime     = p_start,
    end_datetime       = p_end,
    -- AC2: back to Technical Support, as if new
    status             = 'requested',
    quantity_reserved  = null,
    reviewed_by        = null,
    reviewed_at        = null,
    review_reason      = null,
    -- AC8
    last_edited_by     = auth.uid(),
    last_edited_at     = now()
  where r.id = p_request_id;

  return 'updated';
end;
$$;

revoke execute on function public.update_equipment_request(uuid, uuid, int, uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_equipment_request(uuid, uuid, int, uuid, text, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

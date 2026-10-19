-- SCRUM-86 (docs/specs/equipment-requests.md): an Event Coordinator requests equipment for their event.
--
-- A request is a row in equipment_reservations (PO decision; see the spec's "Implementation decisions"):
--   item = equipment_id, quantity = quantity_requested, notes = notes, Submitted = status 'requested',
--   requested_by = the coordinator, start/end copied from the venue booking, venue = venue_booking_id (new).
-- SCRUM-18 availability and reserve_equipment() (migration 12) count only 'approved' and 'reserved' rows, so a new
-- request never reduces availability.
--
--   venue_booking_id                    new nullable column: the approved booking the equipment is for. Older rows
--                                       have none.
--   equipment_request_event_open(s)     false for the finished statuses. Must equal
--                                       EQUIPMENT_REQUEST_LOCKED_EVENT_STATUSES in packages/shared (AC6); an
--                                       integration test checks every status.
--   can_request_equipment_for(event)    the caller is an Event Coordinator, assigned to the event, and the event is
--                                       not finished (AC6, AC7).
--   is_requestable_booking(b, event)    the booking belongs to the event and the venue pages show it as Approved
--                                       (approved, or legacy tentative/confirmed; open question 1). Must equal
--                                       isRequestableVenueBooking() in packages/shared (an integration test checks).
--   restrictive INSERT policy           a direct insert must be such a request, whoever sends it. Restrictive
--                                       policies are ANDed with the blanket policy from 02_rls.sql, so it holds
--                                       even though reads are still blanket (SCRUM-91..93). reserve_equipment() runs
--                                       as the owner, so SCRUM-19 reservations are not affected.
--
-- Affects equipment-service only. Adds a column, three functions and one policy; changes no existing data.

alter table equipment_reservations
  add column if not exists venue_booking_id uuid references venue_bookings(id) on delete set null;

create index if not exists idx_equipment_reservations_venue_booking on equipment_reservations(venue_booking_id);

create or replace function public.equipment_request_event_open(p_status event_status)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_status not in ('completed', 'cancelled', 'rejected')
$$;

-- security definer, like is_assigned_coordinator() (migration 07): reads the caller's role and the event without
-- going through RLS, and only answers about the caller.
create or replace function public.can_request_equipment_for(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() = 'event_coordinator'
     and exists (
       select 1 from public.events e
       where e.id = p_event_id
         and e.assigned_coordinator_id = auth.uid()
         and public.equipment_request_event_open(e.status)
     )
$$;

create or replace function public.is_requestable_booking(p_booking_id uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.venue_bookings b
    where b.id = p_booking_id and b.event_id = p_event_id and b.status in ('approved', 'tentative', 'confirmed')
  )
$$;

revoke execute on function public.equipment_request_event_open(event_status) from public, anon;
revoke execute on function public.can_request_equipment_for(uuid) from public, anon;
revoke execute on function public.is_requestable_booking(uuid, uuid) from public, anon;
grant execute on function public.equipment_request_event_open(event_status) to authenticated;
grant execute on function public.can_request_equipment_for(uuid) to authenticated;
grant execute on function public.is_requestable_booking(uuid, uuid) to authenticated;

-- AC1, AC6, AC7: a new row from a signed-in user is a Submitted request by the event's assigned coordinator, for an
-- open event, made in their own name and not yet reviewed. Whether a venue is required is the app's rule
-- (EQUIPMENT_REQUEST_VENUE_REQUIRED); when one is given, it must be one of the event's approved bookings.
drop policy if exists equipment_reservations_insert_request on equipment_reservations;
create policy equipment_reservations_insert_request on equipment_reservations
  as restrictive
  for insert to authenticated
  with check (
    public.can_request_equipment_for(event_id)
    and status = 'requested'
    and requested_by = auth.uid()
    and reviewed_by is null
    and quantity_reserved is null
    and (venue_booking_id is null or public.is_requestable_booking(venue_booking_id, event_id))
  );

notify pgrst, 'reload schema';

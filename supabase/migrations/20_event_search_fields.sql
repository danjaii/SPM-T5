-- SCRUM-9 (docs/specs/event-search.md): the attendee's List of events can be searched by the event's category, its client
-- organisation and its assigned coordinator, so list_public_events() (10, redefined in 11) now returns their names as well.
-- Follows 11_event_registrations.sql, which has the current definition. Everything else in it is unchanged.
--
-- A function's list of returned columns cannot be changed with "create or replace", so it is dropped and created again (and granted
-- again). Nothing else depends on it: event-service calls it by name, and it only reads.
--
-- The function is security definer, like before, so an attendee needs no access to event_categories, organisations or users: they
-- see the three names here and nothing more. The names of the organisation and the coordinator are sent for every listed event.
-- The story says attendees can search by these, so that is intended. A missing one (no category set, no organisation, no
-- coordinator yet) comes back as null.
--
-- Affects event-service (GET /events/upcoming, and the registration form, which reads the same function).

drop function if exists public.list_public_events();

create function public.list_public_events()
returns table (
  id                     uuid,
  name                   text,
  status                 event_status,
  start_at               timestamptz,
  end_at                 timestamptz,
  venue_name             text,
  venue_address          text,
  registration_capacity  int,
  registration_opens_at  timestamptz,
  registration_closes_at timestamptz,
  active_registrations   int,
  my_registration_status registration_status,
  category_name          text,   -- SCRUM-9
  organisation_name      text,   -- SCRUM-9: the client organisation
  coordinator_name       text    -- SCRUM-9: the assigned coordinator
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.name, e.status, e.preferred_start_datetime, e.preferred_end_datetime, v.name, v.address,
         e.registration_capacity, e.registration_opens_at, e.registration_closes_at,
         -- SCRUM-71/AC7: places held, for "Event Full"
         -- SCRUM-83/AC13: only registered (Confirmed) holds a place; a waitlisted (Pending) one doesn't
         (select count(*)::int from public.event_registrations r
           where r.event_id = e.id and r.status = 'registered'),
         -- SCRUM-71/AC10: the caller's own registration only (auth.uid() is whoever is signed in)
         -- SCRUM-83/AC5: only the active one; earlier withdrawn/rejected rows are history
         (select r.status from public.event_registrations r
           where r.event_id = e.id and r.attendee_id = auth.uid() and r.status in ('registered', 'waitlisted')),
         c.name, o.name, u.full_name
  from public.events e
  -- SCRUM-71/AC3: the venue is where the event is booked: its approved request (or a legacy
  -- 'confirmed' one, see 06), never a rejected one
  left join public.venue_bookings b on b.event_id = e.id and b.status in ('approved', 'confirmed')
  left join public.venues v on v.id = b.venue_id
  -- SCRUM-9: left joins, so an event with no category, organisation or coordinator is still listed
  left join public.event_categories c on c.id = e.event_category_id
  left join public.organisations o on o.id = e.client_organisation_id
  left join public.users u on u.id = e.assigned_coordinator_id
  -- SCRUM-71/AC1: public events only: confirmed and taking attendee registrations
  -- SCRUM-71/AC7: cancelled ones too, so their card can say "Cancelled"
  where e.status in ('confirmed', 'cancelled') and e.registration_required
$$;

revoke execute on function public.list_public_events() from public, anon;
grant execute on function public.list_public_events() to authenticated;

-- ask PostgREST to pick up the changed function straight away (harmless if it already has)
notify pgrst, 'reload schema';

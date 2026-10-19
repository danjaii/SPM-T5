-- SCRUM-98 (docs/specs/multiple-venue-bookings.md): an event can hold several venue bookings at the same time, so larger events
-- can use several spaces. Affects venue-service (submitting and amending venue bookings) and event-service (the attendee's List
-- of events, through list_public_events()).
--
-- 1. Drops DR6's "one active venue booking per event" index (06). Two holding venue bookings at the same venue still cannot
--    overlap: venue_bookings_no_overlap (06) is unchanged and covers the same event as well as other events (98-S14).
-- 2. Adds "one active replacement per rejected venue booking" (98-S20). The one-per-event index used to give this as a side
--    effect: an amendment (SCRUM-60) or an accepted suggestion (SCRUM-59) could not be added while another one was active.
--    The service checks it first; this index settles two requests that arrive at the same instant. Existing rows already
--    meet it, since the one-per-event index allowed at most one holding venue booking per event.
-- 3. Redefines list_public_events() so an event with several approved venue bookings is still one row, not one per venue
--    booking (98-S25). Its columns are unchanged, so "create or replace" keeps the grants from 20.

drop index if exists public.venue_bookings_one_active_per_event;

create unique index if not exists venue_bookings_one_active_replacement
  on public.venue_bookings (amends_booking_id)
  where amends_booking_id is not null and status in ('requested', 'tentative', 'approved', 'confirmed');

create or replace function public.list_public_events()
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
  category_name          text,
  organisation_name      text,
  coordinator_name       text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.name, e.status, e.preferred_start_datetime, e.preferred_end_datetime, vb.venue_names, vb.venue_address,
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
  -- SCRUM-71/AC3: the venue is where the event is booked: its approved venue bookings (or legacy 'confirmed' ones, see 06),
  -- never a rejected one.
  -- SCRUM-98/AC5 (98-S25): one row per event however many venues it has. Each venue is named once, in the order of its first
  -- venue booking ("Lotus Room, Orchid Hall"), and the address is the earliest venue's. With none, both are null, as before.
  left join lateral (
    select string_agg(per_venue.name, ', ' order by per_venue.first_start, per_venue.name) as venue_names,
           (array_agg(per_venue.address order by per_venue.first_start, per_venue.name))[1] as venue_address
    from (
      select v.name, v.address, min(b.event_start_datetime) as first_start
      from public.venue_bookings b
      join public.venues v on v.id = b.venue_id
      where b.event_id = e.id and b.status in ('approved', 'confirmed')
      group by v.id, v.name, v.address
    ) per_venue
  ) vb on true
  -- SCRUM-9: left joins, so an event with no category, organisation or coordinator is still listed
  left join public.event_categories c on c.id = e.event_category_id
  left join public.organisations o on o.id = e.client_organisation_id
  left join public.users u on u.id = e.assigned_coordinator_id
  -- SCRUM-71/AC1: public events only: confirmed and taking attendee registrations
  -- SCRUM-71/AC7: cancelled ones too, so their card can say "Cancelled"
  where e.status in ('confirmed', 'cancelled') and e.registration_required
$$;

-- ask PostgREST to pick up the changed function straight away (harmless if it already has)
notify pgrst, 'reload schema';

-- ConnectSphere: event registrations for SCRUM-83 (Register for an event)
-- Follows 10_list_public_events.sql
--
-- SCRUM-83/AC6: an attendee whose registration was Rejected (cancelled) or Withdrawn can register again, with
-- no limit on attempts, and each attempt is a new row so the earlier ones stay in their history. 01_schema.sql's
-- unique (event_id, attendee_id) allowed only one row per attendee per event, ever, so it is dropped.
--
-- With history, an attendee can have several rows for one event, so list_public_events() (10) is redefined to
-- report only the caller's active (registered = Confirmed, waitlisted = Pending) one: the one a card shows
-- (SCRUM-83/AC5, SCRUM-71/AC10). A withdrawn or rejected registration already counted as none in event-service.
--
-- SCRUM-83/AC13 (decided with the team): a Pending registration doesn't take a slot, so the count behind
-- "Event full" is registered (Confirmed) only. This changes SCRUM-71/AC7, which also counted waitlisted.
--
-- Affects event-service (POST /events/:id/registrations, GET /events/upcoming). No other service reads
-- event_registrations.

alter table public.event_registrations
  drop constraint event_registrations_event_id_attendee_id_key;

-- SCRUM-83/AC5, AC16: at most one active (registered = Confirmed, waitlisted = Pending) registration per attendee
-- per event. A partial unique index: only active rows are checked, so withdrawn/rejected history doesn't count.
-- Two submits arriving together both pass event-service's check, so the database must be the one to refuse
-- the second (23505, which event-service reports as "You already have an active registration").
create unique index event_registrations_one_active_per_attendee
  on public.event_registrations (event_id, attendee_id)
  where status in ('registered', 'waitlisted');

-- ============================================================================
-- RLS: replaces 02_rls.sql's blanket policy, which let any signed-in user read and change every registration
-- (including other attendees' names, emails and contact numbers). Updates and deletes aren't needed yet
-- (withdrawal is a later story), so no policy allows them.
-- ============================================================================

drop policy if exists event_registrations_authenticated_all on event_registrations;
drop policy if exists event_registrations_select on event_registrations;
drop policy if exists event_registrations_insert on event_registrations;

-- SCRUM-83/AC15: an attendee sees their own registrations ("My registrations"), never another attendee's;
-- the event's organiser and its assigned coordinator see all of its registrations (the registration information
-- page). is_event_organiser() and is_assigned_coordinator() are 07's helpers (security definer, so they aren't
-- themselves filtered by events' RLS); venue bookings use the same two.
create policy event_registrations_select on event_registrations
  for select to authenticated
  using (
    attendee_id = auth.uid()
    or public.is_event_organiser(event_id)
    or public.is_assigned_coordinator(event_id)
  );

-- SCRUM-83/AC12: registering (POST /events/:id/registrations inserts as the attendee). An attendee's token also
-- works against Supabase directly, so the database checks what event-service would: the registration is the
-- caller's own (never someone else's name), and it is Pending (waitlisted), so nobody confirms themselves
create policy event_registrations_insert on event_registrations
  for insert to authenticated
  with check (attendee_id = auth.uid() and status = 'waitlisted');

-- Same as 10_list_public_events.sql except where marked SCRUM-83
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
  my_registration_status registration_status
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
           where r.event_id = e.id and r.attendee_id = auth.uid() and r.status in ('registered', 'waitlisted'))
  from public.events e
  -- SCRUM-71/AC3: the venue is where the event is booked: its approved request (or a legacy
  -- 'confirmed' one, see 06), never a rejected one
  left join public.venue_bookings b on b.event_id = e.id and b.status in ('approved', 'confirmed')
  left join public.venues v on v.id = b.venue_id
  -- SCRUM-71/AC1: public events only: confirmed and taking attendee registrations
  -- SCRUM-71/AC7: cancelled ones too, so their card can say "Cancelled"
  where e.status in ('confirmed', 'cancelled') and e.registration_required
$$;

-- ConnectSphere: list_public_events(), the data behind the attendee's List of events (SCRUM-71)
-- Follows 09_venue_bookings_hide_from_organiser.sql
--
-- Attendees cannot read venue_bookings (07/09 RLS), so event-service, querying as the attendee,
-- cannot find an event's venue. This function returns only the attendee-facing facts of each event,
-- including its venue's name and address. All rules (upcoming, order, labels) stay in event-service
-- (services/event-service/src/services/upcomingEvents.ts), so this function only gathers facts.
--
-- security definer: runs as the function owner, so venue_bookings' RLS does not hide the venue.
-- search_path is pinned so a caller cannot shadow public tables (same as the helpers in 07).
--
-- Affects event-service (GET /events/upcoming). No table or policy changes.

create or replace function public.list_public_events()
returns table (
  id            uuid,
  name          text,
  start_at      timestamptz,
  end_at        timestamptz,
  venue_name    text,
  venue_address text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.name, e.preferred_start_datetime, e.preferred_end_datetime, v.name, v.address
  from public.events e
  -- SCRUM-71/AC3: the venue is where the event is booked: its approved request (or a legacy
  -- 'confirmed' one, see 06), never a rejected one
  left join public.venue_bookings b on b.event_id = e.id and b.status in ('approved', 'confirmed')
  left join public.venues v on v.id = b.venue_id
  -- SCRUM-71/AC1: public events only: confirmed and taking attendee registrations
  where e.status = 'confirmed' and e.registration_required
$$;

revoke execute on function public.list_public_events() from public, anon;
grant execute on function public.list_public_events() to authenticated;

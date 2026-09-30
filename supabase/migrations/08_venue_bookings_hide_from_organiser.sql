-- ConnectSphere: venue_bookings are not readable by the Event Organiser
-- Follows 07_venue_bookings_rls.sql
--
-- 07 let an event's organiser SELECT the venue booking requests for events they organise. Venue
-- Staff record a rejection reason on the request (review_notes), and SCRUM-39 (39-S7) says that
-- reason is for Venue Staff and the event's assigned Coordinator only, never the Organiser.
-- Row Level Security cannot hide a single column, so the organiser clause is removed from the
-- SELECT policy instead. Nothing reads venue_bookings as an organiser today (the organiser
-- dashboard shows events only), so no service loses a feature.
--
--   SELECT  venue_staff: every row. Assigned coordinator: rows for their events. Nobody else.
--
-- Only the SELECT policy changes; INSERT, UPDATE and DELETE policies from 07 are untouched.
-- Migration 07 is not edited (migrations are append-only). public.is_event_organiser() stays,
-- as other tables may use it.
--
-- Affects venue-service (no code change) and the auth-service dashboards (no query reads
-- venue_bookings as an organiser).

drop policy if exists venue_bookings_select on venue_bookings;

create policy venue_bookings_select on venue_bookings
  for select to authenticated
  using (
    public.current_user_role() = 'venue_staff'
    or public.is_assigned_coordinator(event_id)
  );

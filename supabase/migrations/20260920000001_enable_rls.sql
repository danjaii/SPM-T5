-- ConnectSphere: enable Row Level Security
-- Follows 20260920000000_init_schema.sql
--
-- Purpose: close public/anon access on every table now that the project
-- will be hosted. Each table gets RLS enabled plus one blanket policy
-- allowing any authenticated user full access. This is deliberately
-- permissive (no per-role restriction yet) so development is not blocked,
-- it only removes anonymous access. Replace these blanket policies with
-- per-role policies (e.g. organisers only editing their own events,
-- attendees only seeing their own registrations) once those rules are
-- defined.

-- ============================================================================
-- IDENTITY
-- ============================================================================

alter table organisations enable row level security;
create policy organisations_authenticated_all on organisations
  for all to authenticated using (true) with check (true);

alter table users enable row level security;
create policy users_authenticated_all on users
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- LOOKUP TABLES
-- ============================================================================

alter table event_categories enable row level security;
create policy event_categories_authenticated_all on event_categories
  for all to authenticated using (true) with check (true);

alter table room_layouts enable row level security;
create policy room_layouts_authenticated_all on room_layouts
  for all to authenticated using (true) with check (true);

alter table facilities enable row level security;
create policy facilities_authenticated_all on facilities
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- VENUES
-- ============================================================================

alter table venues enable row level security;
create policy venues_authenticated_all on venues
  for all to authenticated using (true) with check (true);

alter table venue_supported_layouts enable row level security;
create policy venue_supported_layouts_authenticated_all on venue_supported_layouts
  for all to authenticated using (true) with check (true);

alter table venue_facilities enable row level security;
create policy venue_facilities_authenticated_all on venue_facilities
  for all to authenticated using (true) with check (true);

alter table venue_unavailability enable row level security;
create policy venue_unavailability_authenticated_all on venue_unavailability
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- EVENTS
-- ============================================================================

alter table events enable row level security;
create policy events_authenticated_all on events
  for all to authenticated using (true) with check (true);

alter table event_status_history enable row level security;
create policy event_status_history_authenticated_all on event_status_history
  for all to authenticated using (true) with check (true);

alter table event_coordinator_history enable row level security;
create policy event_coordinator_history_authenticated_all on event_coordinator_history
  for all to authenticated using (true) with check (true);

alter table event_sessions enable row level security;
create policy event_sessions_authenticated_all on event_sessions
  for all to authenticated using (true) with check (true);

alter table event_change_requests enable row level security;
create policy event_change_requests_authenticated_all on event_change_requests
  for all to authenticated using (true) with check (true);

alter table event_comments enable row level security;
create policy event_comments_authenticated_all on event_comments
  for all to authenticated using (true) with check (true);

alter table event_documents enable row level security;
create policy event_documents_authenticated_all on event_documents
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- VENUE BOOKINGS
-- ============================================================================

alter table venue_bookings enable row level security;
create policy venue_bookings_authenticated_all on venue_bookings
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- EQUIPMENT AND TECHNICAL SUPPORT
-- ============================================================================

alter table equipment enable row level security;
create policy equipment_authenticated_all on equipment
  for all to authenticated using (true) with check (true);

alter table equipment_reservations enable row level security;
create policy equipment_reservations_authenticated_all on equipment_reservations
  for all to authenticated using (true) with check (true);

alter table technical_support_requests enable row level security;
create policy technical_support_requests_authenticated_all on technical_support_requests
  for all to authenticated using (true) with check (true);

alter table technical_staff_assignments enable row level security;
create policy technical_staff_assignments_authenticated_all on technical_staff_assignments
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- REGISTRATION
-- ============================================================================

alter table event_registrations enable row level security;
create policy event_registrations_authenticated_all on event_registrations
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- CROSS CUTTING: NOTIFICATIONS AND AUDIT
-- ============================================================================

alter table notifications enable row level security;
create policy notifications_authenticated_all on notifications
  for all to authenticated using (true) with check (true);

alter table activity_log enable row level security;
create policy activity_log_authenticated_all on activity_log
  for all to authenticated using (true) with check (true);

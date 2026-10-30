-- ConnectSphere: users' contact details are private (SCRUM-154; docs/specs/users-contact-privacy.md; ADR 0003)
-- Follows 51_lead_queue_summary.sql
--
-- Why: 02_rls.sql left `users` with "for all ... using (true) with check (true)", so any signed-in user could read every
-- user's email and phone, change another user's name or phone, and delete or insert user rows by querying the database
-- directly. The customer says access follows the user's role and direct relationship to an event (Week 9 answers, row 15).
--
-- Approach: rows stay readable, contact columns do not. Other users' names are read through RLS all over the services
-- (PostgREST embeds such as staff:users!staff_id(full_name), the coordinator picker, mentions), so an own-row-only
-- policy would turn every one of those into a silent null. A row policy cannot hide a column, so a column grant does
-- it, the same tool as 03_users_role_privilege.sql. The secret key still reads everything.
--
--   Role-by-action on public.users (authenticated unless stated)
--   ---------------------------------------------------------------------------------------------------------------
--   SELECT   every row, columns id, role, full_name, organisation_id, department, is_active, supervising_lead_id,
--            created_at, updated_at only. email, phone and communication_preferences are refused (42501) for every role.
--   UPDATE   the caller's own row only (id = auth.uid()), columns full_name, phone, communication_preferences only
--            (03's column grant, unchanged). role, email, department, is_active stay unwritable.
--   INSERT   none. Accounts are created by auth-service with the secret key.
--   DELETE   none.
--   anon     nothing.
--
--   Functions (security definer, executable by authenticated only)
--   ---------------------------------------------------------------------------------------------------------------
--   my_contact_details()                  the caller's own email, phone and communication_preferences. Any signed-in role.
--   event_registration_contacts(event)    name, email and phone of each registrant of that event. Rows only for the
--                                         event's organiser or its assigned coordinator; anyone else gets none.
--
-- Affects auth-service (GET /profile) and event-service (registration form prefill, GET /events/:id/registrations).
-- venue-service, equipment-service and notification-service read only names and roles, which stay readable.

drop policy if exists users_authenticated_all on public.users;

-- Table-level SELECT goes first, then the safe columns come back. UPDATE keeps 03's column grant.
revoke select, insert, delete on public.users from authenticated, anon;
revoke update on public.users from anon;

-- supervising_lead_id (19) is a link, not contact information, and the Lead's overview functions (22, 23, 24) read it as the caller
grant select (id, role, full_name, organisation_id, department, is_active, supervising_lead_id, created_at, updated_at)
  on public.users to authenticated;

create policy users_select on public.users
  for select to authenticated
  using (true);

create policy users_update_own on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================================
-- Functions
-- ============================================================================

-- SCRUM-154/AC5: the caller's own contact details. Reports facts about the caller (auth.uid()) only.
create or replace function public.my_contact_details()
returns table (email text, phone text, communication_preferences jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.email, u.phone, u.communication_preferences
  from public.users u
  where u.id = auth.uid()
$$;

-- SCRUM-154/AC3, AC4: the registrants' contact details, for the people who manage the event. The check is inside the
-- function (is_event_organiser() and is_assigned_coordinator() are 07's helpers), so anyone else gets an empty list.
create or replace function public.event_registration_contacts(p_event_id uuid)
returns table (registration_id uuid, attendee_id uuid, full_name text, email text, phone text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.attendee_id, u.full_name, u.email, u.phone
  from public.event_registrations r
  join public.users u on u.id = r.attendee_id
  where r.event_id = p_event_id
    and (public.is_event_organiser(p_event_id) or public.is_assigned_coordinator(p_event_id))
$$;

-- Functions default to executable by PUBLIC (and so anon); only signed-in users need these.
revoke execute on function public.my_contact_details() from public, anon;
revoke execute on function public.event_registration_contacts(uuid) from public, anon;
grant execute on function public.my_contact_details() to authenticated;
grant execute on function public.event_registration_contacts(uuid) to authenticated;

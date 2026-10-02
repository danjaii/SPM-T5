-- ConnectSphere: per-role Row Level Security for venue_bookings
-- Follows 06_venue_booking_requests.sql
--
-- 02_rls.sql gave venue_bookings one blanket policy (any authenticated user, full access). This
-- replaces it with per-role policies for the venue booking request flow (SCRUM-32/33/35, and the
-- approval stories that decide requests). The service-role key still bypasses RLS, so test
-- fixtures and admin tooling are unaffected. Other tables keep their blanket policies.
--
--   SELECT  venue_staff: every row. Assigned coordinator: rows for their events. Organiser: rows
--           for events they organise. Everyone else (technical support, attendees): none.
--   INSERT  the event's assigned coordinator, as themselves, and only a new pending request.
--   UPDATE  the assigned coordinator may withdraw their own pending request (requested -> withdrawn).
--           venue_staff may decide a pending request (requested -> approved | rejected).
--   DELETE  nobody through the API.
--
-- The event lookups go through security definer helpers instead of an inline subquery on events,
-- so these policies keep working when events' own blanket policy is later tightened (an inline
-- subquery is evaluated under the caller's RLS on events).
--
-- Affects venue-service and the auth-service dashboards, which read venue_bookings as the user.

-- ============================================================================
-- HELPERS
-- ============================================================================
-- security definer: run as the function owner so the lookup is not itself filtered by RLS on
-- users/events (and cannot recurse into it). search_path is pinned so a caller cannot shadow
-- public tables. They only report facts about the caller (auth.uid()), never about other users.

create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.role from public.users u where u.id = auth.uid()
$$;

create or replace function public.is_assigned_coordinator(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.assigned_coordinator_id = auth.uid()
  )
$$;

create or replace function public.is_event_organiser(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.organiser_id = auth.uid()
  )
$$;

-- Is any holding request (requested/tentative/approved/confirmed) overlapping this period at this
-- venue? Returns only a yes/no, so a coordinator can pre-check a slot even though RLS hides other
-- coordinators' rows from them. Same half-open overlap rule as venue_bookings_no_overlap (DR5).
-- The exclusion constraint stays the authority; this is the friendly pre-check.
create or replace function public.venue_slot_is_held(
  p_venue_id uuid,
  p_start    timestamptz,
  p_end      timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.venue_bookings b
    where b.venue_id = p_venue_id
      and b.status in ('requested', 'tentative', 'approved', 'confirmed')
      and b.event_start_datetime < p_end
      and b.event_end_datetime > p_start
  )
$$;

-- Functions default to executable by PUBLIC (and so anon); only signed-in users need these.
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.is_assigned_coordinator(uuid) from public, anon;
revoke execute on function public.is_event_organiser(uuid) from public, anon;
revoke execute on function public.venue_slot_is_held(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_assigned_coordinator(uuid) to authenticated;
grant execute on function public.is_event_organiser(uuid) to authenticated;
grant execute on function public.venue_slot_is_held(uuid, timestamptz, timestamptz) to authenticated;

-- ============================================================================
-- COLUMN AND DELETE PRIVILEGES
-- ============================================================================
-- RLS decides which rows; it cannot stop an allowed update from also rewriting venue, times or
-- requester. As in 03_users_role_privilege.sql, narrow the UPDATE grant to the columns that
-- withdrawing and deciding actually write. Everything else is set on insert and then fixed.
-- (Changing a request's slot means a new amendment row, SCRUM-60.) DELETE is removed outright.

revoke update on venue_bookings from authenticated, anon;
grant update (
  status,
  withdrawn_by,
  withdrawn_at,
  reviewed_by,
  reviewed_at,
  review_notes,
  suggested_venue_id,
  suggested_start_datetime,
  suggested_end_datetime
) on venue_bookings to authenticated;

revoke delete on venue_bookings from authenticated, anon;

-- ============================================================================
-- POLICIES
-- ============================================================================

drop policy if exists venue_bookings_authenticated_all on venue_bookings;
drop policy if exists venue_bookings_select on venue_bookings;
drop policy if exists venue_bookings_insert_coordinator on venue_bookings;
drop policy if exists venue_bookings_update_coordinator_withdraw on venue_bookings;
drop policy if exists venue_bookings_update_staff_decide on venue_bookings;

create policy venue_bookings_select on venue_bookings
  for select to authenticated
  using (
    public.current_user_role() = 'venue_staff'
    or public.is_assigned_coordinator(event_id)
    or public.is_event_organiser(event_id)
  );

-- A new request: made by the event's assigned coordinator, in their own name, still pending,
-- with no review or withdrawal data pre-filled.
create policy venue_bookings_insert_coordinator on venue_bookings
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_coordinator'
    and public.is_assigned_coordinator(event_id)
    and requested_by = auth.uid()
    and status = 'requested'
    and reviewed_by is null
    and reviewed_at is null
    and review_notes is null
    and withdrawn_by is null
    and withdrawn_at is null
    and suggested_venue_id is null
  );

-- Withdraw: the coordinator's own pending request, on an event they are still assigned to, may
-- only become 'withdrawn' and must record who withdrew it. A decided request matches no row
-- (USING), so the update touches nothing.
create policy venue_bookings_update_coordinator_withdraw on venue_bookings
  for update to authenticated
  using (
    public.current_user_role() = 'event_coordinator'
    and public.is_assigned_coordinator(event_id)
    and requested_by = auth.uid()
    and status = 'requested'
  )
  with check (
    public.is_assigned_coordinator(event_id)
    and requested_by = auth.uid()
    and status = 'withdrawn'
    and withdrawn_by = auth.uid()
    and reviewed_by is null
    and reviewed_at is null
    and review_notes is null
    and suggested_venue_id is null
  );

-- Decide: venue staff act on pending requests only, and must sign the decision.
create policy venue_bookings_update_staff_decide on venue_bookings
  for update to authenticated
  using (
    public.current_user_role() = 'venue_staff'
    and status = 'requested'
  )
  with check (
    public.current_user_role() = 'venue_staff'
    and status in ('approved', 'rejected')
    and reviewed_by = auth.uid()
    and withdrawn_by is null
    and withdrawn_at is null
  );

-- No DELETE policy: with RLS enabled (02_rls.sql) that denies deletes through the API.

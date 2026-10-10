-- ConnectSphere: per-role Row Level Security for events and the tables hanging off them (SCRUM-91)
-- Follows 10_list_public_events.sql
--
-- 02_rls.sql gave events and its child tables one blanket policy (any authenticated user, full
-- access). event-service checked access in application code only, so anyone querying Supabase
-- directly could read or edit any event. 07 and 08 did this for venue_bookings and the review
-- tables (comments, mentions, attachments, assignment logs); this does it for the rest. The
-- service-role key still bypasses RLS, so test fixtures and admin tooling are unaffected.
--
--   events
--     SELECT  organiser: their own events. Event coordinator: every event except other people's
--             drafts (an assigned coordinator also sees a draft). Venue staff: events that have a
--             venue booking. Technical support: events with a support request or equipment
--             reservation. Attendee: events they have a registration for (any status).
--             Everything else the attendee sees comes from list_public_events() (10), which is
--             security definer, so attendees need no other access here.
--     INSERT  nobody through the API yet: event creation and drafts (not built) will add organiser
--             policies with the stories that need them.
--     UPDATE  event coordinators only, on columns status and assigned_coordinator_id only (column
--             grant below). Any coordinator may assign a coordinator (SCRUM-42); only the
--             coordinator assigned to the event may change its status (SCRUM-8/AC6), enforced by a
--             trigger because a row policy cannot tell which column an update changes.
--     DELETE  nobody through the API.
--
--   event_status_history, event_coordinator_history   append-only audit trails
--     SELECT  any event coordinator, and the event's organiser (user_can_access_event, from 08).
--     INSERT  status history: the event's assigned coordinator, in their own name (this is what
--             change_event_status() writes, as the caller). Coordinator history: an event
--             coordinator, in their own name.
--     UPDATE / DELETE  nobody through the API.
--
--   event_sessions   SELECT whoever can read the event (the agenda is attendee-facing).
--   event_documents, event_change_requests   SELECT any event coordinator and the event's organiser.
--     No write policy yet on these three: nothing writes them today. The stories that build them
--     (event creation, drafts, post-approval change requests) add their own policies.
--
-- Helpers are security definer so a lookup in another table is not itself filtered by that
-- table's RLS (and cannot recurse into the policies that call them); search_path is pinned. Same
-- pattern as 07 and 08. event_sessions deliberately uses an inline subquery on events instead, so
-- it always follows whatever the caller may read there.
--
-- Affects event-service, venue-service (reads events as the caller) and the auth-service
-- dashboards (embed events(name) in bookings, support requests and registrations, which is why
-- venue staff, technical support and attendees need the read clauses above). Migrations 07 and 08
-- are not edited. Other tables keep their blanket policies until their own tickets.

-- ============================================================================
-- HELPERS
-- ============================================================================

-- Does this event have any venue booking request? (venue staff read the events they act on.)
create or replace function public.event_has_venue_booking(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.venue_bookings b where b.event_id = p_event_id)
$$;

-- Does this event have a technical support request or an equipment reservation?
create or replace function public.event_has_technical_work(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.technical_support_requests r where r.event_id = p_event_id)
      or exists (select 1 from public.equipment_reservations r where r.event_id = p_event_id)
$$;

-- Has the signed-in user registered for this event (including withdrawn, so "my registrations" can
-- still show its name)? Reports only a fact about the caller (auth.uid()), never about others.
create or replace function public.event_has_my_registration(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.event_registrations r
    where r.event_id = p_event_id and r.attendee_id = auth.uid()
  )
$$;

revoke execute on function public.event_has_venue_booking(uuid) from public, anon;
revoke execute on function public.event_has_technical_work(uuid) from public, anon;
revoke execute on function public.event_has_my_registration(uuid) from public, anon;
grant execute on function public.event_has_venue_booking(uuid) to authenticated;
grant execute on function public.event_has_technical_work(uuid) to authenticated;
grant execute on function public.event_has_my_registration(uuid) to authenticated;

-- ============================================================================
-- COLUMN AND DELETE PRIVILEGES
-- ============================================================================
-- RLS decides which rows, not which columns. As in 03 and 07, narrow UPDATE on events to the two
-- columns the services write today (assigning a coordinator, changing status), so an allowed
-- update cannot also rewrite the organiser, dates or capacity. service_role is unaffected.
-- The audit trails are append-only for signed-in users and anon.

revoke update on events from authenticated, anon;
grant update (status, assigned_coordinator_id) on events to authenticated;

revoke update, delete on event_status_history, event_coordinator_history from authenticated, anon;

-- ============================================================================
-- STATUS-CHANGE GUARD
-- ============================================================================
-- SCRUM-8/AC6: only the assigned coordinator may change an event's status. The UPDATE policy below
-- lets any coordinator update events (for SCRUM-42 assignment), so the status rule lives here.
-- auth.uid() is null for the service role and direct database sessions, which are left alone.

create or replace function public.events_status_change_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and old.assigned_coordinator_id is distinct from auth.uid() then
    raise exception 'Only the coordinator assigned to this event can change its status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_status_change_guard on events;
create trigger trg_events_status_change_guard
  before update of status on events
  for each row execute function public.events_status_change_guard();

-- ============================================================================
-- POLICIES
-- ============================================================================

drop policy if exists events_authenticated_all on events;
drop policy if exists event_status_history_authenticated_all on event_status_history;
drop policy if exists event_coordinator_history_authenticated_all on event_coordinator_history;
drop policy if exists event_sessions_authenticated_all on event_sessions;
drop policy if exists event_documents_authenticated_all on event_documents;
drop policy if exists event_change_requests_authenticated_all on event_change_requests;

create policy events_select on events
  for select to authenticated
  using (
    organiser_id = auth.uid()
    or (
      public.current_user_role() = 'event_coordinator'
      and (status <> 'draft' or assigned_coordinator_id = auth.uid())
    )
    or (public.current_user_role() = 'venue_staff' and public.event_has_venue_booking(id))
    or (public.current_user_role() = 'technical_support_staff' and public.event_has_technical_work(id))
    or (public.current_user_role() = 'attendee' and public.event_has_my_registration(id))
  );

create policy events_update_coordinator on events
  for update to authenticated
  using (
    public.current_user_role() = 'event_coordinator'
    and (status <> 'draft' or assigned_coordinator_id = auth.uid())
  )
  with check (public.current_user_role() = 'event_coordinator');

create policy event_status_history_select on event_status_history
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), event_id));

create policy event_status_history_insert on event_status_history
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_coordinator'
    and public.is_assigned_coordinator(event_id)
    and changed_by = auth.uid()
  );

create policy event_coordinator_history_select on event_coordinator_history
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), event_id));

create policy event_coordinator_history_insert on event_coordinator_history
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_coordinator'
    and assigned_by = auth.uid()
  );

create policy event_sessions_select on event_sessions
  for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_sessions.event_id));

create policy event_documents_select on event_documents
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), event_id));

create policy event_change_requests_select on event_change_requests
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), event_id));

-- No INSERT/UPDATE/DELETE policy on events, event_sessions, event_documents or
-- event_change_requests beyond the above: with RLS enabled (02_rls.sql) that denies them through the API.

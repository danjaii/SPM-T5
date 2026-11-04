-- ConnectSphere: an event coordinator reads an event only while it is assigned to them (SCRUM-156)
-- Follows 58_venue_calendar.sql; spec docs/specs/coordinator-event-reads.md, ADR 0003.
--
-- SCRUM-91 (migrations 08 and 14) let every coordinator read every non-draft event and, through
-- user_can_access_event(), the comments, mentions, attachments, status history, coordinator history, documents and
-- change requests of every event. The customer's Week 9 answers say access follows "the user's role and direct
-- relationship to an event" (r15) and that coordinators "only manage events assigned to them by the Lead" (r36), so a
-- coordinator has no reason to read an event that is not theirs.
--
--   Who                                     events SELECT / UPDATE        comments, mentions, attachments, history,
--                                                                         documents, change requests (via the helper)
--   Coordinator assigned to the event       the event                     the event
--   Any other coordinator                   none (was: every non-draft)   none (was: every event)
--   Previous coordinator after a reassign   none                          none
--   Organiser of the event                  the event                     the event
--   Lead, Venue Staff, Technical Support
--   Staff, attendee                         unchanged (21, 22, 14)        unchanged
--
-- Two changes:
--   1. events_select and events_update_coordinator: the coordinator clause becomes assigned_coordinator_id = auth.uid().
--      The draft exception goes, since an assigned coordinator already satisfies the new rule. The update policy's
--      with check, the column grant (status, assigned_coordinator_id) and the status and assignment triggers are as in
--      14, 23 and 24. The Lead's two read policies (21, 22) are not touched.
--   2. user_can_access_event(): true for the event's organiser and for the event's assigned coordinator, no longer for
--      any coordinator. create or replace, so the policies that call it (comments, mentions, attachments, the
--      event-attachments bucket, status history, coordinator history, documents, change requests) narrow without being
--      re-created.
--
-- A reassigned event moves with the coordinator: the new one reads all of it, the previous one none. Nothing is copied
-- or deleted. Affects event-service (the mentionable-users list now offers the event's own people), and
-- venue-service, equipment-service, notification-service and auth-service only through what a coordinator may read.
-- Migrations 08 and 14 are not edited.

-- ============================================================================
-- HELPER
-- ============================================================================

-- Can this user see an event's review data: the event's assigned coordinator, or its own organiser?
create or replace function public.user_can_access_event(p_user uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        (u.role = 'event_coordinator'
            and exists (select 1 from public.events e where e.id = p_event_id and e.assigned_coordinator_id = u.id))
        or (u.role = 'event_organiser'
            and exists (select 1 from public.events e where e.id = p_event_id and e.organiser_id = u.id))
      )
  )
$$;

-- ============================================================================
-- POLICIES
-- ============================================================================

drop policy if exists events_select on events;
create policy events_select on events
  for select to authenticated
  using (
    organiser_id = auth.uid()
    or (public.current_user_role() = 'event_coordinator' and assigned_coordinator_id = auth.uid())
    or (public.current_user_role() = 'venue_staff' and public.event_has_venue_booking(id))
    or (public.current_user_role() = 'technical_support_staff' and public.event_has_technical_work(id))
    or (public.current_user_role() = 'attendee' and public.event_has_my_registration(id))
  );

drop policy if exists events_update_coordinator on events;
create policy events_update_coordinator on events
  for update to authenticated
  using (
    public.current_user_role() = 'event_coordinator'
    and assigned_coordinator_id = auth.uid()
  )
  with check (public.current_user_role() = 'event_coordinator');

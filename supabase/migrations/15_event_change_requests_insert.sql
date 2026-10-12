-- ConnectSphere: let an event organiser submit a change request (SCRUM-66)
-- Follows 14_events_rls.sql (SCRUM-91), which left event_change_requests with a SELECT policy only.
--
--   INSERT  the event's own organiser, in their own name (requested_by = auth.uid()), as a
--           pending request, and only while the event is past draft and not cancelled, rejected
--           or completed (SCRUM-66/AC1-AC3). Must match canRequestChange() in packages/shared.
--   UPDATE / DELETE  nobody through the API. Approving or rejecting a request is a later story
--           and will add its own policy and column grant. An organiser therefore cannot edit or
--           withdraw a request, nor mark it approved themselves.
--
-- A change request only records what is proposed (proposed_changes jsonb). It never touches the
-- events row: organisers have no UPDATE on events (11), so the event's details stay as they are
-- until a request is approved (SCRUM-66/AC6).
--
-- The helper is security definer so reading the event is not filtered by events' own RLS and cannot
-- recurse into it; search_path is pinned. Same pattern as 07, 08 and 11. Affects event-service only.

create or replace function public.organiser_can_request_change(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.organiser_id = auth.uid()
      and e.status not in ('draft', 'cancelled', 'rejected', 'completed')
  )
$$;

revoke execute on function public.organiser_can_request_change(uuid) from public, anon;
grant execute on function public.organiser_can_request_change(uuid) to authenticated;

revoke update, delete on event_change_requests from authenticated, anon;

create policy event_change_requests_insert on event_change_requests
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_organiser'
    and requested_by = auth.uid()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and review_notes is null
    and public.organiser_can_request_change(event_id)
  );

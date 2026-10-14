-- SCRUM-77 (docs/specs/event-coordinator-lead-role.md): the Event Coordinator Lead's queue of event requests waiting for a
-- coordinator. All Leads share one queue (BR4).
--
--   is_closed_event_status(status)  the one database definition of a closed event: completed, cancelled or rejected.
--                                   Must match CLOSED_EVENT_STATUSES in packages/shared/src/eventStatus.ts
--                                   (tests/integration/leadQueue.test.ts checks every status).
--   events_select_lead              a Lead may read events that are submitted (not draft) and have no coordinator.
--   lead_unassigned_queue()         the queue: submitted, non-closed, no coordinator, oldest submission first, with the
--                                   organiser's name. Security invoker, so the policy above applies; it refuses anyone
--                                   who is not a Lead (42501) rather than returning an empty list.
--
-- Affects event-service only. No table changes; the other policies on events (14_events_rls.sql) are not edited.

create or replace function public.is_closed_event_status(p_status event_status)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_status in ('completed', 'cancelled', 'rejected')
$$;

revoke execute on function public.is_closed_event_status(event_status) from public, anon;
grant execute on function public.is_closed_event_status(event_status) to authenticated;

drop policy if exists events_select_lead on events;
create policy events_select_lead on events
  for select to authenticated
  using (
    public.current_user_role() = 'event_coordinator_lead'
    and status <> 'draft'
    and assigned_coordinator_id is null
  );

create or replace function public.lead_unassigned_queue()
returns table (
  id                       uuid,
  name                     text,
  organiser_name           text,
  preferred_start_datetime timestamptz,
  preferred_end_datetime   timestamptz,
  expected_attendance      int,
  submitted_at             timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  -- SCRUM-77/AC7: the queue is for Leads only
  if public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can view the unassigned queue' using errcode = '42501';
  end if;

  return query
    select e.id, e.name, u.full_name, e.preferred_start_datetime, e.preferred_end_datetime, e.expected_attendance,
           e.submitted_at
    from events e
    left join users u on u.id = e.organiser_id
    where e.status <> 'draft'                              -- AC1: submitted
      and not public.is_closed_event_status(e.status)      -- AC5
      and e.assigned_coordinator_id is null                -- AC4
    order by e.submitted_at asc nulls last, e.created_at asc; -- AC3
end;
$$;

revoke execute on function public.lead_unassigned_queue() from public, anon;
grant execute on function public.lead_unassigned_queue() to authenticated;

notify pgrst, 'reload schema';

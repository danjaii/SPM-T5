-- SCRUM-81 (docs/specs/event-coordinator-lead-role.md): a Lead's view of the coordinators they supervise and their
-- non-closed events. Workload count = the number of non-closed events assigned to a coordinator (no cap, BR5).
--
--   is_my_coordinator(user)          is this user an Event Coordinator linked to the signed-in Lead (migration 19)?
--   events_select_lead_team          a Lead may read the events assigned to their own coordinators, and no other Lead's.
--   lead_coordinator_overview()      the signed-in Lead's active linked coordinators, each with their workload count
--                                    (0 included), by name.
--   lead_coordinator_events(coord)   that coordinator's non-closed events, soonest preferred date first. Refused (42501)
--                                    unless the coordinator is active and linked to the caller.
--
-- Both functions are security invoker (RLS applies) and refuse anyone who is not a Lead (42501). "Closed" is
-- is_closed_event_status() from migration 21. Affects event-service only; no table changes.

create or replace function public.is_my_coordinator(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user and u.role = 'event_coordinator' and u.supervising_lead_id = auth.uid()
  )
$$;

revoke execute on function public.is_my_coordinator(uuid) from public, anon;
grant execute on function public.is_my_coordinator(uuid) to authenticated;

drop policy if exists events_select_lead_team on events;
create policy events_select_lead_team on events
  for select to authenticated
  using (
    public.current_user_role() = 'event_coordinator_lead'
    and assigned_coordinator_id is not null
    and public.is_my_coordinator(assigned_coordinator_id)
  );

create or replace function public.lead_coordinator_overview()
returns table (id uuid, full_name text, workload int)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  -- SCRUM-81/AC7
  if public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can view the coordinator overview' using errcode = '42501';
  end if;

  return query
    select u.id, u.full_name,
           (select count(*) from events e
             where e.assigned_coordinator_id = u.id
               and not public.is_closed_event_status(e.status))::int   -- AC1, AC3 (0 included), AC4
    from users u
    where u.role = 'event_coordinator'
      and u.is_active                                                  -- AC1: active only
      and u.supervising_lead_id = auth.uid()                           -- AC1: linked to me
    order by u.full_name;
end;
$$;

create or replace function public.lead_coordinator_events(p_coordinator_id uuid)
returns table (
  id                       uuid,
  name                     text,
  status                   event_status,
  preferred_start_datetime timestamptz,
  preferred_end_datetime   timestamptz,
  expected_attendance      int
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  -- SCRUM-81/AC7, BR4: Leads only, and only for an active coordinator they supervise
  if public.current_user_role() is distinct from 'event_coordinator_lead'
     or not exists (select 1 from users u where u.id = p_coordinator_id and u.is_active and public.is_my_coordinator(u.id)) then
    raise exception 'You can only view coordinators you supervise' using errcode = '42501';
  end if;

  return query
    select e.id, e.name, e.status, e.preferred_start_datetime, e.preferred_end_datetime, e.expected_attendance
    from events e
    where e.assigned_coordinator_id = p_coordinator_id
      and not public.is_closed_event_status(e.status)                  -- AC2, AC4
    order by e.preferred_start_datetime asc nulls last, e.name;
end;
$$;

revoke execute on function public.lead_coordinator_overview() from public, anon;
revoke execute on function public.lead_coordinator_events(uuid) from public, anon;
grant execute on function public.lead_coordinator_overview() to authenticated;
grant execute on function public.lead_coordinator_events(uuid) to authenticated;

notify pgrst, 'reload schema';

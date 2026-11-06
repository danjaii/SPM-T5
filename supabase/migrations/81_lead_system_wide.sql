-- SCRUM-184 (docs/specs/lead-system-wide-scope.md): a Lead works across every coordinator, not only the ones linked to them.
-- Follows 76_organiser_home.sql on main; the pending migrations 77 to 80 are independent of this one (it re-creates functions
-- from 22, 23, 24 and 51 and the policy from 22, which no pending migration touches). Append-only: nothing earlier is edited.
--
--   is_coordinator(user)            NEW: is this user an Event Coordinator, whoever supervises them? Replaces is_my_coordinator (22),
--                                   which is dropped at the end.
--   events_select_lead_team         a Lead reads every event that has a coordinator (not drafts); with 21's policy for unassigned
--                                   submitted events, a Lead reads every submitted event (W9 r37).
--   lead_coordinator_overview()     every active coordinator with their workload, not only linked ones.
--   lead_coordinator_events(coord)  any active coordinator's non-closed events.
--   lead_assign_coordinator()       any active coordinator is a valid target (CL003 otherwise).
--   lead_reassign_coordinator()     any active coordinator is a valid target; an event held by any coordinator can be moved.
--                                   CL005 (held by another Lead's coordinator) can no longer happen.
--   lead_queue_summary()            counts every active event with a coordinator, not only the Lead's team's.
--
-- users.supervising_lead_id (19) is left as it is: it is no longer used for access. No table changes. Affects event-service only.

create or replace function public.is_coordinator(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.users u where u.id = p_user and u.role = 'event_coordinator')
$$;

revoke execute on function public.is_coordinator(uuid) from public, anon;
grant execute on function public.is_coordinator(uuid) to authenticated;

drop policy if exists events_select_lead_team on events;
create policy events_select_lead_team on events
  for select to authenticated
  using (
    public.current_user_role() = 'event_coordinator_lead'
    and assigned_coordinator_id is not null
    and status <> 'draft'
  );

create or replace function public.lead_coordinator_overview()
returns table (id uuid, full_name text, workload int)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can view the coordinator overview' using errcode = '42501';
  end if;

  return query
    select u.id, u.full_name,
           (select count(*) from events e
             where e.assigned_coordinator_id = u.id
               and not public.is_closed_event_status(e.status))::int
    from users u
    where u.role = 'event_coordinator'
      and u.is_active
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
  if public.current_user_role() is distinct from 'event_coordinator_lead'
     or not exists (select 1 from users u where u.id = p_coordinator_id and u.is_active and public.is_coordinator(u.id)) then
    raise exception 'You can only view an active coordinator''s events' using errcode = '42501';
  end if;

  return query
    select e.id, e.name, e.status, e.preferred_start_datetime, e.preferred_end_datetime, e.expected_attendance
    from events e
    where e.assigned_coordinator_id = p_coordinator_id
      and not public.is_closed_event_status(e.status)
    order by e.preferred_start_datetime asc nulls last, e.name;
end;
$$;

create or replace function public.lead_assign_coordinator(p_event_id uuid, p_coordinator_id uuid)
returns table (assigned_coordinator_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_event events%rowtype;
begin
  if public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from users u where u.id = p_coordinator_id and u.is_active and public.is_coordinator(u.id)) then
    raise exception 'Choose an active coordinator' using errcode = 'CL003';
  end if;

  -- the check and the write are one statement, so a concurrent assignment can't slip in between
  update events set assigned_coordinator_id = p_coordinator_id
  where events.id = p_event_id
    and events.assigned_coordinator_id is null
    and events.status <> 'draft'
    and not public.is_closed_event_status(events.status);

  if not found then
    select * into v_event from events where events.id = p_event_id;
    if not found or v_event.status = 'draft' then
      raise exception 'Event not found' using errcode = 'P0002';
    elsif public.is_closed_event_status(v_event.status) then
      raise exception 'This event is closed, so its coordinator can''t be changed' using errcode = 'CL001';
    else
      raise exception 'This event has already been assigned to a coordinator' using errcode = 'CL002';
    end if;
  end if;

  insert into coordinator_assignment_logs (event_id, coordinator_id, previous_coordinator_id, assigned_by)
  values (p_event_id, p_coordinator_id, null, auth.uid());

  return query select p_coordinator_id;
end;
$$;

create or replace function public.lead_reassign_coordinator(p_event_id uuid, p_coordinator_id uuid)
returns table (assigned_coordinator_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_event events%rowtype;
begin
  if public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from users u where u.id = p_coordinator_id and u.is_active and public.is_coordinator(u.id)) then
    raise exception 'Choose an active coordinator' using errcode = 'CL003';
  end if;

  select * into v_event from events where events.id = p_event_id for update;
  if not found or v_event.status = 'draft' then
    raise exception 'Event not found' using errcode = 'P0002';
  elsif public.is_closed_event_status(v_event.status) then
    raise exception 'This event is closed, so its coordinator can''t be changed' using errcode = 'CL001';
  elsif v_event.assigned_coordinator_id is null then
    raise exception 'This event has no coordinator yet' using errcode = 'CL004';
  elsif v_event.assigned_coordinator_id = p_coordinator_id then
    raise exception 'This coordinator is already assigned to the event' using errcode = 'CL006';
  end if;

  update events set assigned_coordinator_id = p_coordinator_id where events.id = p_event_id;

  insert into coordinator_assignment_logs (event_id, coordinator_id, previous_coordinator_id, assigned_by)
  values (p_event_id, p_coordinator_id, v_event.assigned_coordinator_id, auth.uid());

  return query select p_coordinator_id;
end;
$$;

create or replace function public.lead_queue_summary()
returns table (
  events_this_month    int,
  next_event_name      text,
  next_event_start     timestamptz,
  reassigned_this_week int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore';
begin
  if public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can view the queue summary' using errcode = '42501';
  end if;

  return query
    with active as (
      select e.name, e.preferred_start_datetime as starts
      from events e
      where e.assigned_coordinator_id is not null
        and e.status <> 'draft'
        and not public.is_closed_event_status(e.status)
        and e.preferred_start_datetime is not null
    )
    select
      (select count(*) from active
        where starts >= v_month_start and starts < v_month_start + interval '1 month')::int,
      (select m.name from active m where m.starts >= now() order by m.starts limit 1),
      (select m.starts from active m where m.starts >= now() order by m.starts limit 1),
      (select count(*) from coordinator_assignment_logs l
        where l.assigned_by = auth.uid()
          and l.previous_coordinator_id is not null
          and l.assigned_at >= now() - interval '7 days')::int;
end;
$$;

-- nothing uses the old helper any more (the policy and the five functions above were its only callers)
drop function public.is_my_coordinator(uuid);

revoke execute on function public.lead_coordinator_overview() from public, anon;
revoke execute on function public.lead_coordinator_events(uuid) from public, anon;
revoke execute on function public.lead_assign_coordinator(uuid, uuid) from public, anon;
revoke execute on function public.lead_reassign_coordinator(uuid, uuid) from public, anon;
revoke execute on function public.lead_queue_summary() from public, anon;
grant execute on function public.lead_coordinator_overview() to authenticated;
grant execute on function public.lead_coordinator_events(uuid) to authenticated;
grant execute on function public.lead_assign_coordinator(uuid, uuid) to authenticated;
grant execute on function public.lead_reassign_coordinator(uuid, uuid) to authenticated;
grant execute on function public.lead_queue_summary() to authenticated;

notify pgrst, 'reload schema';

-- SCRUM-126: the figures the Lead's unassigned queue shows beside the queue itself.
--
-- lead_queue_summary() answers, for the signed-in Lead only:
--   events_this_month      non-closed events held by the Lead's own coordinators that start in the current month (Singapore time)
--   next_event_name/start  the earliest of those events that has not started yet
--   reassigned_this_week   reassignments this Lead made in the last 7 days (a log row with a previous coordinator)
-- The queue size, the oldest wait and the active-event total come from lead_unassigned_queue() and
-- lead_coordinator_overview(), so they are not repeated here.
--
-- Security definer because coordinator_assignment_logs is readable only through user_can_access_event(); the function
-- refuses everyone but a Lead and reads only that Lead's own team and own reassignments, so it returns counts and one
-- event name, nothing wider. Adds no table or column; affects event-service (GET /lead/summary) and apps/web.

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
    with mine as (
      select e.name, e.preferred_start_datetime as starts
      from events e
      where e.assigned_coordinator_id is not null
        and public.is_my_coordinator(e.assigned_coordinator_id)
        and not public.is_closed_event_status(e.status)
        and e.preferred_start_datetime is not null
    )
    select
      (select count(*) from mine
        where starts >= v_month_start and starts < v_month_start + interval '1 month')::int,
      (select m.name from mine m where m.starts >= now() order by m.starts limit 1),
      (select m.starts from mine m where m.starts >= now() order by m.starts limit 1),
      (select count(*) from coordinator_assignment_logs l
        where l.assigned_by = auth.uid()
          and l.previous_coordinator_id is not null
          and l.assigned_at >= now() - interval '7 days')::int;
end;
$$;

revoke execute on function public.lead_queue_summary() from public, anon;
grant execute on function public.lead_queue_summary() to authenticated;

notify pgrst, 'reload schema';

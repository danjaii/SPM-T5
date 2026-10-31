-- SCRUM-176 (docs/specs/conflicting-change-request.md): a pending change request cannot be joined by another that changes the
-- same thing. Follows 66_safety_reject_auto_start.sql.
--
-- The customer said in the Week 9 Q&A that "active change requests should be processed by the Coordinator before additional
-- major conflicting change requests are submitted." POST /events/:id/change-requests already refuses such a request; this is
-- the database's own check, so two requests sent at the same moment cannot both get through.
--
-- 1. change_request_things(jsonb): the things a request's proposed_changes touches, as changeRequestConflicts() in
--    packages/shared sees them (the two must agree): expected attendance; date and time (start and end time are one thing,
--    because moving an event changes both); venue requirements; equipment requirements. A seeded request holding only the new
--    value still names its field. Anything that is not a JSON object touches nothing.
-- 2. change_request_conflict_guard() (trigger, before insert): a new pending request that shares a thing with another pending
--    request for the same event is refused with CS176 (AC1). Other things (AC2), decided requests (AC3) and other events go
--    ahead. It first locks the event's row, so two requests for one event are checked one after the other. security definer,
--    so it sees every pending request, not only those RLS shows the caller.
--
-- Affects event-service (the change request route answers CS176 with 409). Adds two functions and a trigger; changes no
-- existing data.

create or replace function public.change_request_things(p_proposed jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct thing), '{}')
  from (
    select case k
             when 'expected_attendance'          then 'expected attendance'
             when 'preferred_start_datetime'     then 'date and time'
             when 'preferred_end_datetime'       then 'date and time'
             when 'venue_requirements'           then 'venue requirements'
             when 'equipment_requirements_notes' then 'equipment requirements'
           end as thing
    from jsonb_object_keys(case when jsonb_typeof(p_proposed) = 'object' then p_proposed else '{}'::jsonb end) as k
  ) things
  where thing is not null
$$;

create or replace function public.change_request_conflict_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'pending' then
    return new;
  end if;

  -- one request at a time per event, so two sent at once cannot both pass the check below
  perform 1 from events where id = new.event_id for update;

  if exists (
    select 1 from event_change_requests r
    where r.event_id = new.event_id
      and r.status = 'pending'
      and r.id is distinct from new.id
      and public.change_request_things(r.proposed_changes) && public.change_request_things(new.proposed_changes)
  ) then
    raise exception using errcode = 'CS176', message = 'CONFLICTING_REQUEST';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_change_request_conflict_guard on event_change_requests;
create trigger trg_change_request_conflict_guard
  before insert on event_change_requests
  for each row execute function public.change_request_conflict_guard();

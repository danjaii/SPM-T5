-- SCRUM-126/AC3: when a Lead reassigns an event, the coordinator who had it is told as well as the one who takes it over.
--
-- notify_coordinator_assignment() (migration 44) told only the new coordinator. coordinator_assignment_logs already records
-- previous_coordinator_id, so the same trigger now writes a second, informational notification for that coordinator in the
-- same transaction as the reassignment (ADR 0002). An assignment with no previous coordinator, or one that names the same
-- person, writes nothing extra.
--
-- Affects event-service (the reassign route) and notification-service (the notification list shows the new type). Adds no
-- column and changes no data; the trigger itself is unchanged, only its function body.

create or replace function public.notify_coordinator_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_name text;
begin
  select e.name into v_event_name from events e where e.id = new.event_id;

  insert into notifications (user_id, event_id, type, title, message)
  values (new.coordinator_id, new.event_id, 'coordinator_assigned', 'You are responsible for an event', v_event_name);

  if new.previous_coordinator_id is not null and new.previous_coordinator_id is distinct from new.coordinator_id then
    insert into notifications (user_id, event_id, type, title, message)
    values (new.previous_coordinator_id, new.event_id, 'coordinator_reassigned', 'An event was reassigned to another coordinator', v_event_name);
  end if;

  return new;
end;
$$;

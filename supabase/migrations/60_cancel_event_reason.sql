-- SCRUM-174 (docs/specs/cancel-event.md), part 1 of 4: a cancellation needs a reason, and is stamped.
-- Follows 59_coordinator_event_reads.sql.
--
-- 1. change_event_status() (migration 04) refuses Cancelled without a reason (22023, AC1), because the reason is sent to the
--    organiser and the attendees (AC6; the notification is written by SCRUM-172's migration 65). The rest of the function is
--    unchanged: it still runs as the caller, so RLS and the status guards (migrations 14, 37) apply as before, and it writes
--    the status history row with the reason (AC2).
-- 2. events_stamp_cancelled() (trigger): the moment an event becomes Cancelled, events.cancelled_at is set (AC2). A trigger,
--    because the coordinator may only update an event's status and coordinator directly (migration 14's column grant).
--
-- Affects event-service (PATCH /events/:id/status). Replaces one function, adds a trigger; changes no existing data.

create or replace function change_event_status(
  p_event_id   uuid,
  p_new_status event_status,
  p_reason     text default null
)
returns table (id uuid, name text, status event_status)
language plpgsql
security invoker
as $$
#variable_conflict use_column
declare
  v_old_status event_status;
begin
  -- SCRUM-174/AC1: a cancellation needs a reason, so the organiser and attendees can be told why
  if p_new_status = 'cancelled' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'A reason is required to cancel an event.';
  end if;

  -- lock the row so nobody else changes the status between reading and writing it
  select events.status into v_old_status from events where events.id = p_event_id for update;
  if not found then
    return;
  end if;

  update events set status = p_new_status where events.id = p_event_id;

  insert into event_status_history (event_id, old_status, new_status, changed_by, reason)
  values (p_event_id, v_old_status, p_new_status, auth.uid(), p_reason);

  return query select events.id, events.name, events.status from events where events.id = p_event_id;
end;
$$;

create or replace function public.events_stamp_cancelled()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_stamp_cancelled on events;
create trigger trg_events_stamp_cancelled
  before update of status on events
  for each row execute function public.events_stamp_cancelled();

notify pgrst, 'reload schema';

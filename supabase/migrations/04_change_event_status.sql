-- ConnectSphere: change an event's status and record it, all-or-nothing (SCRUM-8)
-- Follows 03_users_role_privilege.sql
--
-- event-service used to change events.status and then insert into
-- event_status_history as two separate requests. If the second one failed,
-- the status changed with no record of who changed it or why — and the
-- project brief asks that returned/rejected decisions keep a record.
--
-- A function runs in a single transaction, so either both writes happen or
-- neither does. A trigger can't do this job: it would never see the reason
-- the coordinator typed, since that isn't a column on events.
--
-- security invoker: runs as the calling user, so RLS still applies exactly
-- as if they had made the two writes themselves. changed_by comes from the
-- caller's verified JWT (auth.uid()), so it can't be spoofed by the client.
--
-- Returns the updated event, or no row if the event doesn't exist.

create function change_event_status(
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

grant execute on function change_event_status(uuid, event_status, text) to authenticated;

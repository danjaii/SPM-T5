-- SCRUM-42/AC3 + AC6, SCRUM-41/AC3 + AC7: assign (or reassign) an event's coordinator and record it in
-- coordinator_assignment_logs together, all-or-nothing. Before this, event-service updated events and then
-- inserted the log as two separate calls, so a failed insert left an assignment with no history (SCRUM-43/AC4).
--
-- Same shape as change_event_status (04_change_event_status.sql): security invoker, so RLS on events and
-- coordinator_assignment_logs still applies to the caller. Who may assign whom is checked by event-service
-- before it calls this. Affects event-service only; no table changes.

create or replace function assign_coordinator(
  p_event_id       uuid,
  p_coordinator_id uuid
)
returns table (assigned_coordinator_id uuid, previous_coordinator_id uuid)
language plpgsql
security invoker
as $$
#variable_conflict use_column
declare
  v_previous uuid;
begin
  -- lock the row so two coordinators can't (re)assign the same event at once
  select events.assigned_coordinator_id into v_previous from events where events.id = p_event_id for update;
  if not found then
    return;
  end if;

  update events set assigned_coordinator_id = p_coordinator_id where events.id = p_event_id;

  insert into coordinator_assignment_logs (event_id, coordinator_id, previous_coordinator_id, assigned_by)
  values (p_event_id, p_coordinator_id, v_previous, auth.uid());

  return query select p_coordinator_id, v_previous;
end;
$$;

revoke execute on function assign_coordinator(uuid, uuid) from public, anon;
grant execute on function assign_coordinator(uuid, uuid) to authenticated;

-- ask PostgREST to pick up the new function straight away (harmless if it already has)
notify pgrst, 'reload schema';

-- SCRUM-183 (docs/specs/coordinator-history-own-events.md): a coordinator adds a coordinator-history row only for an event
-- assigned to them.
--
-- Migration 14 let any event coordinator insert a row into event_coordinator_history as long as assigned_by was themselves, so a
-- coordinator could write a row against an event assigned to someone else. That is the one child table of events whose insert rule
-- did not check whose event it is: event_status_history, just above it in migration 14, uses is_assigned_coordinator(event_id).
-- Use the same helper here (migration 07). Everything else about the table stays: the select policy, the revoked update and
-- delete, and the columns. No service and no page writes this table (the Lead's assign and reassign write
-- coordinator_assignment_logs, migrations 23 and 24), so no existing flow depends on the old rule. Migration 14 is not edited.

drop policy event_coordinator_history_insert on public.event_coordinator_history;

create policy event_coordinator_history_insert on public.event_coordinator_history
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_coordinator'
    and public.is_assigned_coordinator(event_id)
    and assigned_by = auth.uid()
  );

-- SCRUM-79 (docs/specs/event-coordinator-lead-role.md): an Event Coordinator Lead reassigns a non-closed event held by one
-- of their coordinators to another of their coordinators. From here only a Lead changes an event's coordinator: this
-- replaces SCRUM-41's hand-over by the assigned coordinator (PO decision).
--
--   events_assignment_guard (trigger, replaces migration 23's)  on any change to events.assigned_coordinator_id by a
--                                      signed-in user: BR2 a closed event can't be changed (CL001); otherwise only a
--                                      Lead may change it (42501), whether it is a first assignment or a reassignment.
--                                      So the coordinators' UPDATE policy (14) and assign_coordinator() (13) can no
--                                      longer change who is assigned. The service role is let through.
--   lead_reassign_coordinator(event, coordinator)
--                                      security definer, like lead_assign_coordinator() (23). In order:
--                                        42501  caller is not a Lead (AC9)
--                                        CL003  the new coordinator is not active and linked to the caller (AC6, BR4)
--                                        then the event row is locked (FOR UPDATE) so its holder can't change underneath:
--                                        P0002  no such (submitted) event
--                                        CL001  closed (AC5, BR2)
--                                        CL004  no coordinator yet (that is an assignment, SCRUM-78)
--                                        CL005  held by a coordinator the caller does not supervise (BR4)
--                                        CL006  the new coordinator is the current one (AC2)
--                                      then updates and records previous coordinator, new coordinator, the Lead and the
--                                      time in coordinator_assignment_logs, together (AC3, AC8).
--
-- Affects event-service only. No table changes.

create or replace function public.events_assignment_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.assigned_coordinator_id is not distinct from old.assigned_coordinator_id or auth.uid() is null then
    return new;
  end if;
  if public.is_closed_event_status(old.status) then
    raise exception 'This event is closed, so its coordinator can''t be changed' using errcode = 'CL001';
  end if;
  if public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can assign or reassign a coordinator' using errcode = '42501';
  end if;
  return new;
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
  if not exists (select 1 from users u where u.id = p_coordinator_id and u.is_active and public.is_my_coordinator(u.id)) then
    raise exception 'Choose one of your active coordinators' using errcode = 'CL003';
  end if;

  select * into v_event from events where events.id = p_event_id for update;
  if not found or v_event.status = 'draft' then
    raise exception 'Event not found' using errcode = 'P0002';
  elsif public.is_closed_event_status(v_event.status) then
    raise exception 'This event is closed, so its coordinator can''t be changed' using errcode = 'CL001';
  elsif v_event.assigned_coordinator_id is null then
    raise exception 'This event has no coordinator yet' using errcode = 'CL004';
  elsif not public.is_my_coordinator(v_event.assigned_coordinator_id) then
    raise exception 'You can only reassign events held by coordinators you supervise' using errcode = 'CL005';
  elsif v_event.assigned_coordinator_id = p_coordinator_id then
    raise exception 'This coordinator is already assigned to the event' using errcode = 'CL006';
  end if;

  update events set assigned_coordinator_id = p_coordinator_id where events.id = p_event_id;

  insert into coordinator_assignment_logs (event_id, coordinator_id, previous_coordinator_id, assigned_by)
  values (p_event_id, p_coordinator_id, v_event.assigned_coordinator_id, auth.uid());

  return query select p_coordinator_id;
end;
$$;

revoke execute on function public.lead_reassign_coordinator(uuid, uuid) from public, anon;
grant execute on function public.lead_reassign_coordinator(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

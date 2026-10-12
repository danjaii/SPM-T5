-- SCRUM-78 (docs/specs/event-coordinator-lead-role.md): an Event Coordinator Lead assigns an unassigned event request to
-- one of their coordinators. Only a Lead can make an event's first assignment: this replaces SCRUM-42's coordinator
-- self-claim (PO decision). Reassignment by the assigned coordinator (SCRUM-41) is unchanged here.
--
--   events_assignment_guard (trigger)  on any change to events.assigned_coordinator_id by a signed-in user:
--                                      BR2   a closed event (is_closed_event_status(), migration 21) cannot be
--                                            assigned or reassigned (CL001);
--                                      78/AC9 a first assignment (no coordinator yet) is for a Lead only (42501).
--                                      The service role and direct database sessions (auth.uid() is null) are let through.
--   lead_assign_coordinator(event, coordinator)
--                                      the Lead's assignment. Security definer, because Leads have no UPDATE on events
--                                      and no INSERT on coordinator_assignment_logs, so this is the only way they can
--                                      assign; it checks the caller itself. In order:
--                                        42501  caller is not a Lead
--                                        CL003  the coordinator is not active and linked to the caller (BR4, AC7)
--                                        then one conditional UPDATE ... WHERE no coordinator AND not closed. Two Leads
--                                        racing for the same event: the second waits on the row lock, re-checks the
--                                        WHERE against the committed row and updates nothing (AC5). If nothing was
--                                        updated, why: P0002 no such (submitted) event, CL001 closed, CL002 already
--                                        assigned.
--                                      The first assignment is logged in coordinator_assignment_logs like SCRUM-43's.
--
-- Custom SQLSTATEs (class CL) are mapped to messages by event-service (routes/lead.ts). Affects event-service only.

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
  if old.assigned_coordinator_id is null and public.current_user_role() is distinct from 'event_coordinator_lead' then
    raise exception 'Only an Event Coordinator Lead can assign a coordinator to an unassigned event' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_assignment_guard on events;
create trigger trg_events_assignment_guard
  before update of assigned_coordinator_id on events
  for each row execute function public.events_assignment_guard();

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
  if not exists (select 1 from users u where u.id = p_coordinator_id and u.is_active and public.is_my_coordinator(u.id)) then
    raise exception 'Choose one of your active coordinators' using errcode = 'CL003';
  end if;

  -- AC5: the check and the write are one statement, so a concurrent assignment can't slip in between
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

revoke execute on function public.lead_assign_coordinator(uuid, uuid) from public, anon;
grant execute on function public.lead_assign_coordinator(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

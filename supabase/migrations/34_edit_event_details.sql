-- SCRUM-111 (docs/specs/edit-event-details.md): the assigned Event Coordinator edits an event's planning information, and
-- every edit is recorded (what changed, who, when). Follows 30_change_cancel_venue_booking.sql (31 to 33 are SCRUM-87 and
-- SCRUM-88's).
--
-- 1. events.venue_requirements: the brief names venue requirements as event information, but events had no column for it.
--    "if not exists", because SCRUM-49's branch adds the same column; whichever merges first, the other still works.
-- 2. event_change_history: one row per saved edit, with each changed field as { from, to } and whether any important field
--    (one that may affect venue or equipment arrangements) changed. The event's assigned coordinator and its organiser can
--    read it (AC4); nobody writes it directly.
-- 3. update_event_details(): coordinators may only update an event's status and coordinator directly (14's column grants),
--    so an edit goes through this security definer function. It checks the caller and the event, refuses a field that may
--    not be edited and a "from" that is no longer the event's value, then updates the event and writes the history row in
--    one step. It works out "important" itself, from the field lists in packages/shared/src/eventDetails.ts.
--
-- Refusals: 42501 not the event's current assigned coordinator (AC7; a Lead's reassignment moves the right with it);
-- CS112 the event is completed, cancelled or rejected (AC6); CS111 a "from" differs from the event (changed meanwhile);
-- 22023 an empty edit or a field that may not be edited; 23503 a category or room layout that does not exist.
--
-- Affects event-service (PATCH /events/:id, GET /events/:id/edit-form and /change-history). Adds one column and one table;
-- changes no existing data.

alter table events add column if not exists venue_requirements text;

create table if not exists event_change_history (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  changed_by   uuid not null references users(id),
  changed_at   timestamptz not null default now(),
  changes      jsonb not null,
  is_important boolean not null
);

create index if not exists idx_event_change_history_event on event_change_history(event_id, changed_at desc);

alter table event_change_history enable row level security;
revoke all on event_change_history from authenticated, anon;
grant select on event_change_history to authenticated;

drop policy if exists event_change_history_select on event_change_history;
create policy event_change_history_select on event_change_history
  for select to authenticated
  using (public.is_assigned_coordinator(event_id) or public.is_event_organiser(event_id));

create or replace function public.update_event_details(p_event_id uuid, p_changes jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- packages/shared/src/eventDetails.ts: EVENT_ORDINARY_FIELDS and EVENT_IMPORTANT_FIELDS
  v_ordinary  text[] := array['name', 'description', 'purpose', 'event_category_id'];
  v_important text[] := array['preferred_start_datetime', 'preferred_end_datetime', 'expected_attendance',
                              'preferred_room_layout_id', 'accessibility_requirements', 'venue_requirements',
                              'equipment_requirements_notes'];
  v_event     events;
  v_current   jsonb;
  v_field     text;
  v_from      jsonb;
  v_same      boolean;
begin
  select * into v_event from events where id = p_event_id for update;
  -- AC7: only the event's current assigned coordinator (an event that does not exist says nothing more)
  if not found
     or public.current_user_role() is distinct from 'event_coordinator'
     or v_event.assigned_coordinator_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  -- AC6: finished events are left as they are
  if public.is_closed_event_status(v_event.status) then
    raise exception using errcode = 'CS112', message = 'EVENT_LOCKED';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Nothing to change.';
  end if;

  v_current := to_jsonb(v_event);
  for v_field in select jsonb_object_keys(p_changes) loop
    -- only the editable fields: never the status, the coordinator, the organiser or anything else
    if not (v_field = any(v_ordinary) or v_field = any(v_important)) then
      raise exception using errcode = '22023', message = format('Not an editable field: %s', v_field);
    end if;
    -- each "from" must still be the event's value; times are compared as times, not as text
    v_from := p_changes -> v_field -> 'from';
    if v_field in ('preferred_start_datetime', 'preferred_end_datetime') then
      v_same := (v_from #>> '{}')::timestamptz is not distinct from (v_current ->> v_field)::timestamptz;
    else
      v_same := coalesce(v_from, 'null'::jsonb) = coalesce(v_current -> v_field, 'null'::jsonb);
    end if;
    if not v_same then
      raise exception using errcode = 'CS111', message = 'STALE';
    end if;
  end loop;

  update events set
    name                         = case when p_changes ? 'name' then p_changes -> 'name' ->> 'to' else name end,
    description                  = case when p_changes ? 'description' then p_changes -> 'description' ->> 'to' else description end,
    purpose                      = case when p_changes ? 'purpose' then p_changes -> 'purpose' ->> 'to' else purpose end,
    event_category_id            = case when p_changes ? 'event_category_id'
                                        then (p_changes -> 'event_category_id' ->> 'to')::uuid else event_category_id end,
    preferred_start_datetime     = case when p_changes ? 'preferred_start_datetime'
                                        then (p_changes -> 'preferred_start_datetime' ->> 'to')::timestamptz else preferred_start_datetime end,
    preferred_end_datetime       = case when p_changes ? 'preferred_end_datetime'
                                        then (p_changes -> 'preferred_end_datetime' ->> 'to')::timestamptz else preferred_end_datetime end,
    expected_attendance          = case when p_changes ? 'expected_attendance'
                                        then (p_changes -> 'expected_attendance' ->> 'to')::int else expected_attendance end,
    preferred_room_layout_id     = case when p_changes ? 'preferred_room_layout_id'
                                        then (p_changes -> 'preferred_room_layout_id' ->> 'to')::uuid else preferred_room_layout_id end,
    accessibility_requirements   = case when p_changes ? 'accessibility_requirements'
                                        then p_changes -> 'accessibility_requirements' ->> 'to' else accessibility_requirements end,
    venue_requirements           = case when p_changes ? 'venue_requirements'
                                        then p_changes -> 'venue_requirements' ->> 'to' else venue_requirements end,
    equipment_requirements_notes = case when p_changes ? 'equipment_requirements_notes'
                                        then p_changes -> 'equipment_requirements_notes' ->> 'to' else equipment_requirements_notes end,
    updated_at                   = now()
  where id = p_event_id;

  -- AC4: what changed, who, when, and whether it included an important field
  insert into event_change_history (event_id, changed_by, changes, is_important)
  values (p_event_id, auth.uid(), p_changes,
          exists (select 1 from jsonb_object_keys(p_changes) k where k = any(v_important)));
  return true;
end;
$$;

revoke execute on function public.update_event_details(uuid, jsonb) from public, anon;
grant execute on function public.update_event_details(uuid, jsonb) to authenticated;

-- ask PostgREST to pick up the new column, table and function straight away (harmless if it already has)
notify pgrst, 'reload schema';

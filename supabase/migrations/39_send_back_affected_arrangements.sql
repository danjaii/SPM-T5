-- SCRUM-113 (docs/specs/send-back-affected-arrangements.md): confirming an important event change sends the arrangements
-- it affects back for review, in the same step as saving it. Follows 34_edit_event_details.sql (35 to 38 are SCRUM-46,
-- SCRUM-104 and SCRUM-105's).
--
-- 1. sent_back_changes, sent_back_at on venue_bookings and equipment_reservations: the event's changes that sent it back
--    ({ field: { from, to } }, as in event_change_history) and when, so Venue Staff and Technical Support Staff can see what
--    changed (AC3) without reading the event's change history.
-- 2. clear_sent_back(): any later status change that is not itself a send-back (Venue Staff approve or reject, Technical
--    Support Staff review, SCRUM-102's change or cancel) clears them, so the note never shows on a later Pending. A trigger,
--    so no existing function changes.
-- 3. update_event_details() gains p_send_back { venue_bookings: [ids], equipment_requests: [ids] }: the arrangements
--    SCRUM-112's warning listed (event-service works them out with the shared rule). It only touches that event's own
--    active ones:
--    - a pending or approved venue booking -> Pending ('requested'), the earlier decision cleared (as 30's change does);
--      Pending still holds its venue (AC1);
--    - a Submitted, Under Review or Arranged equipment request -> Submitted, its units released, its review cleared (AC2);
--    - each keeps a merged note: a field already there keeps its "from" and takes the new "to" (sent back twice);
--    - a Confirmed event returns to Planning when at least one was sent back, recorded in event_status_history (AC4).
--    Anything else listed (another event's, rejected, withdrawn, cancelled, released) is left alone (AC5).
--
-- The old two-argument function is dropped: with p_send_back defaulting to null, a call without it behaves as before.
-- Refusals are 34's, plus 22023 for a p_send_back that is not an object.
--
-- Affects event-service (PATCH /events/:id), venue-service (queue, venue bookings) and equipment-service (equipment
-- requests). Adds two columns to each table, one trigger each and changes update_event_details(); changes no existing data.

alter table venue_bookings
  add column if not exists sent_back_changes jsonb,
  add column if not exists sent_back_at      timestamptz;

alter table equipment_reservations
  add column if not exists sent_back_changes jsonb,
  add column if not exists sent_back_at      timestamptz;

-- 113-S6: a status change that does not come with a new send-back clears the note
create or replace function public.clear_sent_back()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.sent_back_at is not distinct from old.sent_back_at then
    new.sent_back_changes := null;
    new.sent_back_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_venue_bookings_clear_sent_back on venue_bookings;
create trigger trg_venue_bookings_clear_sent_back
  before update on venue_bookings
  for each row execute function public.clear_sent_back();

drop trigger if exists trg_equipment_reservations_clear_sent_back on equipment_reservations;
create trigger trg_equipment_reservations_clear_sent_back
  before update on equipment_reservations
  for each row execute function public.clear_sent_back();

-- 113-S5: the note so far, with new changes added; a field in both keeps its first "from" and takes the latest "to"
create or replace function public.merge_sent_back_changes(p_note jsonb, p_changes jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_note, '{}'::jsonb) || coalesce(
    (select jsonb_object_agg(
              k,
              case when p_note ? k then jsonb_build_object('from', p_note -> k -> 'from', 'to', p_changes -> k -> 'to')
                   else p_changes -> k end)
       from jsonb_object_keys(p_changes) k),
    '{}'::jsonb)
$$;

drop function if exists public.update_event_details(uuid, jsonb);

create or replace function public.update_event_details(p_event_id uuid, p_changes jsonb, p_send_back jsonb default null)
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
  v_bookings  uuid[];
  v_requests  uuid[];
  v_sent      int := 0;
  v_count     int;
begin
  select * into v_event from events where id = p_event_id for update;
  -- SCRUM-111/AC7: only the event's current assigned coordinator (an event that does not exist says nothing more)
  if not found
     or public.current_user_role() is distinct from 'event_coordinator'
     or v_event.assigned_coordinator_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  -- SCRUM-111/AC6: finished events are left as they are
  if public.is_closed_event_status(v_event.status) then
    raise exception using errcode = 'CS112', message = 'EVENT_LOCKED';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Nothing to change.';
  end if;
  if p_send_back is not null and jsonb_typeof(p_send_back) <> 'object' then
    raise exception using errcode = '22023', message = 'p_send_back must be an object.';
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

  -- SCRUM-111/AC4: what changed, who, when, and whether it included an important field
  insert into event_change_history (event_id, changed_by, changes, is_important)
  values (p_event_id, auth.uid(), p_changes,
          exists (select 1 from jsonb_object_keys(p_changes) k where k = any(v_important)));

  -- SCRUM-113: send back what the warning listed, only this event's active ones
  v_bookings := array(select jsonb_array_elements_text(coalesce(p_send_back -> 'venue_bookings', '[]'::jsonb))::uuid);
  v_requests := array(select jsonb_array_elements_text(coalesce(p_send_back -> 'equipment_requests', '[]'::jsonb))::uuid);

  -- AC1: back to Pending, which still holds the venue; the earlier decision is cleared
  update venue_bookings set
    status            = 'requested',
    reviewed_by       = null,
    reviewed_at       = null,
    review_notes      = null,
    sent_back_changes = public.merge_sent_back_changes(sent_back_changes, p_changes),
    sent_back_at      = now()
  where id = any(v_bookings)
    and event_id = p_event_id
    and status in ('requested', 'tentative', 'approved', 'confirmed');
  get diagnostics v_count = row_count;
  v_sent := v_sent + v_count;

  -- AC2: back to Submitted, its units released and its review cleared
  update equipment_reservations set
    status            = 'requested',
    quantity_reserved = null,
    reviewed_by       = null,
    reviewed_at       = null,
    review_reason     = null,
    sent_back_changes = public.merge_sent_back_changes(sent_back_changes, p_changes),
    sent_back_at      = now()
  where id = any(v_requests)
    and event_id = p_event_id
    and status in ('requested', 'under_review', 'approved', 'reserved');
  get diagnostics v_count = row_count;
  v_sent := v_sent + v_count;

  -- AC4: a Confirmed event is no longer fully arranged once something is sent back
  if v_sent > 0 and v_event.status = 'confirmed' then
    update events set status = 'planning' where id = p_event_id;
    insert into event_status_history (event_id, old_status, new_status, changed_by, reason)
    values (p_event_id, 'confirmed', 'planning', auth.uid(),
            'An important change sent arrangements back for review.');
  end if;

  return true;
end;
$$;

revoke execute on function public.update_event_details(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_event_details(uuid, jsonb, jsonb) to authenticated;

-- ask PostgREST to pick up the new columns and function straight away (harmless if it already has)
notify pgrst, 'reload schema';

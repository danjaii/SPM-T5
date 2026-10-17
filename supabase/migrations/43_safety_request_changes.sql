-- SCRUM-100: the Safety Officer requests changes at an event's Operational Safety Check (SCRUM-99,
-- docs/specs/operational-safety-check.md). Follows 37_safety_checks.sql (38 to 42 are SCRUM-105, SCRUM-113, SCRUM-20 and
-- SCRUM-67's).
--
-- 1. events_status_change_guard() (migration 14) let only the event's assigned coordinator change its status. A Safety
--    Officer may now make one change: awaiting_arrangements -> planning. Safety Officers have no update policy on
--    events, so they can only make it through record_safety_decision().
-- 2. record_safety_decision(): a change request also returns the event to Planning (AC3), recorded in
--    event_status_history in the same transaction.
-- 3. is_ready_for_safety_check(): an event whose latest decision is a change request is ready again once the
--    coordinator returns it to awaiting_arrangements with its arrangements complete, so it gets another check (AC6).
-- 4. event_safety_decisions() (new): every safety decision, with who, when and why, for the event's organiser and
--    assigned coordinator only (AC7, AC8).
-- 5. AC9: safety_checks.revoked_at, and the trg_events_revoke_safety_approval trigger: an important change to an approved
--    event stamps the approval revoked (kept for the record) and moves a confirmed event back to awaiting_arrangements.
--    latest_safety_decision() skips revoked decisions, so the gate refuses preparation and the event is ready for
--    another check. safety_check_details() also returns revoked_at.
--
-- Affects event-service (POST /safety-checks/:id/decision, GET /safety-checks, GET /safety-checks/:id,
-- GET /events/:id/safety-decisions, PATCH /events/:id). Adds a column and a trigger, changes five functions and adds
-- two; changes no existing data.

create or replace function public.events_status_change_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and old.assigned_coordinator_id is distinct from auth.uid()
     -- AC3: a Safety Officer's change request returns the event to Planning
     and not (old.status = 'awaiting_arrangements' and new.status = 'planning'
              and public.current_user_role() = 'safety_officer') then
    raise exception 'Only the coordinator assigned to this event can change its status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.record_safety_decision(p_event_id uuid, p_decision safety_decision, p_reason text default null)
returns table (id uuid, event_id uuid, decision safety_decision, reason text, decided_by uuid, officer_name text, decided_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_check safety_checks%rowtype;
begin
  if public.current_user_role() is distinct from 'safety_officer' then
    raise exception 'Only a Safety Officer can do this' using errcode = '42501';
  end if;
  -- lock the event so two Safety Officers deciding at once are taken one after the other: the second sees the first's
  -- decision and is refused
  perform 1 from events e where e.id = p_event_id for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if not public.is_ready_for_safety_check(p_event_id) then
    raise exception 'This event is not waiting for a safety check' using errcode = 'SC002';
  end if;

  insert into safety_checks (event_id, decided_by, decision, reason)
  values (p_event_id, auth.uid(), p_decision, nullif(btrim(p_reason), ''))
  returning * into v_check;

  -- AC3: a change request sends the event back to Planning, so the coordinator can make the changes
  if p_decision = 'changes_requested' then
    update events set status = 'planning' where events.id = p_event_id;
    insert into event_status_history (event_id, old_status, new_status, changed_by, reason)
    values (p_event_id, 'awaiting_arrangements', 'planning', auth.uid(), v_check.reason);
  end if;

  return query
    select v_check.id, v_check.event_id, v_check.decision, v_check.reason, v_check.decided_by, u.full_name, v_check.decided_at
    from users u where u.id = v_check.decided_by;
end;
$$;

-- As in migration 37, except that a change request no longer counts as decided: Request Changes moves the event to
-- Planning, so it is awaiting arrangements again only once the coordinator has returned it for review (AC6).
create or replace function public.is_ready_for_safety_check(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from events e where e.id = p_event_id and e.status = 'awaiting_arrangements')
    and exists (
      select 1 from venue_bookings b
      where b.event_id = p_event_id and b.status in ('approved', 'confirmed')
    )
    and not exists (
      select 1 from venue_bookings b
      where b.event_id = p_event_id and b.status not in ('approved', 'confirmed', 'rejected', 'cancelled', 'withdrawn')
    )
    and not exists (
      select 1 from equipment_reservations r
      where r.event_id = p_event_id and r.status not in ('approved', 'reserved', 'cancelled')
    )
    and (public.latest_safety_decision(p_event_id) is null
         or public.latest_safety_decision(p_event_id) = 'changes_requested');
$$;

-- AC7 + AC8: the Safety Officer's decisions for one event (changes requested, approved, rejected), newest first, for the event's organiser and its assigned
-- coordinator only. Security definer because safety_checks has no policies (migration 37), so it checks the caller itself.
create or replace function public.event_safety_decisions(p_event_id uuid)
returns table (decision safety_decision, reason text, officer_name text, decided_at timestamptz, revoked_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not exists (
    select 1 from events e
    where e.id = p_event_id and auth.uid() in (e.organiser_id, e.assigned_coordinator_id)
  ) then
    raise exception 'Only the event''s organiser and coordinator can see its requested changes' using errcode = '42501';
  end if;

  return query
    select c.decision, c.reason, u.full_name, c.decided_at, c.revoked_at -- revoked_at: AC9
    from safety_checks c join users u on u.id = c.decided_by
    where c.event_id = p_event_id
    order by c.decided_at desc, c.id desc;
end;
$$;

revoke execute on function public.event_safety_decisions(uuid) from public, anon;
grant execute on function public.event_safety_decisions(uuid) to authenticated;

-- AC9: an important change to the event (the fields in EVENT_IMPORTANT_FIELDS, packages/shared/src/eventDetails.ts) after
-- its Safety Approval means the approval no longer applies. The approval is kept for the record, stamped revoked_at, and
-- latest_safety_decision() no longer counts it, so the events_safety_gate refuses preparation until another check.
alter table safety_checks add column revoked_at timestamptz;

create or replace function public.latest_safety_decision(p_event_id uuid)
returns safety_decision
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select decision from safety_checks
  where event_id = p_event_id and revoked_at is null
  order by decided_at desc, id desc limit 1;
$$;

-- Security definer: whoever changes the event (the coordinator) has no access to safety_checks.
create or replace function public.revoke_safety_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update safety_checks set revoked_at = now()
  where event_id = new.id and decision = 'approved' and revoked_at is null;
  -- an event already in preparation leaves it until another check (SCRUM-113 may then move it on to Planning)
  if found and new.status = 'confirmed' then
    update events set status = 'awaiting_arrangements' where id = new.id;
    insert into event_status_history (event_id, old_status, new_status, changed_by, reason)
    values (new.id, 'confirmed', 'awaiting_arrangements', auth.uid(),
            'An important change was made after the Safety Approval, so another safety check is needed.');
  end if;
  return null;
end;
$$;

revoke execute on function public.revoke_safety_approval() from public, anon, authenticated;

drop trigger if exists trg_events_revoke_safety_approval on events;
create trigger trg_events_revoke_safety_approval
  after update of preferred_start_datetime, preferred_end_datetime, expected_attendance, preferred_room_layout_id,
                  accessibility_requirements, venue_requirements, equipment_requirements_notes
  on events
  for each row
  when (
    old.preferred_start_datetime is distinct from new.preferred_start_datetime
    or old.preferred_end_datetime is distinct from new.preferred_end_datetime
    or old.expected_attendance is distinct from new.expected_attendance
    or old.preferred_room_layout_id is distinct from new.preferred_room_layout_id
    or old.accessibility_requirements is distinct from new.accessibility_requirements
    or old.venue_requirements is distinct from new.venue_requirements
    or old.equipment_requirements_notes is distinct from new.equipment_requirements_notes
  )
  execute function public.revoke_safety_approval();

-- AC9: as in migration 37, except that each decision also says when it stopped applying (revoked_at, null while it
-- applies), so the review page offers a new decision once an approval no longer applies.
create or replace function public.safety_check_details(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is distinct from 'safety_officer' then
    raise exception 'Only a Safety Officer can do this' using errcode = '42501';
  end if;

  return (
  select jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'status', e.status,
    'preferred_start_datetime', e.preferred_start_datetime,
    'preferred_end_datetime', e.preferred_end_datetime,
    'expected_attendance', e.expected_attendance,
    'layout', l.name,
    'accessibility_requirements', e.accessibility_requirements,
    'venues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', v.name,
        'start', b.event_start_datetime,
        'end', b.event_end_datetime,
        'max_capacity', v.max_capacity,
        'layout_capacity', vl.max_capacity_for_layout,
        'emergency_access', v.emergency_access,
        'accessibility_notes', v.accessibility_notes,
        'restrictions', v.restrictions,
        'unavailability', coalesce((
          select jsonb_agg(jsonb_build_object('reason', u.reason, 'notes', u.notes, 'start', u.start_datetime, 'end', u.end_datetime)
                           order by u.start_datetime)
          from venue_unavailability u
          where u.venue_id = v.id and u.start_datetime < b.event_end_datetime and u.end_datetime > b.event_start_datetime
        ), '[]'::jsonb)
      ) order by b.event_start_datetime, v.name)
      from venue_bookings b
      join venues v on v.id = b.venue_id
      left join venue_supported_layouts vl on vl.venue_id = v.id and vl.room_layout_id = e.preferred_room_layout_id
      where b.event_id = e.id and b.status in ('approved', 'confirmed')
    ), '[]'::jsonb),
    'equipment', coalesce((
      select jsonb_agg(jsonb_build_object('name', q.name, 'quantity', r.quantity_requested, 'placement', r.notes) order by q.name)
      from equipment_reservations r join equipment q on q.id = r.equipment_id
      where r.event_id = e.id and r.status in ('approved', 'reserved')
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object('decision', c.decision, 'reason', c.reason, 'officer_name', u.full_name, 'decided_at', c.decided_at,
                                          'revoked_at', c.revoked_at)
                       order by c.decided_at desc)
      from safety_checks c join users u on u.id = c.decided_by
      where c.event_id = e.id
    ), '[]'::jsonb)
  )
  from events e
  left join room_layouts l on l.id = e.preferred_room_layout_id
  where e.id = p_event_id
  );
end;
$$;

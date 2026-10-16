-- SCRUM-99 (docs/specs/operational-safety-check.md): the Operational Safety Check. Before an event moves to preparation
-- (confirmed), a Safety Officer reviews it and approves, rejects or requests changes.
--
--   safety_checks                    one row per decision: who (decided_by), what (decision), when (decided_at) and why
--                                    (reason). A rejection or change request must give a reason (AC6, AC8).
--   events_safety_gate (trigger)     on any change of events.status to confirmed: refused with SC001 unless the event's
--                                    latest safety decision is approved (AC1, AC5, AC7). Unlike events_assignment_guard
--                                    (migration 23) it applies to every caller, the service role included: no one may skip
--                                    the safety check.
--
-- Custom SQLSTATEs (class SC) are mapped to messages by event-service (routes/safetyChecks.ts, routes/events.ts).
-- Affects event-service and venue-service (new venues columns).

-- AC4: must match SAFETY_DECISIONS in packages/shared/src/safetyCheck.ts
create type safety_decision as enum ('approved', 'rejected', 'changes_requested');

create table safety_checks (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  decided_by  uuid not null references users(id),
  decision    safety_decision not null,
  reason      text,
  decided_at  timestamptz not null default now(),
  -- AC6 (and the spec's Request Changes decision): only an approval may leave the reason out
  check (decision = 'approved' or nullif(btrim(reason), '') is not null)
);

create index idx_safety_checks_event on safety_checks(event_id, decided_at desc);

alter table safety_checks enable row level security;

-- The event's latest safety decision, or null if it has not been checked. Security definer so the gate sees every
-- decision whoever is changing the status.
create or replace function public.latest_safety_decision(p_event_id uuid)
returns safety_decision
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select decision from safety_checks where event_id = p_event_id order by decided_at desc, id desc limit 1;
$$;

-- the gate trigger runs as whoever changes the status, so signed-in users keep execute; signed-out visitors do not
revoke execute on function public.latest_safety_decision(uuid) from public, anon;
grant execute on function public.latest_safety_decision(uuid) to authenticated;

create or replace function public.events_safety_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed'
     and public.latest_safety_decision(new.id) is distinct from 'approved' then
    raise exception 'This event has not been Safety Approved' using errcode = 'SC001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_safety_gate on events;
create trigger trg_events_safety_gate
  before update of status on events
  for each row execute function public.events_safety_gate();

-- AC4 + AC8: the Safety Officer's decision, recorded with who made it (auth.uid(), so it can't be spoofed) and when.
-- Security definer: no one has INSERT on safety_checks, so this is the only way to record a decision.
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

  return query
    select v_check.id, v_check.event_id, v_check.decision, v_check.reason, v_check.decided_by, u.full_name, v_check.decided_at
    from users u where u.id = v_check.decided_by;
end;
$$;

revoke execute on function public.record_safety_decision(uuid, safety_decision, text) from public, anon;
grant execute on function public.record_safety_decision(uuid, safety_decision, text) to authenticated;

-- AC1 + AC2: an event is ready for its safety check once its venue and technical arrangements are complete: it is
-- awaiting arrangements, it has at least one active venue booking and every one is approved, every equipment request
-- still needed is arranged (approved or reserved, see EQUIPMENT_REQUEST_STATUSES in packages/shared), and no safety
-- decision has been recorded yet. Released equipment (cancelled) is no longer needed; Cannot Fulfil (rejected) is not
-- arranged.
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
    and public.latest_safety_decision(p_event_id) is null;
$$;

-- AC2: the events waiting for a safety check, soonest first, for Safety Officers only. Security definer because Safety
-- Officers have no read access to venue bookings or equipment requests; it checks the caller itself.
create or replace function public.safety_check_queue()
returns table (
  id uuid,
  name text,
  preferred_start_datetime timestamptz,
  preferred_end_datetime timestamptz,
  expected_attendance int,
  venue_names text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if public.current_user_role() is distinct from 'safety_officer' then
    raise exception 'Only a Safety Officer can do this' using errcode = '42501';
  end if;

  return query
    select e.id, e.name, e.preferred_start_datetime, e.preferred_end_datetime, e.expected_attendance,
           array(
             select v.name from venue_bookings b join venues v on v.id = b.venue_id
             where b.event_id = e.id and b.status in ('approved', 'confirmed')
             order by b.event_start_datetime, v.name
           )
    from events e
    where e.status = 'awaiting_arrangements' and public.is_ready_for_safety_check(e.id)
    order by e.preferred_start_datetime nulls last, e.name;
end;
$$;

-- only used inside this migration's functions
revoke execute on function public.is_ready_for_safety_check(uuid) from public, anon, authenticated;
revoke execute on function public.safety_check_queue() from public, anon;
grant execute on function public.safety_check_queue() to authenticated;

-- AC3: what the Safety Officer needs to know about a venue that nothing recorded before. Venue Staff editing them is a
-- later story; until then they are set in the database and the page shows "Not recorded" when empty.
alter table venues
  add column emergency_access text,
  add column restrictions     text;

-- AC3: the information needed for one event's safety check, as one JSON object, or null if there is no such event.
-- Security definer (Safety Officers can't read venue bookings or equipment requests), so it checks the caller itself:
--   the event's expected attendance, layout and accessibility requirements;
--   each venue it is booked into (approved): capacity, capacity in the event's layout, emergency access, accessibility
--     notes, restrictions, and any unavailability during the booking;
--   its equipment (arranged, with placement from the request's notes);
--   the safety decisions made so far, newest first.
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
      select jsonb_agg(jsonb_build_object('decision', c.decision, 'reason', c.reason, 'officer_name', u.full_name, 'decided_at', c.decided_at)
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

revoke execute on function public.safety_check_details(uuid) from public, anon;
grant execute on function public.safety_check_details(uuid) to authenticated;

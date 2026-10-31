-- SCRUM-171 (docs/specs/operational-safety-check.md): Reject returns an event to Planning, and an event starts its
-- Operational Safety Check by itself once its arrangements are confirmed. Follows 43_safety_request_changes.sql.
--
-- 1. record_safety_decision(): a rejection also returns the event to Planning, as a change request does (AC1).
-- 2. event_arrangements_complete() (new): the arrangements part of the readiness rule. 'replaced' now counts as closed.
-- 3. is_ready_for_safety_check(): a rejected event is ready again once the coordinator returns it (AC2).
-- 4. events_status_change_guard(): Venue Staff and Technical Support Staff may cause planning -> awaiting_arrangements.
-- 5. start_safety_check_when_arranged() (new) and its two triggers: the approval of the last open arrangement moves the event
--    to Awaiting Arrangements (AC3, AC4, AC5).
-- 6. Changes existing data: events already rejected and stuck in awaiting_arrangements move to Planning.
--
-- Affects event-service (POST /safety-checks/:id/decision, GET /safety-checks), venue-service (approving a venue booking) and
-- equipment-service (arranging an equipment request).

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

  -- AC1 + SCRUM-100/AC3: a rejection or change request sends the event back to Planning, so the coordinator can adjust it
  if p_decision in ('rejected', 'changes_requested') then
    update events set status = 'planning' where events.id = p_event_id;
    insert into event_status_history (event_id, old_status, new_status, changed_by, reason)
    values (p_event_id, 'awaiting_arrangements', 'planning', auth.uid(), v_check.reason);
  end if;

  return query
    select v_check.id, v_check.event_id, v_check.decision, v_check.reason, v_check.decided_by, u.full_name, v_check.decided_at
    from users u where u.id = v_check.decided_by;
end;
$$;

-- 2. The readiness rule's arrangements part (migrations 37, 43), on its own so that is_ready_for_safety_check() and the
-- trigger below share one definition: at least one active venue booking, every one approved, and every equipment request
-- still needed arranged. 'replaced' is closed too: migration 47 added it after this list was written, so a replaced
-- booking kept its event out of the queue for good.
create or replace function public.event_arrangements_complete(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
      select 1 from venue_bookings b
      where b.event_id = p_event_id and b.status in ('approved', 'confirmed')
    )
    and not exists (
      select 1 from venue_bookings b
      where b.event_id = p_event_id and b.status not in ('approved', 'confirmed', 'rejected', 'cancelled', 'withdrawn', 'replaced')
    )
    and not exists (
      select 1 from equipment_reservations r
      where r.event_id = p_event_id and r.status not in ('approved', 'reserved', 'cancelled')
    );
$$;

revoke execute on function public.event_arrangements_complete(uuid) from public, anon, authenticated;

-- 3. AC2: as in migration 43, except that only an approval still in force keeps an event out of the queue. A rejected event
-- is ready again, like a change-requested one, once it is back in awaiting_arrangements with its arrangements complete.
create or replace function public.is_ready_for_safety_check(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from events e where e.id = p_event_id and e.status = 'awaiting_arrangements')
    and public.event_arrangements_complete(p_event_id)
    and public.latest_safety_decision(p_event_id) is distinct from 'approved';
$$;

-- 4. events_status_change_guard() (migrations 14, 43): the approval that completes an event's arrangements comes from Venue
-- Staff or Technical Support Staff, not its coordinator, so they may cause this one change. They have no update policy on
-- events, so they can only make it through the trigger below.
create or replace function public.events_status_change_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and old.assigned_coordinator_id is distinct from auth.uid()
     -- SCRUM-100/AC3 + AC1: a Safety Officer's rejection or change request returns the event to Planning
     and not (old.status = 'awaiting_arrangements' and new.status = 'planning'
              and public.current_user_role() = 'safety_officer')
     -- AC3: the approval that completes the arrangements starts the safety check
     and not (old.status = 'planning' and new.status = 'awaiting_arrangements'
              and public.current_user_role() in ('venue_staff', 'technical_support_staff')) then
    raise exception 'Only the coordinator assigned to this event can change its status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 5. AC3 + AC4: the approval of an event's last open arrangement moves it from Planning to Awaiting Arrangements, which puts
-- it in the safety check queue. Only that approval does: an event returned to Planning by a Safety Officer stays there until
-- something changes (AC5). Security definer: Venue Staff and Technical Support Staff cannot update events.
create or replace function public.start_safety_check_when_arranged()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- lock the event so two last approvals at once are taken one after the other: the second sees the first's
  perform 1 from events e where e.id = new.event_id and e.status = 'planning' for update;
  if found and public.event_arrangements_complete(new.event_id) then
    update events set status = 'awaiting_arrangements' where id = new.event_id;
    insert into event_status_history (event_id, old_status, new_status, changed_by, reason)
    values (new.event_id, 'planning', 'awaiting_arrangements', auth.uid(),
            'All venue and technical arrangements are confirmed, so the safety check has started.');
  end if;
  return null;
end;
$$;

revoke execute on function public.start_safety_check_when_arranged() from public, anon, authenticated;

-- Triggers run in name order, and this one must follow venue_booking_take_over (migration 48), which sends equipment back to
-- Submitted when a replacement venue is approved.
drop trigger if exists venue_bookings_start_safety_check on venue_bookings;
create trigger venue_bookings_start_safety_check
  after update of status on venue_bookings
  for each row
  when (old.status not in ('approved', 'confirmed') and new.status in ('approved', 'confirmed'))
  execute function public.start_safety_check_when_arranged();

drop trigger if exists equipment_reservations_start_safety_check on equipment_reservations;
create trigger equipment_reservations_start_safety_check
  after update of status on equipment_reservations
  for each row
  when (old.status not in ('approved', 'reserved') and new.status in ('approved', 'reserved'))
  execute function public.start_safety_check_when_arranged();

-- 6. AC1 for events rejected before this migration: they are stuck in awaiting_arrangements, and step 3 would otherwise put
-- them straight back in the queue with nothing changed. Moves them as a rejection now does. changed_by stays null: no one
-- made this move.
with moved as (
  update events e set status = 'planning'
  where e.status = 'awaiting_arrangements' and public.latest_safety_decision(e.id) = 'rejected'
  returning e.id
)
insert into event_status_history (event_id, old_status, new_status, reason)
select id, 'awaiting_arrangements', 'planning', 'Returned to Planning because the Safety Officer rejected it.' from moved;

notify pgrst, 'reload schema';

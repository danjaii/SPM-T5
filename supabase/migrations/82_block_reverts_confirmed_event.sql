-- SCRUM-185/AC1 (docs/specs/venue-block-reverts-event.md): a venue block returns a Confirmed event to Planning.
-- Follows 76_organiser_home.sql on main; the pending migrations 77 to 81 are independent of this one (it re-creates
-- events_status_change_guard from 71, which no pending migration touches, and adds a trigger on the flags from 46).
-- Append-only: nothing earlier is edited.
--
--   venue_booking_flags_revert_event()   NEW AFTER INSERT trigger on venue_booking_flags (kind venue_unavailable): when the flagged
--                                        booking belongs to a CONFIRMED event, the event goes back to Planning, kept and not
--                                        cancelled: its status changes, its Safety Approval is revoked (as an important change does,
--                                        migration 43), a row goes into event_status_history (Confirmed to Planning, by the Venue
--                                        Staff member) and its assigned coordinator gets one 'event_returned_to_planning'
--                                        notification. It runs in the transaction of mark_venue_unavailable() (39, 46), so the block,
--                                        the flags, the status change and the notification all happen or none does. A second flag of
--                                        the same event finds it already in Planning and does nothing.
--   events_status_change_guard()         gains one exception: Venue Staff may cause Confirmed to Planning. Venue Staff have no update
--                                        policy on events, so this is only reachable through the trigger above.
--
-- Events in any other status are flagged exactly as before (46). Affects venue-service (marking a block) and event-service (the
-- event's status and history). No table changes.

create or replace function public.events_status_change_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and old.assigned_coordinator_id is distinct from auth.uid()
     -- SCRUM-100/AC3 + AC1 (migrations 43 and 66): a Safety Officer's rejection or change request returns the event to Planning
     and not (old.status = 'awaiting_arrangements' and new.status = 'planning'
              and public.current_user_role() = 'safety_officer')
     -- SCRUM-171/AC3 (migration 66): the approval that completes the arrangements starts the safety check
     and not (old.status = 'planning' and new.status = 'awaiting_arrangements'
              and public.current_user_role() in ('venue_staff', 'technical_support_staff'))
     -- SCRUM-54/AC3 (migration 71): an organiser submits their own draft
     and not (old.status = 'draft' and new.status = 'submitted' and old.organiser_id = auth.uid())
     -- SCRUM-185/AC1: a venue block returns a Confirmed event to Planning
     and not (old.status = 'confirmed' and new.status = 'planning'
              and public.current_user_role() = 'venue_staff') then
    raise exception 'Only the coordinator assigned to this event can change its status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.venue_booking_flags_revert_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id    uuid;
  v_status      event_status;
  v_name        text;
  v_coordinator uuid;
  v_venue       text;
  v_block_start timestamptz;
  v_block_end   timestamptz;
  v_reason      text;
  v_detail      text;
begin
  if new.kind <> 'venue_unavailable' then
    return null;
  end if;

  -- lock the event, so two blocks saved together change it one after the other
  select e.id, e.status, e.name, e.assigned_coordinator_id, v.name
    into v_event_id, v_status, v_name, v_coordinator, v_venue
    from public.venue_bookings b
    join public.events e on e.id = b.event_id
    join public.venues v on v.id = b.venue_id
   where b.id = new.booking_id
     for update of e;

  if v_status is distinct from 'confirmed' then
    return null;
  end if;

  select u.start_datetime, u.end_datetime,
         case u.reason::text
           when 'maintenance' then 'Maintenance'
           when 'equipment_failure' then 'Equipment failure'
           when 'renovation' then 'Renovation'
           when 'safety' then 'Safety concern'
           when 'internal_activity' then 'Internal activity'
           else 'Other'
         end
    into v_block_start, v_block_end, v_reason
    from public.venue_unavailability u
   where u.id = new.unavailability_id;

  v_detail := format('%s is unavailable from %s to %s (%s)',
                     v_venue, public.venue_short_sgt(v_block_start), public.venue_short_sgt(v_block_end), v_reason);

  update public.events set status = 'planning' where id = v_event_id;

  -- the approval was given for arrangements that no longer hold: another safety check is needed (as in migration 43)
  update public.safety_checks set revoked_at = now()
   where event_id = v_event_id and decision = 'approved' and revoked_at is null;

  insert into public.event_status_history (event_id, old_status, new_status, changed_by, reason)
  values (v_event_id, 'confirmed', 'planning', auth.uid(), v_detail || ', so the event was returned to Planning.');

  if v_coordinator is not null and v_coordinator is distinct from auth.uid() then
    insert into public.notifications (user_id, event_id, type, title, message)
    values (v_coordinator, v_event_id, 'event_returned_to_planning', 'Event returned to Planning',
            format('%s: %s, so the event has been returned to Planning. Arrange a replacement venue.', v_name, v_detail));
  end if;

  return null;
end;
$$;

revoke execute on function public.venue_booking_flags_revert_event() from public, anon, authenticated;

drop trigger if exists venue_booking_flags_revert_event on public.venue_booking_flags;
create trigger venue_booking_flags_revert_event
  after insert on public.venue_booking_flags
  for each row execute function public.venue_booking_flags_revert_event();

notify pgrst, 'reload schema';

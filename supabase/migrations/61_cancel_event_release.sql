-- SCRUM-174 (docs/specs/cancel-event.md), part 2 of 4: a cancelled event releases its arrangements.
-- Follows 60_cancel_event_reason.sql.
--
-- events_release_on_cancel() (trigger) runs in the same transaction as the status change (ADR 0002), the moment an event
-- becomes Cancelled, however it got there (change_event_status(), or a direct update under migration 14's column grant):
--   - every active venue booking (requested, tentative, approved, confirmed) is cancelled with who, when and
--     "The event was cancelled.", so the venue is free for other requests (AC3). Rejected, withdrawn, replaced and already
--     cancelled bookings are left as they are;
--   - every equipment request that is not rejected or cancelled is released (cancelled), with or without a venue booking, so
--     its units count as free again (AC4; 18-S8 counts only approved and reserved);
--   - every open on-site technician assignment (SCRUM-20) is cancelled the same way, and migration 41's trigger tells the
--     technician (AC4).
-- security definer, because the coordinator may not update venue bookings, equipment requests or assignments directly; the
-- status change itself was already checked by the events guards (migrations 14, 37, 60). auth.uid() is still the caller.
--
-- Affects venue-service and equipment-service, whose rows it updates. Adds a function and a trigger; changes no existing data.

create or replace function public.events_release_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason constant text := 'The event was cancelled.';
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;

  -- AC3: the venues are free for other requests
  update venue_bookings set
    status              = 'cancelled',
    cancelled_by        = auth.uid(),
    cancelled_at        = now(),
    cancellation_reason = v_reason
  where event_id = new.id and status in ('requested', 'tentative', 'approved', 'confirmed');

  -- AC4: the equipment units are free for other events
  update equipment_reservations set status = 'cancelled'
  where event_id = new.id and status not in ('rejected', 'cancelled');

  -- AC4: on-site technicians are released, and told (migration 41's notify_technical_assignment())
  update technical_staff_assignments set
    cancelled_at        = now(),
    cancelled_by        = auth.uid(),
    cancellation_reason = v_reason
  where event_id = new.id and cancelled_at is null;

  return new;
end;
$$;

drop trigger if exists trg_events_release_on_cancel on events;
create trigger trg_events_release_on_cancel
  after update of status on events
  for each row execute function public.events_release_on_cancel();

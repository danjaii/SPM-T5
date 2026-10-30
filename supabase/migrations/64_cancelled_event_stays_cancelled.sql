-- SCRUM-174 (docs/specs/cancel-event.md), part 5 of 5: a cancelled event stays cancelled.
-- Follows 63_notify_event_cancelled.sql.
--
-- events_closed_guard() (trigger) refuses, with CS174 ("EVENT_CLOSED"):
--   - any status change away from Cancelled (AC7), because its venues, equipment and technicians were released (migration
--     61) and its change requests closed (62), so re-opening it would leave an event with nothing behind it. Nobody in the
--     customer's answers asked to re-open a cancelled event;
--   - cancelling an event that is already Completed or Rejected (AC1), which is over and has nothing left to release.
-- Its details were already locked for every closed event (update_event_details(), CS112, migration 34). Like the safety
-- gate (migration 37) it applies to everyone, the service role included. Triggers on a table run in name order, so this one
-- (trg_events_closed_...) runs before trg_events_safety_gate and trg_events_status_change_guard, and a cancelled event is
-- refused for being cancelled rather than for lacking a safety approval.
--
-- Affects event-service (PATCH /events/:id/status answers CS174 with 409 EVENT_CLOSED). Adds a function and a trigger; changes
-- no existing data.

create or replace function public.events_closed_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and (old.status = 'cancelled' or (new.status = 'cancelled' and old.status in ('completed', 'rejected'))) then
    raise exception using errcode = 'CS174', message = 'EVENT_CLOSED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_closed_guard on events;
create trigger trg_events_closed_guard
  before update of status on events
  for each row execute function public.events_closed_guard();

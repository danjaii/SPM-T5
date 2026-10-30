-- SCRUM-174 (docs/specs/cancel-event.md), part 3 of 5: an event that ends closes its pending change requests.
-- Follows 61_cancel_event_release.sql.
--
-- The customer said in the Week 9 Q&A that "if an event is cancelled or completed, any open pending change request for
-- that event is rendered obsolete and should automatically become invalid/rejected or closed." change_request_status has no
-- "closed" value, so events_close_change_requests() (trigger) marks each pending request rejected, with when and a note
-- saying why (AC5). Approved and rejected requests are left as they are. Same transaction as the status change (ADR 0002);
-- security definer, because event_change_requests is closed to direct updates (migration 15; review_change_request(),
-- migration 42, is the only other writer).
--
-- Affects event-service (the change request routes read the result). Adds a function and a trigger; changes no existing data.

create or replace function public.events_close_change_requests()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('cancelled', 'completed') or old.status = new.status then
    return new;
  end if;

  update event_change_requests set
    status       = 'rejected',
    reviewed_at  = now(),
    review_notes = format('Closed automatically: the event was %s.', new.status)
  where event_id = new.id and status = 'pending';

  return new;
end;
$$;

drop trigger if exists trg_events_close_change_requests on events;
create trigger trg_events_close_change_requests
  after update of status on events
  for each row execute function public.events_close_change_requests();

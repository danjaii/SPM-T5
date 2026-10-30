-- SCRUM-174 (docs/specs/cancel-event.md), part 4 of 5: a cancellation is announced, with its reason.
-- Follows 62_close_change_requests.sql.
--
-- notify_event_decision() (migration 44, trigger on event_status_history) already tells the organiser of an approval or a
-- rejection. It now also announces a cancellation (AC6): one event_cancelled notification, with the event's name and the
-- reason, for the organiser and for every attendee whose registration is still active (waitlisted or registered, the rule
-- of receivesEventUpdates() in packages/shared). A withdrawn or cancelled registration gets nothing, and neither does the
-- coordinator who cancelled. The customer said in the Week 9 Q&A that reasons for cancellations "should be recorded and
-- communicated via notifications to relevant users." The rest of the function is unchanged.
--
-- Affects notification-service (the notification list). Replaces one function; changes no existing data.

create or replace function public.notify_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.new_status is not distinct from new.old_status then
    return new; -- SCRUM-47/AC10: the status did not change, so nothing happened to announce
  elsif new.new_status = 'approved' then
    insert into notifications (user_id, event_id, type, title, message)
    select e.organiser_id, e.id, 'event_approved', 'Your event request was approved', e.name
    from events e where e.id = new.event_id;
  elsif new.new_status = 'rejected' then
    insert into notifications (user_id, event_id, type, title, message)
    select e.organiser_id, e.id, 'event_rejected', 'Your event request was rejected',
           format('%s was rejected. Reason: %s', e.name, new.reason) -- SCRUM-47/AC11: the reason
    from events e where e.id = new.event_id;
  elsif new.new_status = 'cancelled' then
    -- SCRUM-174/AC6: the organiser and every active attendee, each once, with the reason
    insert into notifications (user_id, event_id, type, title, message)
    select recipient, e.id, 'event_cancelled', 'An event was cancelled',
           format('%s was cancelled. Reason: %s', e.name, new.reason)
    from events e
    cross join lateral (
      select e.organiser_id as recipient
      union
      select r.attendee_id from event_registrations r
      where r.event_id = e.id and r.status in ('waitlisted', 'registered')
    ) people
    where e.id = new.event_id;
  end if;
  return new;
end;
$$;

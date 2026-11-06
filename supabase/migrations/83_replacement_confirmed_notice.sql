-- SCRUM-185/AC3 (docs/specs/replacement-confirmed-notice.md): the organiser and the attendees are told once the replacement
-- arrangements of an event that a venue block returned to Planning are confirmed.
-- Follows 76_organiser_home.sql on main; the pending migrations 77 to 82 are independent of this one: it re-creates
-- start_safety_check_when_arranged() from 66, which none of them touches, and reads the status history row that 82 writes (it
-- needs no code from 82, only that row, so the two can merge in either order within the numbering rule).
-- Append-only: nothing earlier is edited.
--
--   start_safety_check_when_arranged()   (66) unchanged except for one thing: when the approval of the last open arrangement moves
--     the event from Planning to Awaiting Arrangements, and the MOST RECENT status history row that moved the event to Planning was
--     made by a Venue Staff member from Confirmed (which is how a venue block returns an event, 82), the event's organiser and
--     every attendee with an active registration (event_update_attendees(), 65) each get one 'arrangements_reconfirmed'
--     notification naming the event and its current venue(s). An event returned to Planning for any other reason, and an event
--     arranged again after a later return, get nothing. The notice is written in the same transaction as the move.
--
-- No table changes. Affects venue-service and equipment-service (the approvals that fire the trigger) and the notifications read
-- by notification-service.

create or replace function public.start_safety_check_when_arranged()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name      text;
  v_organiser uuid;
  v_venues    text;
begin
  -- lock the event so two last approvals at once are taken one after the other: the second sees the first's
  perform 1 from events e where e.id = new.event_id and e.status = 'planning' for update;
  if found and public.event_arrangements_complete(new.event_id) then
    update events set status = 'awaiting_arrangements' where id = new.event_id;
    insert into event_status_history (event_id, old_status, new_status, changed_by, reason)
    values (new.event_id, 'planning', 'awaiting_arrangements', auth.uid(),
            'All venue and technical arrangements are confirmed, so the safety check has started.');

    -- SCRUM-185/AC3: was this Planning stint caused by a venue block? Only the latest move to Planning counts, so each return
    -- to Planning is announced at most once
    if exists (
      select 1
        from (select h.old_status, h.changed_by
                from event_status_history h
               where h.event_id = new.event_id and h.new_status = 'planning'
               order by h.changed_at desc, h.id desc
               limit 1) last_return
        join users u on u.id = last_return.changed_by
       where last_return.old_status = 'confirmed' and u.role = 'venue_staff'
    ) then
      select e.name, e.organiser_id into v_name, v_organiser from events e where e.id = new.event_id;
      select string_agg(distinct v.name, ', ' order by v.name) into v_venues
        from venue_bookings b join venues v on v.id = b.venue_id
       where b.event_id = new.event_id and b.status in ('approved', 'confirmed');

      insert into notifications (user_id, event_id, type, title, message)
      select r.user_id, new.event_id, 'arrangements_reconfirmed', 'Arrangements confirmed',
             format('%s: replacement arrangements are confirmed. Venue: %s. The event will be confirmed once its safety check is done.',
                    v_name, coalesce(v_venues, 'to be announced'))
        from (select v_organiser as user_id
              union
              select a as user_id from public.event_update_attendees(new.event_id) a) r
       where r.user_id is not null and r.user_id is distinct from auth.uid();
    end if;
  end if;
  return null;
end;
$$;

revoke execute on function public.start_safety_check_when_arranged() from public, anon, authenticated;

notify pgrst, 'reload schema';

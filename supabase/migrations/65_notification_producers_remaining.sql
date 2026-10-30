-- SCRUM-172 (docs/specs/receive-notifications.md): the remaining changes people depend on now notify them.
-- Follows 44_notification_producers.sql and uses its pattern (ADR 0002): each notification is written by a trigger in the same
-- transaction as the change it announces, so a change that fails or rolls back leaves no notification behind.
--
-- 1. notify_event_status_change() (trigger on event_status_history): Leads hear of a submitted request (AC1); the organiser and
--    coordinator of a confirmed event (AC5); those two and the attendees of a cancelled one, with any reason (AC6).
-- 2. notify_important_event_change() (trigger on event_change_history): the organiser and coordinator, naming the fields (AC3).
-- 3. notify_registration_status_change() (trigger on event_registrations): the attendee (AC4).
-- 4. notify_venue_booking_change() (trigger on venue_bookings): the coordinator of a decision, with any reason (AC2); the organiser
--    and attendees of a replacement (AC8).
-- 5. notify_buffer_conflicts() (statement trigger on venue_booking_flags): the coordinator of each flagged booking (AC7).
-- event_update_attendees() leaves out withdrawn attendees (AC9). Nobody is told about their own action: AC3 says so, and the
-- team applied it to every criterion. Internal: no signed-in role may call any of these.
--
-- Affects event-service (submission, status, event details, registrations), venue-service (approve, reject, timing) and
-- notification-service (the list shows the new types). Adds functions and triggers; changes no existing data and no existing
-- function body.

-- ---------------------------------------------------------------------------
-- Which attendees hear about an event (AC6, AC8, AC9)
-- ---------------------------------------------------------------------------
-- The database's copy of receivesEventUpdates() in packages/shared/src/registration.ts, with its mapping: waitlisted is Pending,
-- registered is Confirmed, so a Withdrawn or Rejected (cancelled) attendee gets nothing more. A test keeps the two equal.
create or replace function public.event_update_attendees(p_event_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.attendee_id from event_registrations r
  where r.event_id = p_event_id and r.status in ('waitlisted', 'registered')
$$;

revoke execute on function public.event_update_attendees(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Event status changes (AC1, AC5, AC6)
-- ---------------------------------------------------------------------------
-- On event_status_history, as notify_event_decision() is (44): every path that moves an event writes a row there.

create or replace function public.notify_event_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.new_status is not distinct from new.old_status then
    return new; -- the status did not change, so nothing happened to announce
  end if;
  -- An assigned coordinator may insert history rows directly (14's policy): a row that is not the event's status announces nothing
  if not exists (select 1 from events e where e.id = new.event_id and e.status = new.new_status) then
    return new;
  end if;

  -- AC1: a request reaches the Leads' shared queue when its organiser submits or resubmits it
  if new.new_status = 'submitted' and (new.old_status is null or new.old_status in ('draft', 'returned')) then
    insert into notifications (user_id, event_id, type, title, message)
    select u.id, e.id, 'event_submitted', 'A new event request needs a coordinator', e.name
    from events e
    cross join users u
    where e.id = new.event_id
      and u.role = 'event_coordinator_lead'
      and u.is_active
      and u.id is distinct from new.changed_by;

  -- AC5: the event's organiser and coordinator
  elsif new.new_status = 'confirmed' then
    insert into notifications (user_id, event_id, type, title, message)
    select r.user_id, e.id, 'event_confirmed', 'An event was confirmed', e.name
    from events e
    cross join lateral (values (e.organiser_id), (e.assigned_coordinator_id)) r(user_id)
    where e.id = new.event_id and r.user_id is not null and r.user_id is distinct from new.changed_by;

  -- AC6: the same two and the attendees, with the reason when one was given (W9 r19). Fires on any move to Cancelled, whichever
  -- route makes it. union: one notice each, even for someone who is also registered for their own event.
  elsif new.new_status = 'cancelled' then
    insert into notifications (user_id, event_id, type, title, message)
    select r.user_id, e.id, 'event_cancelled', 'An event was cancelled',
           e.name || ' was cancelled.' || coalesce(' Reason: ' || new.reason, '')
    from events e
    cross join lateral (
      select e.organiser_id as user_id
      union select e.assigned_coordinator_id
      union select a from public.event_update_attendees(e.id) a
    ) r
    where e.id = new.event_id and r.user_id is not null and r.user_id is distinct from new.changed_by;
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_event_status_change() from public, anon, authenticated;

drop trigger if exists trg_notify_event_status_change on event_status_history;
create trigger trg_notify_event_status_change
  after insert on event_status_history
  for each row execute function public.notify_event_status_change();

-- ---------------------------------------------------------------------------
-- Important event changes (AC3)
-- ---------------------------------------------------------------------------
-- On event_change_history: update_event_details() (34, 40) writes it, for a coordinator's edit and for a change request they
-- approve (42) alike. The labels are EVENT_FIELD_LABELS in packages/shared/src/eventDetails.ts; a test keeps them equal.

create or replace function public.notify_important_event_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fields text;
begin
  select string_agg(f.label, ', ' order by f.position) into v_fields
  from (values
    (1, 'preferred_start_datetime', 'Start'),
    (2, 'preferred_end_datetime', 'End'),
    (3, 'expected_attendance', 'Expected attendance'),
    (4, 'preferred_room_layout_id', 'Room layout'),
    (5, 'accessibility_requirements', 'Accessibility needs'),
    (6, 'venue_requirements', 'Venue requirements'),
    (7, 'equipment_requirements_notes', 'Equipment requirements')
  ) f(position, field, label)
  where new.changes ? f.field;

  insert into notifications (user_id, event_id, type, title, message)
  select r.user_id, e.id, 'event_changed', 'Important event details changed', format('%s: %s changed.', e.name, v_fields)
  from events e
  cross join lateral (values (e.organiser_id), (e.assigned_coordinator_id)) r(user_id)
  where e.id = new.event_id and r.user_id is not null and r.user_id is distinct from new.changed_by;
  return new;
end;
$$;

revoke execute on function public.notify_important_event_change() from public, anon, authenticated;

drop trigger if exists trg_notify_important_event_change on event_change_history;
create trigger trg_notify_important_event_change
  after insert on event_change_history
  for each row when (new.is_important) execute function public.notify_important_event_change();

-- ---------------------------------------------------------------------------
-- Registration status changes (AC4, AC9)
-- ---------------------------------------------------------------------------
-- The attendee is told the new status in the words they see (registrationStatus() in packages/shared/src/registration.ts).
-- Not their own change: withdrawing is the attendee's own action. Not a registration already withdrawn (AC9).

create or replace function public.notify_registration_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'withdrawn' or new.attendee_id is not distinct from auth.uid() then
    return new;
  end if;

  insert into notifications (user_id, event_id, type, title, message)
  select new.attendee_id, e.id, 'registration_status_changed', 'Your registration changed',
         format('Your registration for %s is now %s.', e.name,
                case new.status
                  when 'waitlisted' then 'Pending'
                  when 'registered' then 'Confirmed'
                  when 'cancelled' then 'Rejected'
                  when 'withdrawn' then 'Withdrawn'
                end)
  from events e where e.id = new.event_id;
  return new;
end;
$$;

revoke execute on function public.notify_registration_status_change() from public, anon, authenticated;

drop trigger if exists trg_notify_registration_status_change on event_registrations;
create trigger trg_notify_registration_status_change
  after update of status on event_registrations
  for each row when (old.status is distinct from new.status) execute function public.notify_registration_status_change();

-- ---------------------------------------------------------------------------
-- Venue booking decisions and replacements (AC2, AC8)
-- ---------------------------------------------------------------------------
-- A decision is a Pending request becoming approved or rejected, by whichever route (venue-service's decide() updates the row
-- directly under 07's policies). events.assigned_coordinator_id, not requested_by, which goes stale when a Lead reassigns (46).

create or replace function public.notify_venue_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'requested' and new.status in ('approved', 'rejected') then
    insert into notifications (user_id, event_id, venue_booking_id, type, title, message)
    select e.assigned_coordinator_id, e.id, new.id, 'venue_booking_' || new.status,
           case new.status when 'approved' then 'A venue booking was approved' else 'A venue booking was rejected' end,
           format('%s: %s on %s was %s.', e.name, v.name, public.venue_short_sgt(new.event_start_datetime), new.status)
             || case when new.status = 'rejected' then coalesce(' Reason: ' || new.review_notes, '') else '' end
    from events e
    join venues v on v.id = new.venue_id
    where e.id = new.event_id
      and e.assigned_coordinator_id is not null
      and e.assigned_coordinator_id is distinct from auth.uid();

  -- AC8 (W9 r52): venue_booking_take_over() (48) replaced this booking, so its replacement was approved. The organiser and the
  -- attendees need to know where to go; the coordinator already knows through the approval above. Links to the event only:
  -- neither can read a venue booking.
  elsif new.status = 'replaced' then
    insert into notifications (user_id, event_id, type, title, message)
    select r.user_id, e.id, 'venue_replaced', 'The venue for an event changed',
           format('%s has moved from %s to %s.', e.name, v.name, nv.name)
    from events e
    join venues v on v.id = new.venue_id
    join venue_bookings nb on nb.id = new.replaced_by_booking_id
    join venues nv on nv.id = nb.venue_id
    cross join lateral (
      select e.organiser_id as user_id
      union select a from public.event_update_attendees(e.id) a
    ) r
    where e.id = new.event_id and r.user_id is distinct from auth.uid();
  end if;
  return null;
end;
$$;

revoke execute on function public.notify_venue_booking_change() from public, anon, authenticated;

drop trigger if exists trg_notify_venue_booking_change on venue_bookings;
create trigger trg_notify_venue_booking_change
  after update of status on venue_bookings
  for each row when (old.status is distinct from new.status) execute function public.notify_venue_booking_change();

-- ---------------------------------------------------------------------------
-- Buffer conflicts (AC7, W9 r47)
-- ---------------------------------------------------------------------------
-- refresh_buffer_flags() (36) inserts all a venue's new flags in one statement, one per pair and direction. A statement trigger
-- reads them together, so a booking clashing with two others is one notification. on conflict do nothing leaves flags that were
-- already open out of the transition table, so saving the same times again tells nobody. The message gives only the booking's
-- own venue and time: the other booking may belong to someone else's event (36). The venue_unavailable kind has its own notice (46).

create or replace function public.notify_buffer_conflicts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into notifications (user_id, event_id, venue_booking_id, type, title, message)
  select e.assigned_coordinator_id, e.id, b.id, 'venue_booking_flagged', 'Buffer conflict',
         format('%s: your booking for %s on %s now overlaps another booking, because the venue''s setup or turnaround time changed.',
                e.name, v.name, public.venue_short_sgt(b.event_start_datetime))
  from (select distinct f.booking_id from new_flags f where f.kind = 'buffer_conflict') flagged
  join venue_bookings b on b.id = flagged.booking_id
  join events e on e.id = b.event_id
  join venues v on v.id = b.venue_id
  where e.assigned_coordinator_id is not null;
  return null;
end;
$$;

revoke execute on function public.notify_buffer_conflicts() from public, anon, authenticated;

drop trigger if exists trg_notify_buffer_conflicts on venue_booking_flags;
create trigger trg_notify_buffer_conflicts
  after insert on venue_booking_flags
  referencing new table as new_flags
  for each statement execute function public.notify_buffer_conflicts();

notify pgrst, 'reload schema';

-- SCRUM-20 (docs/specs/technical-assignment-notifications.md): the event's coordinator assigns Technical Support Staff to
-- support it on-site, and the technician is told when assigned, when the assignment changes and when it is cancelled, and
-- acknowledges it. Follows 40_send_back_affected_arrangements.sql.
--
-- 1. technical_staff_assignments (migration 01, seeded, unused until now) gains the event and the one venue booking it is
--    for, when its details last changed, when it was acknowledged, and who cancelled it, when and why.
--    technical_support_request_id becomes optional; a seeded row still gets its event from its request (a trigger). The same
--    technician cannot be assigned twice to one venue booking while both are active.
-- 2. Only functions write it: assign_technical_staff(), change_technical_assignment() and cancel_technical_assignment() (the
--    event's current coordinator, an open event, a Technical Support Staff member, one of the event's approved venue
--    bookings, the end after the start). Readers: the event's coordinator, the technician, Technical Support Staff.
-- 3. notify_technical_assignment() (trigger): writes the technician's notification in the same transaction (ADR 0002):
--    technical_assignment_assigned, _changed (venue booking, start or end changed; not the note) or _cancelled (with the
--    reason). Each names the event, venue, date and time (Singapore time) and links the event and the assignment
--    (notifications.technical_staff_assignment_id). An assignment that has already ended is not announced (old seed rows).
-- 4. acknowledge_technical_assignment(p_notification_id): the recipient acknowledges an "assigned" or "changed" notification
--    about the assignment's current details; it marks the notification read and the assignment acknowledged. A change
--    clears the acknowledgement.
-- 5. event_has_technical_work() (migration 14) also counts assignments, so a technician can open the event they support.
--
-- Refusals: 42501 not the event's coordinator (or not the notification's recipient for P0002 below); CS112 a completed,
-- cancelled or rejected event; 22023 a bad staff member, venue booking, period, note, reason or notification type;
-- 23505 the same technician already on that venue booking; CS020 the assignment is cancelled; CS021 the notification is
-- out of date; P0002 no such notification of yours.
--
-- Affects equipment-service (assignment routes), notification-service (acknowledge, the notification list) and
-- event-service (events readable by technicians). Adds columns, functions and triggers; changes no existing data except
-- filling technical_staff_assignments.event_id from the support request.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

alter table technical_staff_assignments
  add column if not exists event_id            uuid references events(id) on delete cascade,
  add column if not exists venue_booking_id    uuid references venue_bookings(id) on delete set null,
  add column if not exists changed_at          timestamptz not null default now(),
  add column if not exists acknowledged_at     timestamptz,
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancelled_by        uuid references users(id),
  add column if not exists cancellation_reason text;

alter table technical_staff_assignments alter column technical_support_request_id drop not null;

update technical_staff_assignments a set event_id = r.event_id
from technical_support_requests r
where a.event_id is null and r.id = a.technical_support_request_id;

alter table technical_staff_assignments alter column event_id set not null;

create index if not exists idx_technical_staff_assignments_event on technical_staff_assignments(event_id);
create index if not exists idx_technical_staff_assignments_staff on technical_staff_assignments(staff_id);

-- 20-S3: one active assignment per technician per venue booking
create unique index if not exists technical_staff_assignments_one_active
  on technical_staff_assignments(staff_id, venue_booking_id)
  where cancelled_at is null and venue_booking_id is not null;

-- a row inserted with only its support request (the seed) takes the request's event
create or replace function public.technical_assignment_fill_event()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.event_id is null and new.technical_support_request_id is not null then
    select r.event_id into new.event_id from technical_support_requests r where r.id = new.technical_support_request_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_technical_assignment_fill_event on technical_staff_assignments;
create trigger trg_technical_assignment_fill_event
  before insert on technical_staff_assignments
  for each row execute function public.technical_assignment_fill_event();

alter table notifications
  add column if not exists technical_staff_assignment_id uuid references technical_staff_assignments(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. Who may read and write
-- ---------------------------------------------------------------------------

revoke insert, update, delete on technical_staff_assignments from authenticated, anon;

drop policy if exists technical_staff_assignments_authenticated_all on technical_staff_assignments;
drop policy if exists technical_staff_assignments_select on technical_staff_assignments;
create policy technical_staff_assignments_select on technical_staff_assignments
  for select to authenticated
  using (
    staff_id = auth.uid()
    or public.is_assigned_coordinator(event_id)
    or public.current_user_role() = 'technical_support_staff'
  );

-- 20-S1: a technician can open the event they are assigned to support (migration 14 let them read events with technical work)
create or replace function public.event_has_technical_work(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.technical_support_requests r where r.event_id = p_event_id)
      or exists (select 1 from public.equipment_reservations r where r.event_id = p_event_id)
      or exists (select 1 from public.technical_staff_assignments a where a.event_id = p_event_id)
$$;

-- The checks shared by assign and change: the venue booking is one of the event's approved ones, and the period is sound.
create or replace function public.technical_assignment_check_details(
  p_event_id uuid, p_venue_booking_id uuid, p_start timestamptz, p_end timestamptz, p_note text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from venue_bookings b
    where b.id = p_venue_booking_id and b.event_id = p_event_id and b.status in ('approved', 'confirmed')
  ) then
    raise exception using errcode = '22023', message = 'Choose one of the event''s approved venue bookings.';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception using errcode = '22023', message = 'The end must be after the start.';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'The note is too long.';
  end if;
end;
$$;

-- The event of an assignment, locked, if the caller is its current coordinator and it is still open.
create or replace function public.technical_assignment_event_for_coordinator(p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  select * into v_event from events where id = p_event_id for update;
  if not found
     or public.current_user_role() is distinct from 'event_coordinator'
     or v_event.assigned_coordinator_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  if public.is_closed_event_status(v_event.status) then
    raise exception using errcode = 'CS112', message = 'EVENT_LOCKED';
  end if;
  return v_event;
end;
$$;

-- AC1: assign a technician to one of the event's approved venue bookings
create or replace function public.assign_technical_staff(
  p_event_id uuid, p_staff_id uuid, p_venue_booking_id uuid, p_start timestamptz, p_end timestamptz, p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.technical_assignment_event_for_coordinator(p_event_id);
  if not exists (select 1 from users u where u.id = p_staff_id and u.role = 'technical_support_staff' and u.is_active) then
    raise exception using errcode = '22023', message = 'Choose a technical support staff member.';
  end if;
  perform public.technical_assignment_check_details(p_event_id, p_venue_booking_id, p_start, p_end, p_note);

  insert into technical_staff_assignments (event_id, venue_booking_id, staff_id, assigned_by, role_note, start_datetime, end_datetime)
  values (p_event_id, p_venue_booking_id, p_staff_id, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''), p_start, p_end)
  returning id into v_id;
  return v_id;
end;
$$;

-- AC2: a new venue booking or period clears the acknowledgement (the technician confirms the new details); the note alone does not
create or replace function public.change_technical_assignment(
  p_assignment_id uuid, p_venue_booking_id uuid, p_start timestamptz, p_end timestamptz, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a technical_staff_assignments;
  v_moved boolean;
begin
  select * into v_a from technical_staff_assignments where id = p_assignment_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  perform public.technical_assignment_event_for_coordinator(v_a.event_id);
  if v_a.cancelled_at is not null then
    raise exception using errcode = 'CS020', message = 'ASSIGNMENT_CANCELLED';
  end if;
  perform public.technical_assignment_check_details(v_a.event_id, p_venue_booking_id, p_start, p_end, p_note);

  v_moved := v_a.venue_booking_id is distinct from p_venue_booking_id
          or v_a.start_datetime is distinct from p_start
          or v_a.end_datetime is distinct from p_end;
  update technical_staff_assignments set
    venue_booking_id = p_venue_booking_id,
    start_datetime   = p_start,
    end_datetime     = p_end,
    role_note        = nullif(btrim(coalesce(p_note, '')), ''),
    changed_at       = case when v_moved then now() else changed_at end,
    acknowledged_at  = case when v_moved then null else acknowledged_at end
  where id = p_assignment_id;
end;
$$;

-- AC3: cancel with a reason, which the technician is told
create or replace function public.cancel_technical_assignment(p_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a technical_staff_assignments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_a from technical_staff_assignments where id = p_assignment_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  perform public.technical_assignment_event_for_coordinator(v_a.event_id);
  if v_a.cancelled_at is not null then
    raise exception using errcode = 'CS020', message = 'ASSIGNMENT_CANCELLED';
  end if;
  if v_reason is null or length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'Give a reason for cancelling.';
  end if;
  update technical_staff_assignments set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = v_reason
  where id = p_assignment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The notifications, written with the change (ADR 0002)
-- ---------------------------------------------------------------------------

-- "Pacific Rim Trade Forum at Marina Bayview Hall B, 21 Jan 2027 08:00 to 17:00 (Singapore time)."
create or replace function public.technical_assignment_summary(p_a technical_staff_assignments)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select format('%s at %s, %s to %s (Singapore time).',
    (select e.name from events e where e.id = p_a.event_id),
    coalesce((select v.name from venue_bookings b join venues v on v.id = b.venue_id where b.id = p_a.venue_booking_id),
             'a venue to be confirmed'),
    to_char(p_a.start_datetime at time zone 'Asia/Singapore', 'FMDD Mon YYYY HH24:MI'),
    case when (p_a.start_datetime at time zone 'Asia/Singapore')::date = (p_a.end_datetime at time zone 'Asia/Singapore')::date
         then to_char(p_a.end_datetime at time zone 'Asia/Singapore', 'HH24:MI')
         else to_char(p_a.end_datetime at time zone 'Asia/Singapore', 'FMDD Mon YYYY HH24:MI') end)
$$;

create or replace function public.notify_technical_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type    text;
  v_title   text;
  v_message text;
begin
  if tg_op = 'INSERT' then
    -- an assignment that has already ended needs no notice (old seed rows)
    if new.end_datetime is not null and new.end_datetime < now() then
      return new;
    end if;
    v_type := 'technical_assignment_assigned';
    v_title := 'You are assigned to support an event on-site';
    v_message := public.technical_assignment_summary(new);
  elsif old.cancelled_at is null and new.cancelled_at is not null then
    v_type := 'technical_assignment_cancelled';
    v_title := 'Your on-site assignment was cancelled';
    v_message := public.technical_assignment_summary(new) || ' Reason: ' || coalesce(new.cancellation_reason, 'none given') || '.';
  elsif old.venue_booking_id is distinct from new.venue_booking_id
     or old.start_datetime is distinct from new.start_datetime
     or old.end_datetime is distinct from new.end_datetime then
    v_type := 'technical_assignment_changed';
    v_title := 'Your on-site assignment changed';
    v_message := 'Now: ' || public.technical_assignment_summary(new);
  else
    return new; -- 20-S5: the note alone, or an acknowledgement
  end if;

  insert into notifications (user_id, event_id, technical_staff_assignment_id, type, title, message)
  values (new.staff_id, new.event_id, new.id, v_type, v_title, v_message);
  return new;
end;
$$;

drop trigger if exists trg_notify_technical_assignment on technical_staff_assignments;
create trigger trg_notify_technical_assignment
  after insert or update on technical_staff_assignments
  for each row execute function public.notify_technical_assignment();

-- ---------------------------------------------------------------------------
-- 4. Acknowledging (AC4, AC5)
-- ---------------------------------------------------------------------------

create or replace function public.acknowledge_technical_assignment(p_notification_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note notifications;
  v_a    technical_staff_assignments;
begin
  select * into v_note from notifications where id = p_notification_id and user_id = auth.uid();
  if not found then
    raise exception using errcode = 'P0002', message = 'Notification not found.';
  end if;
  if v_note.technical_staff_assignment_id is null
     or v_note.type not in ('technical_assignment_assigned', 'technical_assignment_changed') then
    raise exception using errcode = '22023', message = 'This notification cannot be acknowledged.';
  end if;
  select * into v_a from technical_staff_assignments where id = v_note.technical_staff_assignment_id for update;
  if v_a.cancelled_at is not null then
    raise exception using errcode = 'CS020', message = 'ASSIGNMENT_CANCELLED';
  end if;
  -- only the notification about the current details: one sent before a later change is out of date
  if v_note.created_at < v_a.changed_at then
    raise exception using errcode = 'CS021', message = 'OUT_OF_DATE';
  end if;

  update technical_staff_assignments set acknowledged_at = now() where id = v_a.id;
  update notifications set is_read = true where id = v_note.id;
  return now();
end;
$$;

revoke execute on function public.technical_assignment_fill_event() from public, anon;
revoke execute on function public.technical_assignment_check_details(uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.technical_assignment_event_for_coordinator(uuid) from public, anon, authenticated;
revoke execute on function public.technical_assignment_summary(technical_staff_assignments) from public, anon, authenticated;
revoke execute on function public.notify_technical_assignment() from public, anon;
revoke execute on function public.assign_technical_staff(uuid, uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.change_technical_assignment(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.cancel_technical_assignment(uuid, text) from public, anon;
revoke execute on function public.acknowledge_technical_assignment(uuid) from public, anon;
grant execute on function public.assign_technical_staff(uuid, uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.change_technical_assignment(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.cancel_technical_assignment(uuid, text) to authenticated;
grant execute on function public.acknowledge_technical_assignment(uuid) to authenticated;

notify pgrst, 'reload schema';

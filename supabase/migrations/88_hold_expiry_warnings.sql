-- ConnectSphere: the event's coordinator is warned before a tentative hold expires, and when it has (SCRUM-108, on SCRUM-97's migration 87)
-- Affects venue-service (set the warning time) and notification-service (runs the periodic check). Spec: docs/specs/SCRUM-97-108-tentative-hold-expiry.md.
--
-- The coordinator sets the warning time per hold, in whole minutes before the expiry; the default is 24 hours (a team assumption, Week 9 Q9).
-- notify_hold_expiries() is called every minute by notification-service. It writes each notification once: the hold carries a sent flag
-- for the warning and one for the expiry, and both are cleared when Venue Staff change the expiry, so the warning is recalculated (AC7).
--
-- SQLSTATEs (class HW): HW001 a warning time outside 1 minute to 30 days; HW002 not a pending hold.

alter table venue_bookings
  add column if not exists hold_warning_minutes int not null default 1440 check (hold_warning_minutes between 1 and 43200),
  add column if not exists hold_warning_sent_at timestamptz,
  add column if not exists hold_expired_notified_at timestamptz;

-- ============================================================================
-- SCRUM-108/AC7: A NEW EXPIRY STARTS THE NOTICES AGAIN
-- ============================================================================
create or replace function public.venue_bookings_reset_hold_notices()
returns trigger
language plpgsql
as $$
begin
  if new.hold_expires_at is distinct from old.hold_expires_at then
    new.hold_warning_sent_at := null;
    new.hold_expired_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists venue_bookings_reset_hold_notices on venue_bookings;
create trigger venue_bookings_reset_hold_notices
  before update of hold_expires_at on venue_bookings
  for each row execute function public.venue_bookings_reset_hold_notices();

-- ============================================================================
-- SCRUM-108/AC1: THE COORDINATOR SETS THE WARNING TIME FOR A HOLD
-- ============================================================================
-- security definer like set_hold_expiry(): the only way to write the column. The event's assigned coordinator only (AC6); anyone else,
-- or an unknown booking, gets the same "not found". Changing it re-arms the warning, so a new time takes effect straight away.
create or replace function public.set_hold_warning(p_booking_id uuid, p_minutes int)
returns venue_bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking venue_bookings;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select b.* into v_booking
    from venue_bookings b
    join events e on e.id = b.event_id
   where b.id = p_booking_id and e.assigned_coordinator_id = auth.uid()
     for update of b;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_booking.status::text <> 'requested' then
    raise exception 'Only a pending hold has a warning time' using errcode = 'HW002';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 43200 then
    raise exception 'A warning time from 1 minute to 30 days is required' using errcode = 'HW001';
  end if;

  update venue_bookings
     set hold_warning_minutes = p_minutes, hold_warning_sent_at = null
   where id = p_booking_id
  returning * into v_booking;
  return v_booking;
end;
$$;

revoke execute on function public.set_hold_warning(uuid, int) from public, anon;
grant execute on function public.set_hold_warning(uuid, int) to authenticated;

-- ============================================================================
-- SCRUM-108/AC2, AC3, AC5, AC6: THE PERIODIC CHECK
-- ============================================================================
-- Writes, for each PENDING hold with an expiry and an assigned coordinator: "expires in N" once the warning time is reached, and
-- "expired" once it has passed. Each is written once (the sent flags) and in the same transaction as the flag. A confirmed, rejected or
-- withdrawn request is no longer PENDING, so it gets nothing (AC5). Only the event's coordinator is told (AC6). A hold whose warning
-- was missed (the check was down) gets only the expiry notice. The time is a parameter so tests control it; the service passes its clock.
create or replace function public.notify_hold_expiries(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_written int := 0;
  r record;
  v_minutes int;
begin
  for r in
    select b.id, b.event_id, b.hold_expires_at, b.hold_warning_sent_at,
           e.assigned_coordinator_id as coordinator, e.name as event_name, v.name as venue_name
      from venue_bookings b
      join events e on e.id = b.event_id
      join venues v on v.id = b.venue_id
     where b.status::text = 'requested'
       and b.hold_expires_at is not null
       and e.assigned_coordinator_id is not null
       and (
         (b.hold_expired_notified_at is null and b.hold_expires_at <= p_now)
         or (b.hold_warning_sent_at is null and b.hold_expires_at > p_now
             and b.hold_expires_at - make_interval(mins => b.hold_warning_minutes) <= p_now)
       )
       for update of b skip locked
  loop
    if r.hold_expires_at <= p_now then
      insert into public.notifications (user_id, event_id, venue_booking_id, type, title, message)
      values (
        r.coordinator, r.event_id, r.id, 'hold_expired', 'Hold expired',
        format('%s: the hold on %s expired at %s (Singapore time). The venue is no longer reserved; submit a new venue request.',
               r.event_name, r.venue_name, public.venue_short_sgt(r.hold_expires_at))
      );
      update venue_bookings
         set hold_expired_notified_at = p_now, hold_warning_sent_at = coalesce(hold_warning_sent_at, p_now)
       where id = r.id;
    else
      v_minutes := ceil(extract(epoch from (r.hold_expires_at - p_now)) / 60)::int;
      insert into public.notifications (user_id, event_id, venue_booking_id, type, title, message)
      values (
        r.coordinator, r.event_id, r.id, 'hold_expiring', 'Hold expires soon',
        format('%s: the hold on %s expires in %s (at %s, Singapore time). Confirm it or arrange another venue.',
               r.event_name, r.venue_name,
               case when v_minutes >= 120 then (v_minutes / 60) || ' hours'
                    when v_minutes >= 60 then '1 hour'
                    when v_minutes = 1 then '1 minute'
                    else v_minutes || ' minutes' end,
               public.venue_short_sgt(r.hold_expires_at))
      );
      update venue_bookings set hold_warning_sent_at = p_now where id = r.id;
    end if;
    v_written := v_written + 1;
  end loop;
  return v_written;
end;
$$;

-- the service role only: it writes notifications for other people
revoke execute on function public.notify_hold_expiries(timestamptz) from public, anon, authenticated;
grant execute on function public.notify_hold_expiries(timestamptz) to service_role;

notify pgrst, 'reload schema';

-- ConnectSphere: tentative holds expire (SCRUM-97) and the coordinator is warned (SCRUM-108)
-- Follows 51_lead_queue_summary.sql on main; 52-59 are on open branches (drafts, attachments, calendar). Affects venue-service.
-- Spec: docs/specs/SCRUM-97-108-tentative-hold-expiry.md.
--
-- A hold is a PENDING (status 'requested') venue booking. Venue Staff set its expiry, per hold, with no default (Week 9 Q29, Q44, Q54).
-- Expired is derived from the time, so no status changes and no job flips rows. Rows with no expiry behave exactly as before.
-- Built up across the SCRUM-97 / SCRUM-108 acceptance criteria; not applied anywhere but local databases until the PR merges.
--
-- SQLSTATEs (class HE): HE001 expiry missing, not in the future or after the event starts; HE002 not a PENDING request;
-- HE003 the hold has already expired (a new request is needed, Q26).

alter table venue_bookings add column if not exists hold_expires_at timestamptz;

-- ============================================================================
-- SCRUM-97/AC1: VENUE STAFF SET OR UPDATE A HOLD'S EXPIRY
-- ============================================================================
-- security definer, like set_venue_timing() (36): the only way to write hold_expires_at, checked for every caller. It takes the
-- time from the database clock. Venue Staff only; a live PENDING request only; a future time that is not after the event starts.
create or replace function public.set_hold_expiry(p_booking_id uuid, p_expires_at timestamptz)
returns venue_bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking venue_bookings;
begin
  if auth.uid() is null or coalesce(public.current_user_role()::text, '') <> 'venue_staff' then
    raise exception 'Only Venue Staff can set a hold expiry' using errcode = '42501';
  end if;

  select * into v_booking from venue_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_booking.status::text <> 'requested' then
    raise exception 'Only a pending request is a hold with an expiry' using errcode = 'HE002';
  end if;
  -- SCRUM-97/AC7: a live hold can be extended or shortened; one that has already expired cannot (a new request is needed, Q26)
  if v_booking.hold_expires_at is not null and v_booking.hold_expires_at <= now() then
    raise exception 'This hold has expired. A new venue request is needed' using errcode = 'HE003';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > v_booking.event_start_datetime then
    raise exception 'An expiry date and time in the future, before the event starts, is required' using errcode = 'HE001';
  end if;

  update venue_bookings set hold_expires_at = p_expires_at where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

revoke execute on function public.set_hold_expiry(uuid, timestamptz) from public, anon;
grant execute on function public.set_hold_expiry(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- SCRUM-97/AC2, AC3, AC4, AC6 + the calendar: WHICH BOOKINGS HOLD A SLOT
-- ============================================================================
-- One function says whether a booking still holds its slot at a moment: confirmed and approved bookings always do; a PENDING
-- request (the hold) does until its expiry, and for ever when it has no expiry (D4: rows without an expiry behave exactly as before).
-- Every place that listed the holding statuses calls it, so the booking check, the availability search, the occupied periods, the
-- padded-overlap trigger and the venue calendar (migration 58) agree: an expired hold frees the slot and shows as Available.
create or replace function public.venue_booking_holds_slot(p_status text, p_hold_expires_at timestamptz, p_at timestamptz default now())
returns boolean
language sql
stable
as $$
  select case
    when p_status in ('tentative', 'approved', 'confirmed') then true
    when p_status = 'requested' then p_hold_expires_at is null or p_hold_expires_at > p_at
    else false
  end;
$$;

-- venue_slot_is_held: as in 27_venue_padded_occupancy.sql, with the holding statuses replaced by venue_booking_holds_slot() (1 places)
create or replace function public.venue_slot_is_held(
  p_venue_id uuid,
  p_start    timestamptz,
  p_end      timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.venue_bookings b
    where b.venue_id = p_venue_id
      and public.venue_booking_holds_slot(b.status::text, b.hold_expires_at, now())
      and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
          && public.venue_padded_period(p_venue_id, p_start, p_end)
  )
$$;

-- venue_slot_conflicts: as in 27_venue_padded_occupancy.sql, with the holding statuses replaced by venue_booking_holds_slot() (1 places)
create or replace function public.venue_slot_conflicts(
  p_venue_id uuid,
  p_start    timestamptz,
  p_end      timestamptz,
  p_exclude_booking_id uuid default null
)
returns table (
  event_start        timestamptz,
  event_end          timestamptz,
  occupied_start     timestamptz,
  occupied_end       timestamptz,
  status             text,
  venue_name         text,
  setup_minutes      int,
  turnaround_minutes int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_user_role()::text, '') not in ('event_coordinator', 'venue_staff') then
    raise exception 'Not allowed to see venue occupancy.' using errcode = '42501';
  end if;

  return query
  select b.event_start_datetime,
         b.event_end_datetime,
         lower(public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)),
         upper(public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)),
         b.status::text,
         v.name,
         v.setup_minutes,
         v.turnaround_minutes
  from public.venue_bookings b
  join public.venues v on v.id = b.venue_id
  where b.venue_id = p_venue_id
    and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
    and public.venue_booking_holds_slot(b.status::text, b.hold_expires_at, now())
    and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
        && public.venue_padded_period(p_venue_id, p_start, p_end)
  order by b.event_start_datetime, b.id;
end;
$$;

-- venue_occupied_periods: as in 27_venue_padded_occupancy.sql, with the holding statuses replaced by venue_booking_holds_slot() (1 places)
create or replace function public.venue_occupied_periods(
  p_venue_id uuid,
  p_from     timestamptz,
  p_to       timestamptz
)
returns table (
  event_start        timestamptz,
  event_end          timestamptz,
  occupied_start     timestamptz,
  occupied_end       timestamptz,
  status             text,
  venue_name         text,
  setup_minutes      int,
  turnaround_minutes int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_user_role()::text, '') not in ('event_coordinator', 'venue_staff') then
    raise exception 'Not allowed to see venue occupancy.' using errcode = '42501';
  end if;

  return query
  select b.event_start_datetime,
         b.event_end_datetime,
         lower(public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)),
         upper(public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)),
         b.status::text,
         v.name,
         v.setup_minutes,
         v.turnaround_minutes
  from public.venue_bookings b
  join public.venues v on v.id = b.venue_id
  where b.venue_id = p_venue_id
    and public.venue_booking_holds_slot(b.status::text, b.hold_expires_at, now())
    and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
        && tstzrange(p_from, p_to, '[)')
  order by b.event_start_datetime, b.id;
end;
$$;

-- available_venues: as in 39_venue_unavailability_marking.sql, with the holding statuses replaced by venue_booking_holds_slot() (1 places)
create or replace function public.available_venues(
  p_start timestamptz,
  p_end   timestamptz
)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.id
  from public.venues v
  where v.is_active
    and not exists (
      select 1 from public.venue_bookings b
      where b.venue_id = v.id
        and public.venue_booking_holds_slot(b.status::text, b.hold_expires_at, now())
        and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
            && public.venue_padded_period(v.id, p_start, p_end)
    )
    and not exists (
      select 1 from public.venue_unavailability u
      where u.venue_id = v.id
        and tstzrange(u.start_datetime, u.end_datetime, '[)') && public.venue_padded_period(v.id, p_start, p_end)
    )
$$;

-- venue_bookings_check_padded_overlap: as in 39_venue_unavailability_marking.sql, with the holding statuses replaced by venue_booking_holds_slot() (3 places)
create or replace function public.venue_bookings_check_padded_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.venue_booking_holds_slot(new.status::text, new.hold_expires_at, now()) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and public.venue_booking_holds_slot(old.status::text, old.hold_expires_at, now())
     and old.venue_id = new.venue_id
     and old.event_start_datetime = new.event_start_datetime
     and old.event_end_datetime = new.event_end_datetime then
    return new;
  end if;

  perform v.id from public.venues v where v.id = new.venue_id for no key update;

  if exists (
    select 1 from public.venue_bookings b
    where b.venue_id = new.venue_id
      and b.id <> new.id
      and public.venue_booking_holds_slot(b.status::text, b.hold_expires_at, now())
      and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
          && public.venue_padded_period(new.venue_id, new.event_start_datetime, new.event_end_datetime)
  ) then
    raise exception 'The venue is occupied for part of that period.' using errcode = '23P01';
  end if;

  -- SCRUM-105: the padded period against the unpadded block, half-open.
  if exists (
    select 1 from public.venue_unavailability u
    where u.venue_id = new.venue_id
      and tstzrange(u.start_datetime, u.end_datetime, '[)')
          && public.venue_padded_period(new.venue_id, new.event_start_datetime, new.event_end_datetime)
  ) then
    raise exception 'The venue is unavailable for part of that period.' using errcode = 'CS105';
  end if;

  return new;
end;
$$;

-- venue_calendar_entries: as in 58_venue_calendar.sql, with the holding statuses replaced by venue_booking_holds_slot() (1 places)
create or replace function public.venue_calendar_entries(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  entry              text,
  venue_id           uuid,
  status             text,
  starts_at          timestamptz,
  ends_at            timestamptz,
  occupied_start     timestamptz,
  occupied_end       timestamptz,
  setup_minutes      int,
  turnaround_minutes int,
  reason             text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_user_role()::text, '') not in ('event_coordinator', 'venue_staff', 'technical_support_staff') then
    raise exception 'Not allowed to see the venue calendar.' using errcode = '42501';
  end if;

  return query
  select 'booking'::text,
         b.venue_id,
         b.status::text,
         b.event_start_datetime,
         b.event_end_datetime,
         lower(public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)),
         upper(public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)),
         coalesce(v.setup_minutes, 0),
         coalesce(v.turnaround_minutes, 0),
         null::text
  from public.venue_bookings b
  join public.venues v on v.id = b.venue_id
  where v.is_active
    and public.venue_booking_holds_slot(b.status::text, b.hold_expires_at, now())
    and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
        && tstzrange(p_from, p_to, '[)')
  union all
  select 'block'::text,
         u.venue_id,
         null::text,
         u.start_datetime,
         u.end_datetime,
         null::timestamptz,
         null::timestamptz,
         null::int,
         null::int,
         u.reason::text
  from public.venue_unavailability u
  join public.venues v on v.id = u.venue_id
  where v.is_active
    and u.start_datetime < p_to
    and u.end_datetime > p_from
  order by 1, 4, 2;
end;
$$;

-- ============================================================================
-- SCRUM-97/AC5: AN EXPIRED HOLD CANNOT BE CONFIRMED
-- ============================================================================
-- A trigger, so even the secret key cannot approve a hold whose time has run out (CS097); the service maps it to HOLD_EXPIRED.
-- A booking that was approved before its expiry is not touched: it no longer counts as a hold (AC6).
create or replace function public.venue_bookings_refuse_expired_hold()
returns trigger
language plpgsql
as $$
begin
  if old.status::text = 'requested' and new.status::text in ('approved', 'confirmed', 'tentative')
     and old.hold_expires_at is not null and old.hold_expires_at <= now() then
    raise exception 'This hold has expired and the venue is no longer reserved. A new venue request is needed' using errcode = 'CS097';
  end if;
  return new;
end;
$$;

drop trigger if exists venue_bookings_refuse_expired_hold on venue_bookings;
create trigger venue_bookings_refuse_expired_hold
  before update of status on venue_bookings
  for each row execute function public.venue_bookings_refuse_expired_hold();

notify pgrst, 'reload schema';

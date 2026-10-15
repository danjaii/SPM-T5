-- Venue padded occupancy (SCRUM-103, docs/specs/venue-padded-occupancy.md).
-- Touches venue-service (conflict check, availability view) and the venue search. Append-only: 06, 07 and 18 are
-- not edited; the functions they created are redefined here with create or replace.
--
-- A booking occupies its venue from `setup_minutes` before it starts to `turnaround_minutes` after it ends, using the
-- venue's CURRENT times (migration 26, SCRUM-101). Two holding bookings conflict when their padded periods overlap,
-- half-open, so periods that only touch do not. A request holds in: requested, tentative, approved, confirmed (DR5).
-- venue_padded_period below is the single definition; everything else calls it.

-- ============================================================================
-- THE ONE DEFINITION OF A PADDED PERIOD
-- ============================================================================
-- Null for an unknown venue, which overlaps nothing. Only reports a venue's two public numbers.
create or replace function public.venue_padded_period(
  p_venue_id uuid,
  p_start    timestamptz,
  p_end      timestamptz
)
returns tstzrange
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tstzrange(
           p_start - make_interval(mins => v.setup_minutes),
           p_end   + make_interval(mins => v.turnaround_minutes),
           '[)')
  from public.venues v
  where v.id = p_venue_id
$$;

-- ============================================================================
-- THE PRE-CHECK AND THE SEARCH, NOW PADDED
-- ============================================================================
-- Yes/no: does a holding request occupy this venue over any part of the padded period? (replaces 07's unpadded body)
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
      and b.status in ('requested', 'tentative', 'approved', 'confirmed')
      and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
          && public.venue_padded_period(p_venue_id, p_start, p_end)
  )
$$;

-- Venues free for a period: no holding request whose padded period overlaps the padded search period, and no
-- maintenance block over the period itself (blocks are not padded). (replaces 18's unpadded body)
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
        and b.status in ('requested', 'tentative', 'approved', 'confirmed')
        and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
            && public.venue_padded_period(v.id, p_start, p_end)
    )
    and not exists (
      select 1 from public.venue_unavailability u
      where u.venue_id = v.id
        and u.start_datetime < p_end
        and u.end_datetime > p_start
    )
$$;

-- ============================================================================
-- WHAT OCCUPIES A VENUE
-- ============================================================================
-- The holding bookings whose padded period overlaps the padded request, earliest first, so a refusal can say which
-- period is occupied (103-S1). Returns periods, the status and the venue's name and times only: never the event, the
-- coordinator or the request (36-S5). Coordinators and venue staff only.
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
    and b.status in ('requested', 'tentative', 'approved', 'confirmed')
    and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
        && public.venue_padded_period(p_venue_id, p_start, p_end)
  order by b.event_start_datetime, b.id;
end;
$$;

-- The same rows for a window (a day's availability view, 103-S5): holding bookings whose padded period overlaps
-- [p_from, p_to). Same columns, same restrictions.
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
    and b.status in ('requested', 'tentative', 'approved', 'confirmed')
    and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
        && tstzrange(p_from, p_to, '[)')
  order by b.event_start_datetime, b.id;
end;
$$;

-- ============================================================================
-- THE ATOMIC GUARANTEE: A TRIGGER REPLACES THE EXCLUSION CONSTRAINT
-- ============================================================================
-- venue_bookings_no_overlap (06) compares the stored period, which cannot see the venue's times. A trigger can. It
-- locks the venue row (FOR NO KEY UPDATE) so two simultaneous requests for one venue are checked one after the other,
-- then refuses a padded overlap with SQLSTATE 23P01, the code venue-service already maps to SLOT_CONFLICT (36-S4).
-- security definer, so it also sees holds the caller's RLS hides (DR11). The message names nothing (36-S5).
-- It ignores the row being written (b.id <> new.id), so change_venue_booking() (30) can move a booking, and it does not look at
-- the event, so one event's own bookings at one venue clash too (28 allows several per event). An update that leaves the venue
-- and period unchanged (a decision, a withdrawal, a change of numbers) skips the check: its place is the same, so it still
-- works after the venue's padding is raised.
alter table venue_bookings drop constraint venue_bookings_no_overlap;

create or replace function public.venue_bookings_check_padded_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('requested', 'tentative', 'approved', 'confirmed') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status in ('requested', 'tentative', 'approved', 'confirmed')
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
      and b.status in ('requested', 'tentative', 'approved', 'confirmed')
      and public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
          && public.venue_padded_period(new.venue_id, new.event_start_datetime, new.event_end_datetime)
  ) then
    raise exception 'The venue is occupied for part of that period.' using errcode = '23P01';
  end if;

  return new;
end;
$$;

create trigger venue_bookings_padded_overlap
  before insert or update of status, venue_id, event_start_datetime, event_end_datetime
  on venue_bookings
  for each row execute function public.venue_bookings_check_padded_overlap();

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
-- Functions default to executable by PUBLIC (and so anon); only signed-in users need these. The trigger function is
-- called by the trigger, not by clients.
revoke execute on function public.venue_padded_period(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.venue_slot_is_held(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.available_venues(timestamptz, timestamptz) from public, anon;
revoke execute on function public.venue_slot_conflicts(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.venue_occupied_periods(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.venue_bookings_check_padded_overlap() from public, anon, authenticated;
grant execute on function public.venue_padded_period(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.venue_slot_is_held(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.available_venues(timestamptz, timestamptz) to authenticated;
grant execute on function public.venue_slot_conflicts(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.venue_occupied_periods(uuid, timestamptz, timestamptz) to authenticated;

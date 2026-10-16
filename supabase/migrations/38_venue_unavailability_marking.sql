-- Mark a venue temporarily unavailable (SCRUM-105, docs/specs/venue-unavailability.md).
-- Touches venue-service (marking, the booking checks, venue search) and the web venue pages. Append-only: nothing earlier is
-- edited; the functions below are redefined with create or replace from their latest bodies. Needs 37 (equipment_failure).
--
-- Function history, so the next story copies the right body:
--   venue_bookings_check_padded_overlap  27 (padded booking overlap)  ->  38 (adds the block rule, SQLSTATE CS105)
--   available_venues                     18 (unpadded)  ->  27 (padded bookings, unpadded blocks)  ->  38 (padded request vs block)
--
-- A block is compared as it is: [start, end), no setup or turnaround of its own. A BOOKING is compared with its padded period
-- (venue_padded_period, 27), so its setup and turnaround count against the block (105-S5). Half-open, so touching is allowed.

-- ============================================================================
-- ONLY A FUNCTION MAY WRITE; ONLY STAFF AND COORDINATORS MAY READ
-- ============================================================================
-- 02_rls.sql let every signed-in user do anything to every row. Venue Staff (who mark blocks) and Event Coordinators (who need
-- the periods to understand a refusal) may read; nobody writes directly. Organisers, attendees and technical support read nothing.
drop policy venue_unavailability_authenticated_all on venue_unavailability;

create policy venue_unavailability_select_staff_and_coordinators on venue_unavailability
  for select to authenticated
  using (public.current_user_role() in ('venue_staff', 'event_coordinator'));

revoke insert, update, delete on venue_unavailability from authenticated, anon;

-- ============================================================================
-- MARK A VENUE UNAVAILABLE (105-S1, S2, S3, S6)
-- ============================================================================
-- security definer: the only writer. The role check inside is the authority (current_user_role() comes from 07). The reason is
-- taken as text so a bad value is a clear 22023, not an enum cast error; internal_activity is in the enum for old rows but is
-- not selectable. Locks the venue row FOR NO KEY UPDATE, exactly as the padded-overlap trigger below does, so a new block and a
-- request for the same venue are checked one after the other. Returns the new block's id. Logged for DR13.
create or replace function public.mark_venue_unavailable(
  p_venue_id uuid,
  p_start    timestamptz,
  p_end      timestamptz,
  p_reason   text,
  p_notes    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_id    uuid;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can mark a venue unavailable.' using errcode = '42501';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'The end must be after the start.' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('maintenance', 'equipment_failure', 'renovation', 'safety', 'other') then
    raise exception 'Choose one of the listed reasons.' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'The notes must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if p_reason = 'other' and v_notes is null then
    raise exception 'Enter notes describing the reason.' using errcode = '22023';
  end if;

  perform v.id from public.venues v where v.id = p_venue_id for no key update;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0002';
  end if;

  insert into public.venue_unavailability (venue_id, start_datetime, end_datetime, reason, notes, created_by)
  values (p_venue_id, p_start, p_end, p_reason::public.venue_unavailability_reason, v_notes, auth.uid())
  returning id into v_id;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'venue_unavailability_marked', 'venue', p_venue_id,
          format('Unavailable %s to %s (%s)', p_start, p_end, p_reason));

  return v_id;
end;
$$;

-- ============================================================================
-- THE ATOMIC GUARANTEE, NOW ALSO AGAINST BLOCKS (105-S4, S5)
-- ============================================================================
-- Migration 27's body, unchanged, plus one rule: a padded booking period that overlaps a block is refused with SQLSTATE CS105
-- (which venue-service maps to VENUE_UNAVAILABLE). The skip rule is unchanged, so a request that keeps its venue and period (a
-- decision, a withdrawal, new numbers) is not re-checked: a PENDING request already inside a new block can still be approved
-- until SCRUM-106 flags it and SCRUM-104's guard refuses it. The message names nothing (36-S5).
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

-- ============================================================================
-- VENUE SEARCH (105-S5)
-- ============================================================================
-- 27's body, with the block compared against the venue's PADDED search period, so a search never offers a venue that a
-- request would refuse.
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
        and tstzrange(u.start_datetime, u.end_datetime, '[)') && public.venue_padded_period(v.id, p_start, p_end)
    )
$$;

-- ============================================================================
-- THE BLOCKS IN THE WAY OF A REQUEST (105-S4)
-- ============================================================================
-- For the friendly pre-check and for the message after a lost race: the blocks whose period overlaps the padded period of a
-- would-be booking, earliest first, with the venue's name. The period and the reason only: no notes and no
-- created_by. Coordinators and venue staff only. security definer code must never call this (it is role-gated on the caller).
create or replace function public.venue_unavailability_conflicts(
  p_venue_id uuid,
  p_start    timestamptz,
  p_end      timestamptz
)
returns table (
  start_datetime timestamptz,
  end_datetime   timestamptz,
  reason         text,
  venue_name     text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_user_role()::text, '') not in ('event_coordinator', 'venue_staff') then
    raise exception 'Not allowed to see venue unavailability.' using errcode = '42501';
  end if;

  return query
  select u.start_datetime, u.end_datetime, u.reason::text, v.name
  from public.venue_unavailability u
  join public.venues v on v.id = u.venue_id
  where u.venue_id = p_venue_id
    and tstzrange(u.start_datetime, u.end_datetime, '[)') && public.venue_padded_period(p_venue_id, p_start, p_end)
  order by u.start_datetime, u.id;
end;
$$;

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
revoke execute on function public.mark_venue_unavailable(uuid, timestamptz, timestamptz, text, text) from public, anon;
revoke execute on function public.venue_unavailability_conflicts(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.available_venues(timestamptz, timestamptz) from public, anon;
revoke execute on function public.venue_bookings_check_padded_overlap() from public, anon, authenticated;
grant execute on function public.mark_venue_unavailable(uuid, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.venue_unavailability_conflicts(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.available_venues(timestamptz, timestamptz) to authenticated;

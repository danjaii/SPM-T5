-- Venue booking flags: existing bookings that conflict under new setup/turnaround times (SCRUM-104,
-- docs/specs/venue-buffer-conflicts.md). Append-only: 26 and 27 are not edited.
-- Touches venue-service (the flags on every booking DTO, PUT /venues/:id/timing, the approve guard) and apps/web.
--
-- A flag is a row, never a status: a flagged booking keeps its status and its event is untouched (Jira note). One booking can
-- carry several flags, each names the other booking (or, for SCRUM-106, a maintenance block) and clears by itself.
--
-- Role matrix (RLS definition of done):
--   venue_booking_flags  SELECT  venue_staff: every flag. Assigned coordinator: flags on bookings of their events (through
--                                can_read_venue_booking). Organiser, technical support, attendee, lead, safety officer: none.
--                        INSERT / UPDATE / DELETE  nobody through the API. Only the definer functions below write.
--   refresh_buffer_flags()       internal: no signed-in role may call it; set_venue_timing() does, in its own transaction.
--   set_venue_timing()           venue_staff only (42501 otherwise), unchanged from 26; now returns the conflicting pairs.
--
-- Functions redefined here (history): set_venue_timing  26 (returns void) -> 36 (returns the affected pairs).
-- Postgres cannot change a return type with create or replace, so it is dropped and created again, grants repeated.
--
-- Definer code in this file never calls the role-gated venue_slot_conflicts / venue_occupied_periods (27): they answer a
-- signed-in coordinator or venue staff user only. It compares venue_padded_period (27) directly.

-- ============================================================================
-- TABLE
-- ============================================================================
create type venue_booking_flag_kind as enum ('buffer_conflict', 'venue_unavailable');

create table venue_booking_flags (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references venue_bookings(id) on delete cascade,
  kind             venue_booking_flag_kind not null,
  -- buffer_conflict: the other booking of the pair. venue_unavailable (SCRUM-106): the block, so exactly one is set.
  other_booking_id uuid references venue_bookings(id) on delete cascade,
  unavailability_id uuid references venue_unavailability(id) on delete cascade,
  -- a copy of the other period, so a coordinator can be shown it without reading a booking that is not theirs (36-S5).
  -- No event names are stored: the staff DTOs join a name at read time.
  other_start      timestamptz,
  other_end        timestamptz,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_reason  text,
  constraint venue_booking_flags_target check (
    (kind = 'buffer_conflict'  and other_booking_id is not null and unavailability_id is null)
    or
    (kind = 'venue_unavailable' and unavailability_id is not null and other_booking_id is null)
  ),
  constraint venue_booking_flags_not_self check (other_booking_id is null or other_booking_id <> booking_id),
  constraint venue_booking_flags_resolution check (
    (resolved_at is null) = (resolved_reason is null)
    and (resolved_reason is null or resolved_reason in ('no_longer_conflicts', 'booking_closed', 'replaced'))
  )
);

-- A refresh never raises the same flag twice.
create unique index venue_booking_flags_open_pair
  on venue_booking_flags (booking_id, other_booking_id)
  where resolved_at is null and other_booking_id is not null;
create unique index venue_booking_flags_open_unavailability
  on venue_booking_flags (booking_id, unavailability_id)
  where resolved_at is null and unavailability_id is not null;
-- "open flags of this booking" is the read path of every DTO and of the approve guard
create index venue_booking_flags_open_by_booking on venue_booking_flags (booking_id) where resolved_at is null;
create index venue_booking_flags_other on venue_booking_flags (other_booking_id) where other_booking_id is not null;

-- ============================================================================
-- WHO MAY READ
-- ============================================================================
-- Like 07's helpers: security definer, so the lookup is not itself filtered by RLS on venue_bookings/events, and
-- search_path is pinned. Reports a fact about the caller (auth.uid()) only.
create or replace function public.can_read_venue_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.venue_bookings b
    where b.id = p_booking_id
      and (public.current_user_role() = 'venue_staff' or public.is_assigned_coordinator(b.event_id))
  )
$$;

revoke execute on function public.can_read_venue_booking(uuid) from public, anon;
grant execute on function public.can_read_venue_booking(uuid) to authenticated;

alter table venue_booking_flags enable row level security;
revoke all on venue_booking_flags from anon, authenticated;
grant select on venue_booking_flags to authenticated;

create policy venue_booking_flags_select on venue_booking_flags
  for select to authenticated
  using (public.can_read_venue_booking(booking_id));
-- No insert/update/delete policy and no grant: nobody writes through the API.

-- ============================================================================
-- DETECTION: A RECONCILE
-- ============================================================================
-- The conflicting pairs of a venue: holding, still-future bookings whose PADDED periods overlap (half-open, so touching does
-- not conflict), each pair once with a < b. Past bookings are history and never flagged. Internal.
create or replace function public.venue_buffer_pairs(p_venue_id uuid)
returns table (a uuid, b uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select x.id, y.id
  from public.venue_bookings x
  join public.venue_bookings y on y.venue_id = x.venue_id and x.id < y.id
  where x.venue_id = p_venue_id
    and x.status in ('requested', 'tentative', 'approved', 'confirmed')
    and y.status in ('requested', 'tentative', 'approved', 'confirmed')
    and x.event_end_datetime > now()
    and y.event_end_datetime > now()
    and public.venue_padded_period(x.venue_id, x.event_start_datetime, x.event_end_datetime)
        && public.venue_padded_period(y.venue_id, y.event_start_datetime, y.event_end_datetime)
$$;

-- Flags every conflicting pair in both directions (each flag names the other booking); keeps the copied period of open flags
-- current; resolves open flags whose pair no longer conflicts ('no_longer_conflicts'). Saving 15/15 therefore clears what
-- 30/45 raised, and the same call with nothing to find flags nothing. Internal: called by set_venue_timing().
create or replace function public.refresh_buffer_flags(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- the same lock as 27's overlap trigger, so a request being inserted is either seen here or waits
  perform v.id from public.venues v where v.id = p_venue_id for no key update;

  insert into public.venue_booking_flags (booking_id, kind, other_booking_id, other_start, other_end)
  select p.a, 'buffer_conflict'::public.venue_booking_flag_kind, p.b, y.event_start_datetime, y.event_end_datetime
  from public.venue_buffer_pairs(p_venue_id) p join public.venue_bookings y on y.id = p.b
  union all
  select p.b, 'buffer_conflict'::public.venue_booking_flag_kind, p.a, x.event_start_datetime, x.event_end_datetime
  from public.venue_buffer_pairs(p_venue_id) p join public.venue_bookings x on x.id = p.a
  on conflict (booking_id, other_booking_id) where resolved_at is null and other_booking_id is not null do nothing;

  -- the other booking's period, kept current on flags that stay open
  update public.venue_booking_flags f
     set other_start = o.event_start_datetime, other_end = o.event_end_datetime
    from public.venue_bookings o
   where o.id = f.other_booking_id
     and f.kind = 'buffer_conflict'
     and f.resolved_at is null
     and (f.other_start, f.other_end) is distinct from (o.event_start_datetime, o.event_end_datetime)
     and exists (select 1 from public.venue_bookings m where m.id = f.booking_id and m.venue_id = p_venue_id);

  -- 104-S5: the conflict is gone
  update public.venue_booking_flags f
     set resolved_at = now(), resolved_reason = 'no_longer_conflicts'
   where f.kind = 'buffer_conflict'
     and f.resolved_at is null
     and exists (select 1 from public.venue_bookings m where m.id = f.booking_id and m.venue_id = p_venue_id)
     and not exists (
       select 1 from public.venue_buffer_pairs(p_venue_id) p
       where (p.a = f.booking_id and p.b = f.other_booking_id) or (p.b = f.booking_id and p.a = f.other_booking_id)
     );
end;
$$;

revoke execute on function public.venue_buffer_pairs(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_buffer_flags(uuid) from public, anon, authenticated;

-- The open pairs of a venue as Venue Staff are told about them: the earlier booking first, with the padded edges that
-- clash. Event names come from the snapshot taken at submission (DR8), falling back to the event. Internal.
create or replace function public.venue_open_buffer_pairs(p_venue_id uuid)
returns table (
  a_id uuid, a_name text, a_start timestamptz, a_end timestamptz, a_until timestamptz,
  b_id uuid, b_name text, b_start timestamptz, b_end timestamptz, b_from timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, coalesce(a.snapshot_event_name, ea.name), a.event_start_datetime, a.event_end_datetime,
         upper(public.venue_padded_period(a.venue_id, a.event_start_datetime, a.event_end_datetime)),
         b.id, coalesce(b.snapshot_event_name, eb.name), b.event_start_datetime, b.event_end_datetime,
         lower(public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime))
  from public.venue_booking_flags f
  join public.venue_bookings a on a.id = f.booking_id
  join public.venue_bookings b on b.id = f.other_booking_id
  join public.events ea on ea.id = a.event_id
  join public.events eb on eb.id = b.event_id
  where f.kind = 'buffer_conflict' and f.resolved_at is null and a.venue_id = p_venue_id
    -- each pair once, the earlier booking first
    and (a.event_start_datetime, a.id) < (b.event_start_datetime, b.id)
$$;

revoke execute on function public.venue_open_buffer_pairs(uuid) from public, anon, authenticated;

-- ============================================================================
-- set_venue_timing: NOW RETURNS THE AFFECTED PAIRS (replaces 26's returns void)
-- ============================================================================
drop function public.set_venue_timing(uuid, int, int);

create function public.set_venue_timing(
  p_venue_id   uuid,
  p_setup      int,
  p_turnaround int
)
returns table (
  booking_id           uuid,
  event_name           text,
  event_start          timestamptz,
  event_end            timestamptz,
  occupied_until       timestamptz,
  other_booking_id     uuid,
  other_event_name     text,
  other_event_start    timestamptz,
  other_event_end      timestamptz,
  other_occupied_from  timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_pairs int;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can change a venue''s setup and turnaround times.' using errcode = '42501';
  end if;

  -- Lock the venue's holding bookings BEFORE the venue row. change_venue_booking() (30) locks a booking first and the venue
  -- row second (through 27's trigger); taking the two in the same order here means the two never wait on each other in a
  -- circle, and the flags inserted below (which need a key-share lock on each booking) cannot be blocked by it.
  perform b.id from public.venue_bookings b
   where b.venue_id = p_venue_id and b.status in ('requested', 'tentative', 'approved', 'confirmed')
   order by b.id
     for no key update;

  update public.venues
     set setup_minutes = p_setup, turnaround_minutes = p_turnaround
   where id = p_venue_id;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0002';
  end if;

  -- same transaction as the update: the times and the flags that follow from them never disagree
  perform public.refresh_buffer_flags(p_venue_id);

  select count(*) into v_pairs from public.venue_open_buffer_pairs(p_venue_id);

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'venue_timing_set', 'venue', p_venue_id,
          format('Setup %s minutes, turnaround %s minutes', p_setup, p_turnaround)
          || case when v_pairs > 0 then format('; %s conflicting booking pair(s) flagged', v_pairs) else '' end);

  return query
  select t.a_id, t.a_name, t.a_start, t.a_end, t.a_until, t.b_id, t.b_name, t.b_start, t.b_end, t.b_from
  from public.venue_open_buffer_pairs(p_venue_id) t
  order by t.a_start, t.a_id, t.b_start, t.b_id;
end;
$$;

revoke execute on function public.set_venue_timing(uuid, int, int) from public, anon;
grant execute on function public.set_venue_timing(uuid, int, int) to authenticated;

-- ============================================================================
-- A BOOKING STOPS HOLDING OR MOVES: ITS FLAGS CLEAR (and nothing is ever inserted here)
-- ============================================================================
-- After an update of status or the period. Compares the status as text, so it works whether or not the enum already has
-- 'replaced' (SCRUM-107 adds it). Closed (rejected, withdrawn, cancelled) -> 'booking_closed'; replaced -> 'replaced'. A
-- booking that still holds but moved: its buffer flags clear when the two periods no longer overlap padded. A move cannot
-- raise a new flag, because 27's trigger refuses a change into a padded clash.
create or replace function public.venue_bookings_resolve_flags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status::text not in ('requested', 'tentative', 'approved', 'confirmed') then
    update public.venue_booking_flags f
       set resolved_at = now(),
           resolved_reason = case when new.status::text = 'replaced' then 'replaced' else 'booking_closed' end
     where f.resolved_at is null and (f.booking_id = new.id or f.other_booking_id = new.id);
    return null;
  end if;

  if old.venue_id = new.venue_id
     and old.event_start_datetime = new.event_start_datetime
     and old.event_end_datetime = new.event_end_datetime then
    return null;
  end if;

  update public.venue_booking_flags f
     set resolved_at = now(), resolved_reason = 'no_longer_conflicts'
   where f.kind = 'buffer_conflict'
     and f.resolved_at is null
     and (f.booking_id = new.id or f.other_booking_id = new.id)
     and not exists (
       select 1 from public.venue_bookings a, public.venue_bookings b
       where a.id = f.booking_id and b.id = f.other_booking_id and a.venue_id = b.venue_id
         and public.venue_padded_period(a.venue_id, a.event_start_datetime, a.event_end_datetime)
             && public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
     );
  return null;
end;
$$;

create trigger venue_bookings_resolve_flags
  after update of status, venue_id, event_start_datetime, event_end_datetime
  on venue_bookings
  for each row execute function public.venue_bookings_resolve_flags();

-- ============================================================================
-- 104-S4: A FLAGGED PENDING REQUEST CANNOT BE APPROVED (the database half; the service refuses first)
-- ============================================================================
-- Volatile on purpose (a plpgsql trigger reads the flags as they are now). Covers both flag kinds, so SCRUM-106 needs no
-- second guard. Rejecting is always allowed. SQLSTATE CS104 is mapped to BOOKING_FLAGGED by venue-service.
create or replace function public.venue_bookings_approve_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status::text = 'requested' and new.status::text = 'approved'
     and exists (select 1 from public.venue_booking_flags f where f.booking_id = new.id and f.resolved_at is null) then
    raise exception 'This request is flagged and cannot be approved.' using errcode = 'CS104';
  end if;
  return new;
end;
$$;

create trigger venue_bookings_approve_guard
  before update of status
  on venue_bookings
  for each row execute function public.venue_bookings_approve_guard();

revoke execute on function public.venue_bookings_resolve_flags() from public, anon, authenticated;
revoke execute on function public.venue_bookings_approve_guard() from public, anon, authenticated;

-- ask PostgREST to pick up the re-created function and the new table straight away (harmless if it already has)
notify pgrst, 'reload schema';

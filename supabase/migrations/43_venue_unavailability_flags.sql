-- Flag bookings affected by a venue block, and tell their coordinator (SCRUM-106, docs/specs/venue-unavailability-flags.md).
-- Follows 42_review_change_request.sql. Needs 35 (notifications.venue_booking_id), 36 (flags), 39 (mark_venue_unavailable).
-- Touches venue-service (the flag DTOs, POST /venues/:id/unavailability) and apps/web; writes notifications, which
-- notification-service reads (SCRUM-46).
--
-- A flag is a row, never a status: the booking row and the event row are not written at all (106-S1). The flag and the
-- notification are written in the SAME transaction as the block (ADR 0002), so a block can never exist without its flags, and
-- a coordinator is never left un-told: if the notification cannot be written, the block is rolled back.
--
-- Role matrix (RLS definition of done):
--   venue_booking_flags  unchanged from 36: venue_staff reads every flag, the assigned coordinator reads the flags on their own
--                        events' bookings, nobody writes through the API.
--   notifications        unchanged from 35: own rows only, no INSERT for signed-in users. This file's trigger is the producer.
--   refresh_venue_booking_flags(), the two triggers, venue_short_sgt()  internal: no signed-in role may call them.
--   mark_venue_unavailable()  venue_staff only (42501 otherwise), unchanged from 39; now returns (block_id, flagged_count).
--
-- Function history, so the next story copies the right body:
--   mark_venue_unavailable  39 (returns uuid)  ->  43 (returns the new block's id and how many bookings it flagged)
-- Postgres cannot change a return type with create or replace, so it is dropped and created again, grants repeated (as 36 did for
-- set_venue_timing).
--
-- Definer code in this file never calls the role-gated venue_unavailability_conflicts / venue_occupied_periods (27, 39): they
-- answer a signed-in coordinator or venue staff user only. It compares venue_padded_period (27) directly.

-- ============================================================================
-- SINGAPORE SHORT DATES, THE SAME WORDS AS formatShortSgt IN packages/shared
-- ============================================================================
-- "14 Nov 08:00" (day without a leading zero, English month abbreviation whatever the server locale, 24-hour clock). The
-- notification wording is built here, so a parity test runs this against the TypeScript.
create or replace function public.venue_short_sgt(p_instant timestamptz)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select to_char(p_instant at time zone 'Asia/Singapore', 'FMDD Mon HH24:MI')
$$;

revoke execute on function public.venue_short_sgt(timestamptz) from public, anon, authenticated;

-- ============================================================================
-- DETECTION: FLAG EVERY HOLDING, FUTURE BOOKING WHOSE PADDED PERIOD OVERLAPS A BLOCK (106-S1, S3, S4, S6)
-- ============================================================================
-- Holding = requested, tentative, approved, confirmed; future = the event has not ended. The padded period (setup and turnaround,
-- SCRUM-103) is compared with the block as it is, half-open, so a booking that only touches the block is not flagged. With a
-- block id it considers that block only (the new one); without, every block that has not ended. Nothing here resolves a flag:
-- 36's trigger on venue_bookings does that when a booking closes or moves. Idempotent: the open-flag unique index makes a
-- second run flag nothing twice (106-S7).
create or replace function public.refresh_venue_booking_flags(p_venue_id uuid, p_unavailability_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- the buffer-conflict half (36) keeps the same venue row lock as 27's overlap trigger and 39's mark_venue_unavailable
  perform public.refresh_buffer_flags(p_venue_id);

  insert into public.venue_booking_flags (booking_id, kind, unavailability_id, other_start, other_end)
  select b.id, 'venue_unavailable'::public.venue_booking_flag_kind, u.id, u.start_datetime, u.end_datetime
  from public.venue_unavailability u
  join public.venue_bookings b on b.venue_id = u.venue_id
  where u.venue_id = p_venue_id
    and (p_unavailability_id is null or u.id = p_unavailability_id)
    and u.end_datetime > now()
    and b.status in ('requested', 'tentative', 'approved', 'confirmed')
    and b.event_end_datetime > now()
    and tstzrange(u.start_datetime, u.end_datetime, '[)')
        && public.venue_padded_period(b.venue_id, b.event_start_datetime, b.event_end_datetime)
  on conflict (booking_id, unavailability_id) where resolved_at is null and unavailability_id is not null do nothing;
end;
$$;

revoke execute on function public.refresh_venue_booking_flags(uuid, uuid) from public, anon, authenticated;

-- A block was saved: flag what it affects, inside the same transaction as the insert, so no block exists without its flags.
create or replace function public.venue_unavailability_raise_flags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_venue_booking_flags(new.venue_id, new.id);
  return null;
end;
$$;

drop trigger if exists venue_unavailability_raise_flags on venue_unavailability;
create trigger venue_unavailability_raise_flags
  after insert on venue_unavailability
  for each row execute function public.venue_unavailability_raise_flags();

revoke execute on function public.venue_unavailability_raise_flags() from public, anon, authenticated;

-- ============================================================================
-- THE NOTIFICATION: ONE ROW, FOR THE EVENT'S ASSIGNED COORDINATOR (106-S2, S5)
-- ============================================================================
-- events.assigned_coordinator_id, not venue_bookings.requested_by: whoever submitted the request goes stale when a Lead
-- reassigns the event. No assigned coordinator means the flag stands and nobody is told. Nobody else is ever notified (not Venue
-- Staff, the organiser, attendees or other coordinators). The reason label is in the message because a coordinator needs it to
-- plan (the refusal in SCRUM-105 omits it). Example:
--   TechConf 2026: your booking for Orchid Hall on 14 Nov 09:00 to 17:00 is affected. Orchid Hall is unavailable from
--   14 Nov 08:00 to 16 Nov 18:00 (Maintenance). Request a replacement venue.
create or replace function public.venue_booking_flags_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coordinator uuid;
  v_event_id    uuid;
  v_event_name  text;
  v_venue       text;
  v_start       timestamptz;
  v_end         timestamptz;
  v_block_start timestamptz;
  v_block_end   timestamptz;
  v_reason      text;
  v_booked      text;
begin
  if new.kind <> 'venue_unavailable' then
    return null;
  end if;

  select e.assigned_coordinator_id, e.id, e.name, v.name, b.event_start_datetime, b.event_end_datetime
    into v_coordinator, v_event_id, v_event_name, v_venue, v_start, v_end
    from public.venue_bookings b
    join public.events e on e.id = b.event_id
    join public.venues v on v.id = b.venue_id
   where b.id = new.booking_id;

  if v_coordinator is null then
    return null;
  end if;

  select u.start_datetime, u.end_datetime,
         case u.reason::text
           when 'maintenance' then 'Maintenance'
           when 'equipment_failure' then 'Equipment failure'
           when 'renovation' then 'Renovation'
           when 'safety' then 'Safety concern'
           when 'internal_activity' then 'Internal activity'
           else 'Other'
         end
    into v_block_start, v_block_end, v_reason
    from public.venue_unavailability u
   where u.id = new.unavailability_id;

  -- a booking that spans a single Singapore day shows its end time only
  v_booked := public.venue_short_sgt(v_start) || ' to '
    || case when (v_start at time zone 'Asia/Singapore')::date = (v_end at time zone 'Asia/Singapore')::date
            then to_char(v_end at time zone 'Asia/Singapore', 'HH24:MI')
            else public.venue_short_sgt(v_end) end;

  insert into public.notifications (user_id, event_id, venue_booking_id, type, title, message)
  values (
    v_coordinator,
    v_event_id,
    new.booking_id,
    'venue_booking_flagged',
    'Venue unavailable – alternative needed',
    format('%s: your booking for %s on %s is affected. %s is unavailable from %s to %s (%s). Request a replacement venue.',
           v_event_name, v_venue, v_booked, v_venue,
           public.venue_short_sgt(v_block_start), public.venue_short_sgt(v_block_end), v_reason)
  );
  return null;
end;
$$;

drop trigger if exists venue_booking_flags_notify on venue_booking_flags;
create trigger venue_booking_flags_notify
  after insert on venue_booking_flags
  for each row execute function public.venue_booking_flags_notify();

revoke execute on function public.venue_booking_flags_notify() from public, anon, authenticated;

-- ============================================================================
-- mark_venue_unavailable: NOW ALSO RETURNS HOW MANY BOOKINGS IT FLAGGED (replaces 39's returns uuid)
-- ============================================================================
-- 39's body unchanged, except the return. The flags are written by the trigger on the insert, so the count is read after it.
drop function public.mark_venue_unavailable(uuid, timestamptz, timestamptz, text, text);

create function public.mark_venue_unavailable(
  p_venue_id uuid,
  p_start    timestamptz,
  p_end      timestamptz,
  p_reason   text,
  p_notes    text default null
)
returns table (block_id uuid, flagged_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_notes   text := nullif(btrim(coalesce(p_notes, '')), '');
  v_id      uuid;
  v_flagged int;
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

  -- the trigger on the insert has just flagged the affected bookings (and, through them, notified their coordinators)
  select count(*)::int into v_flagged
    from public.venue_booking_flags f
   where f.unavailability_id = v_id and f.resolved_at is null;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'venue_unavailability_marked', 'venue', p_venue_id,
          format('Unavailable %s to %s (%s)', p_start, p_end, p_reason)
          || case when v_flagged > 0 then format('; %s booking(s) flagged', v_flagged) else '' end);

  return query select v_id, v_flagged;
end;
$$;

revoke execute on function public.mark_venue_unavailable(uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.mark_venue_unavailable(uuid, timestamptz, timestamptz, text, text) to authenticated;

-- ask PostgREST to pick up the re-created function straight away (harmless if it already has)
notify pgrst, 'reload schema';

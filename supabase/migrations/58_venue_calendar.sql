-- Venue availability calendar (SCRUM-84, docs/specs/SCRUM-84-venue-availability-calendar.md).
-- Touches venue-service (GET /venue-calendar). Append-only: nothing earlier is edited.
--
-- One read for the whole calendar: the holding bookings and the blocks of every active venue that touch a window, so the
-- service does not call venue_occupied_periods (27) once per venue. That function, and the SELECT policy on
-- venue_unavailability (39), exclude Technical Support Staff, who may open the calendar, so this function is its own door.
--
-- Same rules as the rest, not new ones:
--   * a booking holds in: requested, tentative, approved, confirmed (DR5, as in 27); the service maps requested to
--     "Tentatively Held" and the rest to "Confirmed" (DR4);
--   * its occupied period is venue_padded_period (27): setup before, turnaround after, using the venue's CURRENT times;
--   * a block is its own period, with no padding (105).
-- Returns periods, the status, the minutes and the block's reason only. Never the event, the coordinator, the requester,
-- the block's notes or who made it (36-S5, 105-S6). When SCRUM-97 (hold expiry) changes what holds, copy its predicate here.

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
    and b.status in ('requested', 'tentative', 'approved', 'confirmed')
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

revoke execute on function public.venue_calendar_entries(timestamptz, timestamptz) from public, anon;
grant execute on function public.venue_calendar_entries(timestamptz, timestamptz) to authenticated;

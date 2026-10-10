-- SCRUM-65 (docs/specs/venue-search.md): which venues are free for a period?
--
-- A coordinator can only see their own events' bookings (07_venue_bookings_rls.sql and
-- 09_venue_bookings_hide_from_organiser.sql), so a search run as the coordinator cannot see that another
-- coordinator holds a venue. This function answers on their behalf, returning only venue ids (never who holds
-- what), the same trade-off venue_slot_is_held makes for one venue.
--
-- A venue is available when it is active and has no overlapping holding request (requested / tentative /
-- approved / confirmed) and no overlapping venue_unavailability block. Half-open [start, end): back-to-back
-- periods do not overlap, the same rule as venue_bookings_no_overlap. Operating hours are not considered.
-- Adds one function; changes no table. Only venue-service's search calls it.

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
        and b.event_start_datetime < p_end
        and b.event_end_datetime > p_start
    )
    and not exists (
      select 1 from public.venue_unavailability u
      where u.venue_id = v.id
        and u.start_datetime < p_end
        and u.end_datetime > p_start
    )
$$;

revoke execute on function public.available_venues(timestamptz, timestamptz) from public, anon;
grant execute on function public.available_venues(timestamptz, timestamptz) to authenticated;

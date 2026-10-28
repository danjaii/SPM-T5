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

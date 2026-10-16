-- Venue setup and turnaround times (SCRUM-101, docs/specs/venue-setup-turnaround.md).
-- Touches venue-service and (via GET /venues/:id) the web venue detail page. Append-only: nothing earlier is edited.
--
-- Every venue gets a setup time (before an event) and a turnaround time (after it), in whole minutes, default 0.
-- SCRUM-103 (migration 27) pads booking periods with them; this migration only stores them.

alter table venues
  add column setup_minutes      int not null default 0,
  add column turnaround_minutes int not null default 0,
  add constraint venues_setup_minutes_range      check (setup_minutes between 0 and 1440),
  add constraint venues_turnaround_minutes_range check (turnaround_minutes between 0 and 1440);

-- 02_rls.sql lets any signed-in user update any venue row, and the table grant covers every column, so a
-- coordinator could rewrite these two. As in 03_users_role_privilege.sql and 07_venue_bookings_rls.sql, narrow the
-- UPDATE grant to the columns that existed before, leaving the new ones writable only through set_venue_timing.
revoke update on venues from authenticated, anon;
grant update (
  name,
  address,
  description,
  max_capacity,
  operating_hours_start,
  operating_hours_end,
  is_accessible,
  accessibility_notes,
  is_active
) on venues to authenticated;

-- Venue Staff set a venue's times here. security definer, so it can write the columns the caller cannot, and
-- the role check inside is the authority (current_user_role() comes from migration 07). Logged for DR13.
create or replace function public.set_venue_timing(
  p_venue_id uuid,
  p_setup    int,
  p_turnaround int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can change a venue''s setup and turnaround times.' using errcode = '42501';
  end if;

  update public.venues
     set setup_minutes = p_setup, turnaround_minutes = p_turnaround
   where id = p_venue_id;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0002';
  end if;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'venue_timing_set', 'venue', p_venue_id,
          format('Setup %s minutes, turnaround %s minutes', p_setup, p_turnaround));
end;
$$;

revoke execute on function public.set_venue_timing(uuid, int, int) from public, anon;
grant execute on function public.set_venue_timing(uuid, int, int) to authenticated;

-- SCRUM-58 (docs/specs/venue-edit.md): Venue Staff edit an existing venue.
--
-- Like create_venue() (migration 63), one function changes the venue and replaces its layouts and facilities in a single
-- transaction. Venue Staff may write all three tables (migration 53), but a failure between two separate writes would leave a
-- venue with half its layouts, and nothing could repair it without another edit.

-- ============================================================================
-- EDIT A VENUE (58-S1, S2, S3)
-- ============================================================================
-- security definer: the role check inside is the authority (current_user_role() comes from 07). Takes the same values as
-- create_venue() and replaces the layouts and facilities with exactly the ones given. Setup and turnaround times
-- (set_venue_timing, SCRUM-101) and is_active are not written here. The venue row is locked first so two edits are applied one
-- after the other (the last one wins). An unknown venue is P0002; an unknown layout or facility is refused before anything is
-- written (CS571 / CS572). A layout listed twice hits the (venue_id, room_layout_id) unique constraint after the old layouts are
-- gone, and the whole edit is rolled back, old layouts included. Logged for DR13, with the capacity when it changed.
create or replace function public.update_venue(
  p_venue_id            uuid,
  p_name                text,
  p_address             text,
  p_description         text,
  p_max_capacity        int,
  p_hours_start         time,
  p_hours_end           time,
  p_is_accessible       boolean,
  p_accessibility_notes text,
  p_layouts             jsonb,
  p_facility_ids        uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_capacity int;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can edit a venue.' using errcode = '42501';
  end if;

  select max_capacity into v_old_capacity from public.venues where id = p_venue_id for update;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_layouts, '[]'::jsonb)) as l(layout_id uuid, max_capacity int)
     where not exists (select 1 from public.room_layouts r where r.id = l.layout_id)
  ) then
    raise exception 'One of the layouts is not in the catalogue.' using errcode = 'CS571';
  end if;

  if exists (
    select 1
      from unnest(coalesce(p_facility_ids, '{}'::uuid[])) as f(id)
     where not exists (select 1 from public.facilities x where x.id = f.id)
  ) then
    raise exception 'One of the facilities is not in the catalogue.' using errcode = 'CS572';
  end if;

  update public.venues
     set name = p_name,
         address = p_address,
         description = p_description,
         max_capacity = p_max_capacity,
         operating_hours_start = p_hours_start,
         operating_hours_end = p_hours_end,
         is_accessible = coalesce(p_is_accessible, false),
         accessibility_notes = p_accessibility_notes
   where id = p_venue_id;

  delete from public.venue_supported_layouts where venue_id = p_venue_id;
  insert into public.venue_supported_layouts (venue_id, room_layout_id, max_capacity_for_layout)
  select p_venue_id, l.layout_id, l.max_capacity
    from jsonb_to_recordset(coalesce(p_layouts, '[]'::jsonb)) as l(layout_id uuid, max_capacity int);

  delete from public.venue_facilities where venue_id = p_venue_id;
  insert into public.venue_facilities (venue_id, facility_id)
  select p_venue_id, f.id
    from (select distinct unnest(coalesce(p_facility_ids, '{}'::uuid[])) as id) as f;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (
    auth.uid(), 'venue_updated', 'venue', p_venue_id,
    case when v_old_capacity is distinct from p_max_capacity
         then format('Edited venue %s (capacity %s to %s)', p_name, v_old_capacity, p_max_capacity)
         else format('Edited venue %s', p_name) end
  );
end;
$$;

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
revoke execute on function public.update_venue(uuid, text, text, text, int, time, time, boolean, text, jsonb, uuid[]) from public, anon;
grant execute on function public.update_venue(uuid, text, text, text, int, time, time, boolean, text, jsonb, uuid[]) to authenticated;

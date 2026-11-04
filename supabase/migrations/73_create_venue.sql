-- SCRUM-57 (docs/specs/venue-add.md): Venue Staff add a venue to the catalogue.
--
-- A venue is three tables: venues, venue_supported_layouts and venue_facilities. Venue Staff may insert into all three
-- (migration 53) but nobody can delete a venue, so three separate inserts from the service could leave a half-made venue
-- behind with no way to clean it up. This function writes all three in one transaction.

-- ============================================================================
-- CREATE A VENUE (57-S1, S2, S3)
-- ============================================================================
-- security definer: the role check inside is the authority (current_user_role() comes from 07). p_layouts is a JSON array of
-- { layout_id, max_capacity }. A layout or facility that is not in the catalogue is refused before anything is written, with
-- CS571 / CS572 so the service can name the field. A layout listed twice hits the (venue_id, room_layout_id) unique
-- constraint after the venue row is in, and the whole save is rolled back. Setup and turnaround start at their column
-- defaults (0, SCRUM-101). Returns the new venue's id. Logged for DR13.
create or replace function public.create_venue(
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
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can add a venue.' using errcode = '42501';
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

  insert into public.venues (
    name, address, description, max_capacity, operating_hours_start, operating_hours_end, is_accessible, accessibility_notes
  )
  values (p_name, p_address, p_description, p_max_capacity, p_hours_start, p_hours_end, coalesce(p_is_accessible, false), p_accessibility_notes)
  returning id into v_id;

  insert into public.venue_supported_layouts (venue_id, room_layout_id, max_capacity_for_layout)
  select v_id, l.layout_id, l.max_capacity
    from jsonb_to_recordset(coalesce(p_layouts, '[]'::jsonb)) as l(layout_id uuid, max_capacity int);

  insert into public.venue_facilities (venue_id, facility_id)
  select v_id, f.id
    from (select distinct unnest(coalesce(p_facility_ids, '{}'::uuid[])) as id) as f;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'venue_created', 'venue', v_id, format('Added venue %s (capacity %s)', p_name, p_max_capacity));

  return v_id;
end;
$$;

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
revoke execute on function public.create_venue(text, text, text, int, time, time, boolean, text, jsonb, uuid[]) from public, anon;
grant execute on function public.create_venue(text, text, text, int, time, time, boolean, text, jsonb, uuid[]) to authenticated;

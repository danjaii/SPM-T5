-- SCRUM-181 (docs/specs/layout-type-maintenance.md): Venue Staff add, rename and delete room layout types.
--
-- Migration 53 already lets only Venue Staff write room_layouts. These three functions are what the app calls instead of
-- writing the table, for four reasons (see the spec): the delete check must see events Venue Staff cannot read, the check and
-- the delete must be one locked step, a refusal must carry the venues that use the type, and the name rules and the audit
-- row belong in one place. Migration 53's policies stay, so a direct write by anyone else is still refused.

-- ============================================================================
-- NAME RULES FOR A DIRECT WRITE (181-S5)
-- ============================================================================
-- room_layouts.name already has unique (name), which is case-sensitive, so "theatre" could sit beside "Theatre". The
-- suitability check finds a venue's layout by lower-cased name, so two spellings would be ambiguous. Hold a direct write to the
-- same rule the functions apply. These fail if the table already holds two names that differ only in case, or a blank name.
create unique index room_layouts_name_lower_key on public.room_layouts (lower(btrim(name)));
alter table public.room_layouts add constraint room_layouts_name_not_blank check (btrim(name) <> '');

-- ============================================================================
-- ADD A LAYOUT TYPE (181-S1, S5, S6)
-- ============================================================================
-- security definer: the role check inside is the authority (current_user_role() comes from 07). The name is trimmed and runs
-- of white space become one space. Empty or over 60 characters is 22023; a name another type already has, ignoring case, is
-- 23505. Returns { id, name }. Logged for DR13.
create or replace function public.create_layout_type(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_id   uuid;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can add a layout type.' using errcode = '42501';
  end if;

  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if v_name = '' then
    raise exception 'Enter a name for the layout type.' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'The name can be at most 60 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.room_layouts r where lower(btrim(r.name)) = lower(v_name)) then
    raise exception 'A layout type with that name already exists.' using errcode = '23505';
  end if;

  insert into public.room_layouts (name) values (v_name) returning id into v_id;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'layout_type_created', 'room_layout', v_id, format('Added layout type "%s"', v_name));

  return jsonb_build_object('id', v_id, 'name', v_name);
end;
$$;

-- ============================================================================
-- RENAME A LAYOUT TYPE (181-S2, S5, S6)
-- ============================================================================
-- Locks the row first, so two renames happen one after the other. An unknown id is P0002. A name another type has (not
-- counting this one, so a change of case is fine) is 23505. The same name again changes nothing and writes no audit row.
-- The id never changes, so every venue and event keeps its link and its capacity for the layout.
create or replace function public.rename_layout_type(p_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_old  text;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can rename a layout type.' using errcode = '42501';
  end if;

  select r.name into v_old from public.room_layouts r where r.id = p_id for update;
  if not found then
    raise exception 'Layout type not found.' using errcode = 'P0002';
  end if;

  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if v_name = '' then
    raise exception 'Enter a name for the layout type.' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'The name can be at most 60 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from public.room_layouts r where r.id <> p_id and lower(btrim(r.name)) = lower(v_name)) then
    raise exception 'A layout type with that name already exists.' using errcode = '23505';
  end if;

  if v_name <> v_old then
    update public.room_layouts set name = v_name where id = p_id;

    insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
    values (auth.uid(), 'layout_type_renamed', 'room_layout', p_id, format('Renamed layout type "%s" to "%s"', v_old, v_name));
  end if;

  return jsonb_build_object('id', p_id, 'name', v_name);
end;
$$;

-- ============================================================================
-- DELETE A LAYOUT TYPE (181-S3, S4, S6)
-- ============================================================================
-- Locks the row, then looks for what uses it: a venue that supports it (active or not) or an event request, a draft included,
-- that prefers it (SCRUM-155 AC7: no cascade). An unknown id is P0002. If anything uses it nothing changes and the answer
-- is { deleted: false, name, venues: [{ id, name }], event_count }; Venue Staff may not read those events, so only their
-- number is returned, never their names. Otherwise the row goes and the answer is { deleted: true, name }. A venue saved at the
-- same moment waits on the row lock, so it cannot slip a reference in between the check and the delete.
create or replace function public.delete_layout_type(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name        text;
  v_venues      jsonb;
  v_event_count int;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can delete a layout type.' using errcode = '42501';
  end if;

  select r.name into v_name from public.room_layouts r where r.id = p_id for update;
  if not found then
    raise exception 'Layout type not found.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name) order by v.name, v.id), '[]'::jsonb)
    into v_venues
    from public.venue_supported_layouts s
    join public.venues v on v.id = s.venue_id
   where s.room_layout_id = p_id;

  select count(*) into v_event_count from public.events e where e.preferred_room_layout_id = p_id;

  if jsonb_array_length(v_venues) > 0 or v_event_count > 0 then
    return jsonb_build_object('deleted', false, 'name', v_name, 'venues', v_venues, 'event_count', v_event_count);
  end if;

  delete from public.room_layouts where id = p_id;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'layout_type_deleted', 'room_layout', p_id, format('Deleted layout type "%s"', v_name));

  return jsonb_build_object('deleted', true, 'name', v_name);
end;
$$;

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
revoke execute on function public.create_layout_type(text) from public, anon;
revoke execute on function public.rename_layout_type(uuid, text) from public, anon;
revoke execute on function public.delete_layout_type(uuid) from public, anon;
grant execute on function public.create_layout_type(text) to authenticated;
grant execute on function public.rename_layout_type(uuid, text) to authenticated;
grant execute on function public.delete_layout_type(uuid) to authenticated;

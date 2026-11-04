-- SCRUM-182 (docs/specs/equipment-catalogue-maintenance.md): Technical Support Staff add and edit equipment, and change an item's
-- operational status.
--
-- Migration 53 already lets only Technical Support Staff insert and update `equipment` (and nobody delete). These two functions are
-- what the app calls instead of writing the table: they hold the field rules in one place, make a missing item a clear P0002 and
-- not a silent zero-row update, and write the audit row (what changed, including a status change) in the same transaction.
-- Migration 53's policies stay, so a direct write by anyone else is still refused.

-- ============================================================================
-- ADD AN ITEM (182-S1, S4, S5)
-- ============================================================================
-- security definer: the role check inside is the authority (current_user_role() comes from 07). Text is trimmed and runs of white
-- space become one space; a blank optional field is stored as null. A refused field is 22023 with the field's name in the hint,
-- so the service can put the message on the right field. A new item always starts 'available'. Returns { id }. Logged for DR13.
create or replace function public.create_equipment(
  p_name           text,
  p_type           text,
  p_description    text,
  p_total_quantity int,
  p_location       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name        text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_type        text := nullif(regexp_replace(btrim(coalesce(p_type, '')), '\s+', ' ', 'g'), '');
  v_description text := nullif(regexp_replace(btrim(coalesce(p_description, '')), '\s+', ' ', 'g'), '');
  v_location    text := nullif(regexp_replace(btrim(coalesce(p_location, '')), '\s+', ' ', 'g'), '');
  v_id          uuid;
begin
  if public.current_user_role() is distinct from 'technical_support_staff' then
    raise exception 'Only technical support staff can add equipment.' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'Enter the equipment''s name.' using errcode = '22023', hint = 'name';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'The name can be at most 120 characters.' using errcode = '22023', hint = 'name';
  end if;
  if char_length(v_type) > 60 then
    raise exception 'The type can be at most 60 characters.' using errcode = '22023', hint = 'type';
  end if;
  if char_length(v_description) > 500 then
    raise exception 'The description can be at most 500 characters.' using errcode = '22023', hint = 'description';
  end if;
  if char_length(v_location) > 120 then
    raise exception 'The location can be at most 120 characters.' using errcode = '22023', hint = 'location';
  end if;
  if p_total_quantity is null or p_total_quantity < 1 or p_total_quantity > 100000 then
    raise exception 'Quantity must be a whole number from 1 to 100000.' using errcode = '22023', hint = 'totalQuantity';
  end if;

  insert into public.equipment (name, type, description, total_quantity, location)
  values (v_name, v_type, v_description, p_total_quantity, v_location)
  returning id into v_id;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'equipment_created', 'equipment', v_id, format('Added equipment "%s" (%s units)', v_name, p_total_quantity));

  return jsonb_build_object('id', v_id);
end;
$$;

-- ============================================================================
-- EDIT AN ITEM, INCLUDING ITS STATUS (182-S2, S3, S4, S5)
-- ============================================================================
-- Same field rules, plus the operational status: one of the four values, else 22023 with hint 'operationalStatus'. An unknown id is
-- P0002. Locks the row first, so two edits happen one after the other. Only a real change is written and logged, with what
-- changed; equipment_free_units() (migration 32) already returns 0 for any item that is not 'available', so a status change takes
-- effect in every availability check at once. Reservations already made are not touched.
create or replace function public.update_equipment(
  p_id             uuid,
  p_name           text,
  p_type           text,
  p_description    text,
  p_total_quantity int,
  p_location       text,
  p_status         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name        text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_type        text := nullif(regexp_replace(btrim(coalesce(p_type, '')), '\s+', ' ', 'g'), '');
  v_description text := nullif(regexp_replace(btrim(coalesce(p_description, '')), '\s+', ' ', 'g'), '');
  v_location    text := nullif(regexp_replace(btrim(coalesce(p_location, '')), '\s+', ' ', 'g'), '');
  v_old         public.equipment%rowtype;
  v_status      public.equipment_operational_status;
  v_changes     text[] := '{}';
begin
  if public.current_user_role() is distinct from 'technical_support_staff' then
    raise exception 'Only technical support staff can edit equipment.' using errcode = '42501';
  end if;

  select * into v_old from public.equipment e where e.id = p_id for update;
  if not found then
    raise exception 'Equipment not found.' using errcode = 'P0002';
  end if;

  if v_name = '' then
    raise exception 'Enter the equipment''s name.' using errcode = '22023', hint = 'name';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'The name can be at most 120 characters.' using errcode = '22023', hint = 'name';
  end if;
  if char_length(v_type) > 60 then
    raise exception 'The type can be at most 60 characters.' using errcode = '22023', hint = 'type';
  end if;
  if char_length(v_description) > 500 then
    raise exception 'The description can be at most 500 characters.' using errcode = '22023', hint = 'description';
  end if;
  if char_length(v_location) > 120 then
    raise exception 'The location can be at most 120 characters.' using errcode = '22023', hint = 'location';
  end if;
  if p_total_quantity is null or p_total_quantity < 1 or p_total_quantity > 100000 then
    raise exception 'Quantity must be a whole number from 1 to 100000.' using errcode = '22023', hint = 'totalQuantity';
  end if;
  if p_status is null or p_status not in ('available', 'damaged', 'under_maintenance', 'retired') then
    raise exception 'Choose one of the listed statuses.' using errcode = '22023', hint = 'operationalStatus';
  end if;
  v_status := p_status::public.equipment_operational_status;

  if v_name is distinct from v_old.name then
    v_changes := v_changes || format('name "%s" to "%s"', v_old.name, v_name);
  end if;
  if v_type is distinct from v_old.type then
    v_changes := v_changes || format('type %s to %s', coalesce('"' || v_old.type || '"', 'none'), coalesce('"' || v_type || '"', 'none'));
  end if;
  if v_description is distinct from v_old.description then
    v_changes := v_changes || 'description'::text;
  end if;
  if p_total_quantity is distinct from v_old.total_quantity then
    v_changes := v_changes || format('quantity %s to %s', v_old.total_quantity, p_total_quantity);
  end if;
  if v_location is distinct from v_old.location then
    v_changes := v_changes || format('location %s to %s', coalesce('"' || v_old.location || '"', 'none'), coalesce('"' || v_location || '"', 'none'));
  end if;
  if v_status is distinct from v_old.operational_status then
    v_changes := v_changes || format('status %s to %s', v_old.operational_status, v_status);
  end if;

  if array_length(v_changes, 1) is not null then
    update public.equipment
       set name = v_name, type = v_type, description = v_description, total_quantity = p_total_quantity,
           location = v_location, operational_status = v_status
     where id = p_id;

    insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
    values (
      auth.uid(),
      case when v_status is distinct from v_old.operational_status then 'equipment_status_changed' else 'equipment_updated' end,
      'equipment',
      p_id,
      format('Changed equipment "%s": %s', v_old.name, array_to_string(v_changes, '; '))
    );
  end if;

  return jsonb_build_object('id', p_id);
end;
$$;

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
revoke execute on function public.create_equipment(text, text, text, int, text) from public, anon;
revoke execute on function public.update_equipment(uuid, text, text, text, int, text, text) from public, anon;
grant execute on function public.create_equipment(text, text, text, int, text) to authenticated;
grant execute on function public.update_equipment(uuid, text, text, text, int, text, text) to authenticated;

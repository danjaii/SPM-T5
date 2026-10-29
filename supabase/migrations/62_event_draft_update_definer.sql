-- ConnectSphere: re-save a draft through a security definer function (SCRUM-54/AC2)
-- Follows 61_resume_draft_event_request.sql (migration 61 is already applied and is not edited). Affects event-service only.
--
-- 14_events_rls.sql revokes UPDATE on events from authenticated and grants it only on (status, assigned_coordinator_id), on
-- purpose: writes to events go through security definer functions (update_event_details, change_event_status,
-- submit_event_draft), so that history and send-back logic cannot be bypassed. So the organiser UPDATE policy and the column
-- guard trigger from 61 could never be reached ("permission denied for table events"), and update_event_draft() as security
-- invoker failed for the organiser. Granting UPDATE on the draft columns is not an option: it would let an assigned coordinator
-- edit them directly too.
--
-- This migration:
--  1. drops the unreachable policy, trigger and trigger function from 61;
--  2. replaces update_event_draft() with a security definer version modelled on submit_event_draft(): only an event organiser,
--     only their own row (DR001 if not found), only while it is a draft (DR002), and only the 14 draft fields are written.
--     The organiser still has no UPDATE privilege on any column, so direct updates stay impossible; the function's column
--     list is the whitelist (the protection the guard trigger tried to give).
-- Custom SQLSTATEs as in 61: DR001 not the caller's draft or not found, DR002 not a draft any more.

drop policy if exists events_update_organiser_draft on events;
drop trigger if exists trg_events_organiser_draft_guard on events;
drop function if exists public.events_organiser_draft_guard();

-- the return type changes (setof events -> events), so the old function is dropped first
drop function if exists public.update_event_draft(
  uuid, text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
);

create function public.update_event_draft(
  p_event_id                     uuid,
  p_name                         text default null,
  p_purpose                      text default null,
  p_description                  text default null,
  p_preferred_start_datetime     timestamptz default null,
  p_preferred_end_datetime       timestamptz default null,
  p_expected_attendance          int default null,
  p_venue_requirements           text default null,
  p_preferred_room_layout_id     uuid default null,
  p_accessibility_requirements   text default null,
  p_equipment_requirements_notes text default null,
  p_registration_required        boolean default null,
  p_registration_capacity        int default null,
  p_registration_opens_at        timestamptz default null,
  p_registration_closes_at       timestamptz default null
)
returns events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'event_organiser' then
    raise exception 'Only an event organiser can save a draft' using errcode = '42501';
  end if;

  select * into v_event from events where id = p_event_id and organiser_id = auth.uid() for update;
  if not found then
    raise exception 'Draft not found' using errcode = 'DR001';
  end if;
  if v_event.status is distinct from 'draft' or v_event.is_draft is not true then
    raise exception 'This request has already been submitted' using errcode = 'DR002';
  end if;

  -- the whole form: a field passed as null is cleared, a blank name becomes 'Untitled draft' (as create_event_draft does).
  -- updated_at is refreshed by trg_events_updated_at. The table's check constraints still apply.
  update events set
    name = coalesce(nullif(btrim(p_name), ''), 'Untitled draft'),
    purpose = p_purpose,
    description = p_description,
    preferred_start_datetime = p_preferred_start_datetime,
    preferred_end_datetime = p_preferred_end_datetime,
    expected_attendance = p_expected_attendance,
    venue_requirements = p_venue_requirements,
    preferred_room_layout_id = p_preferred_room_layout_id,
    accessibility_requirements = p_accessibility_requirements,
    equipment_requirements_notes = p_equipment_requirements_notes,
    registration_required = coalesce(p_registration_required, false),
    registration_capacity = p_registration_capacity,
    registration_opens_at = p_registration_opens_at,
    registration_closes_at = p_registration_closes_at
  where id = p_event_id
  returning * into v_event;

  return v_event;
end;
$$;

revoke execute on function public.update_event_draft(
  uuid, text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
) from public, anon;
grant execute on function public.update_event_draft(
  uuid, text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
) to authenticated;

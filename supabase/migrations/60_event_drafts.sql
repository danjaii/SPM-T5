-- ConnectSphere: save an event request as a draft (SCRUM-53)
-- Follows 51_lead_queue_summary.sql. Affects event-service only.
--
-- 49_create_event_request.sql left a note: "Draft requests will need their own policy for status = 'draft'". That policy is
-- deliberately not added: events are written through security definer functions (14_events_rls.sql), so that nothing can
-- bypass them (SCRUM-91). This adds the function that stores a draft with every field optional, and nothing else.
--
-- AC1/AC2: create_event_draft() stores whatever the organiser has filled in. Only events.name is NOT NULL, so a missing or
-- blank name becomes 'Untitled draft'. The table's own check constraints still apply (attendance and capacity >= 0, end after
-- start, registration closing after opening); the service checks them first (packages/shared/src/eventDraft.ts).
-- AC3: the last-saved time is events.updated_at, which trg_events_updated_at keeps current; the function returns the row.
-- No event_status_history row: history starts when the request is submitted (create_event_request writes null -> submitted).
--
-- security definer, like submit_event_draft (53): it is the ONLY way to create a draft, because there is no organiser INSERT
-- policy for one. It therefore checks the caller itself (AC4): signed in, and an event organiser, else 42501. organiser_id
-- comes from auth.uid() and the client organisation from the caller's users row, and status, is_draft and the timestamps are
-- fixed here, so nothing in the request can spoof them or smuggle state in.
-- There is still no organiser UPDATE or DELETE policy on events: re-saving a draft is SCRUM-54.

create function create_event_draft(
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

  insert into events (
    name, purpose, description,
    preferred_start_datetime, preferred_end_datetime, expected_attendance,
    venue_requirements, preferred_room_layout_id,
    accessibility_requirements, equipment_requirements_notes,
    registration_required, registration_capacity, registration_opens_at, registration_closes_at,
    organiser_id, client_organisation_id,
    status, is_draft, submitted_at
  )
  values (
    coalesce(nullif(btrim(p_name), ''), 'Untitled draft'), p_purpose, p_description,
    p_preferred_start_datetime, p_preferred_end_datetime, p_expected_attendance,
    p_venue_requirements, p_preferred_room_layout_id,
    p_accessibility_requirements, p_equipment_requirements_notes,
    coalesce(p_registration_required, false), p_registration_capacity, p_registration_opens_at, p_registration_closes_at,
    auth.uid(), (select u.organisation_id from users u where u.id = auth.uid()),
    'draft', true, null
  )
  returning * into v_event;

  return v_event;
end;
$$;

revoke execute on function create_event_draft(
  text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
) from public, anon;
grant execute on function create_event_draft(
  text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
) to authenticated;

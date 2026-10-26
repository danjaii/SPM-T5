-- ConnectSphere: save an event request as a draft (SCRUM-53)
-- Follows 51_lead_queue_summary.sql. Affects event-service only.
--
-- 49_create_event_request.sql left a note: "Draft requests will need their own policy for status = 'draft'".
-- This adds it, and a function that stores a draft with every field optional.
--
-- AC1/AC2: create_event_draft() stores whatever the organiser has filled in. Only events.name is NOT NULL, so a missing or
-- blank name becomes 'Untitled draft'. The table's own check constraints still apply (attendance and capacity >= 0, end after
-- start, registration closing after opening); the service checks them first (packages/shared/src/eventDraft.ts).
-- AC3: the last-saved time is events.updated_at, which trg_events_updated_at keeps current; the function returns the row.
-- No event_status_history row: history starts when the request is submitted (create_event_request writes null -> submitted).
--
-- security invoker, like create_event_request: runs as the caller, so RLS applies. organiser_id comes from auth.uid() and the
-- client organisation from the caller's users row, so neither can be spoofed by the request body.
--
-- AC4: the policy only lets an event_organiser insert a draft that is theirs. It refuses any other status, a non-draft flag,
-- a submitted_at, an assigned coordinator, or a confirmed/cancelled/completed time, so a draft insert cannot smuggle state.
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
security invoker
as $$
declare
  v_event events;
begin
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

grant execute on function create_event_draft(
  text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
) to authenticated;

-- Adds to events_insert_organiser (49, status = 'submitted'); permissive policies are OR-ed.
drop policy if exists events_insert_organiser_draft on events;
create policy events_insert_organiser_draft on events
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_organiser'
    and organiser_id = auth.uid()
    and status = 'draft'
    and is_draft = true
    and submitted_at is null
    and assigned_coordinator_id is null
    and confirmed_at is null
    and cancelled_at is null
    and completed_at is null
  );

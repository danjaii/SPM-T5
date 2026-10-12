-- ConnectSphere: create and submit a new event request, all-or-nothing (SCRUM-49)
-- Follows 04_change_event_status.sql on main.
-- Numbered 08 because the unmerged event-review-and-approval branch already uses 04-07;
-- that clash with main's own 04 needs resolving when that branch merges.
--
-- AC1: the request's fields need somewhere to live. Venue requirements had no column.
alter table events add column venue_requirements text;

-- AC4 + AC7: create the event as submitted and record it in event_status_history together, so a
-- failure can't leave an event with no history. Same approach as change_event_status().
--
-- security invoker: runs as the calling user, so RLS applies as if they had made the writes
-- themselves. organiser_id and changed_by come from auth.uid() (the verified JWT), and the client
-- organisation from the caller's own users row, so none of them can be spoofed by the request body.
--
-- Field validation (AC5) is not done here yet; the table's own check constraints still apply.

create function create_event_request(
  p_name                         text,
  p_purpose                      text,
  p_description                  text,
  p_preferred_start_datetime     timestamptz,
  p_preferred_end_datetime       timestamptz,
  p_expected_attendance          int,
  p_venue_requirements           text,
  p_preferred_room_layout_id     uuid,
  p_accessibility_requirements   text,
  p_equipment_requirements_notes text,
  p_registration_required        boolean,
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
    p_name, p_purpose, p_description,
    p_preferred_start_datetime, p_preferred_end_datetime, p_expected_attendance,
    p_venue_requirements, p_preferred_room_layout_id,
    p_accessibility_requirements, p_equipment_requirements_notes,
    p_registration_required, p_registration_capacity, p_registration_opens_at, p_registration_closes_at,
    auth.uid(), (select u.organisation_id from users u where u.id = auth.uid()),
    'submitted', false, now()
  )
  returning * into v_event;

  insert into event_status_history (event_id, old_status, new_status, changed_by)
  values (v_event.id, null, 'submitted', auth.uid());

  return v_event;
end;
$$;

grant execute on function create_event_request(
  text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
) to authenticated;

-- ConnectSphere: create and submit a new event request, all-or-nothing (SCRUM-49)
-- Follows 48_venue_booking_replacement.sql.
--
-- AC1: the request's fields need somewhere to live. events.venue_requirements is added by
-- 34_edit_event_details.sql ("add column if not exists"), which runs before this file, so this
-- migration does not add it. create_event_request below depends on that column.

-- AC4 + AC7: create the event as submitted and record it in event_status_history together, so a
-- failure can't leave an event with no history. Same approach as change_event_status().
--
-- security invoker: runs as the calling user, so RLS applies as if they had made the writes
-- themselves. organiser_id and changed_by come from auth.uid() (the verified JWT), and the client
-- organisation from the caller's own users row, so none of them can be spoofed by the request body.
--
-- RLS: 14_events_rls.sql leaves events and event_status_history with no organiser INSERT policy
-- ("event creation ... will add organiser policies with the stories that need them"), so the
-- policies at the bottom of this file add them. They only let an event_organiser insert rows where
-- they are the organiser, so an organiser cannot create events or history for anyone else.
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

-- ============================================================================
-- RLS: ORGANISER INSERT (same style as 14_events_rls.sql)
-- ============================================================================
-- Adds to the policies from 14 (permissive policies are OR-ed), so coordinators keep what they had.
-- Affects event-service only. Draft requests will need their own policy for status = 'draft'.

drop policy if exists events_insert_organiser on events;
create policy events_insert_organiser on events
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_organiser'
    and organiser_id = auth.uid()
    and status = 'submitted'
  );

drop policy if exists event_status_history_insert_organiser on event_status_history;
create policy event_status_history_insert_organiser on event_status_history
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_organiser'
    and changed_by = auth.uid()
    and old_status is null
    and new_status = 'submitted'
    and exists (select 1 from public.events e where e.id = event_id and e.organiser_id = auth.uid())
  );

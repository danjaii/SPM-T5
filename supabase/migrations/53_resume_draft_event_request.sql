-- ConnectSphere: resume editing a draft event request (SCRUM-54)
-- Follows 52_event_drafts.sql. Affects event-service; the replaced status guard below is shared by every status change.
--
-- 52 left the organiser with no UPDATE policy on events ("re-saving a draft is SCRUM-54"). This adds it, for the organiser's
-- own drafts only, and the functions that re-save and submit one.
--
-- AC2 (re-save): update_event_draft() is security invoker, so the policy below is what decides which rows it can touch.
-- A policy cannot limit columns, so a BEFORE UPDATE trigger (events_organiser_draft_guard) refuses an organiser changing the
-- columns that are not part of the form, for every route a write could take, not just the function. The function itself only
-- names the 14 draft fields.
-- AC2: the last-saved time is events.updated_at, refreshed by trg_events_updated_at on every UPDATE.

-- ============================================================================
-- RLS: ORGANISER UPDATE OF OWN DRAFTS
-- ============================================================================
-- Adds to events_update_coordinator (14); permissive policies are OR-ed. USING matches only the caller's own draft, so a
-- submitted request is never updatable by its organiser (AC4). WITH CHECK keeps the row a plain draft: the organiser cannot
-- change the owner, the status, the draft flag, or set a submission, coordinator or confirmed/cancelled/completed time.
-- Moving a draft on to submitted is only possible through submit_event_draft() (below), which is security definer.

drop policy if exists events_update_organiser_draft on events;
create policy events_update_organiser_draft on events
  for update to authenticated
  using (
    public.current_user_role() = 'event_organiser'
    and organiser_id = auth.uid()
    and status = 'draft'
    and is_draft = true
  )
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

-- The columns an organiser cannot change on an event, whichever statement they send. Status, is_draft and submitted_at are
-- not listed: the policy's WITH CHECK pins them for a plain update, and submit_event_draft() moves them for a submission.
create or replace function public.events_organiser_draft_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and public.current_user_role() = 'event_organiser'
     and (
       new.id is distinct from old.id
       or new.organiser_id is distinct from old.organiser_id
       or new.client_organisation_id is distinct from old.client_organisation_id
       or new.assigned_coordinator_id is distinct from old.assigned_coordinator_id
       or new.event_category_id is distinct from old.event_category_id
       or new.cloned_from_event_id is distinct from old.cloned_from_event_id
       or new.created_at is distinct from old.created_at
       or new.confirmed_at is distinct from old.confirmed_at
       or new.cancelled_at is distinct from old.cancelled_at
       or new.completed_at is distinct from old.completed_at
     ) then
    raise exception 'An event organiser can only change the details of their own draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_organiser_draft_guard on events;
create trigger trg_events_organiser_draft_guard
  before update on events
  for each row execute function public.events_organiser_draft_guard();

-- ============================================================================
-- AC2: RE-SAVE A DRAFT
-- ============================================================================
-- Stores the whole form: a field passed as null is cleared, a blank name becomes 'Untitled draft' (as create_event_draft
-- does). Returns the updated row (zero rows when it is not the caller's draft: RLS and the status test find nothing), with the
-- refreshed updated_at. security invoker: runs as the caller, so the policy above applies. The table's check constraints still
-- apply; the service checks them first (packages/shared/src/eventDraft.ts).

create or replace function public.update_event_draft(
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
returns setof events
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
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
  where id = p_event_id and status = 'draft' and is_draft = true
  returning *;
end;
$$;

grant execute on function public.update_event_draft(
  uuid, text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz
) to authenticated;

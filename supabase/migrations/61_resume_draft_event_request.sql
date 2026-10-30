-- ConnectSphere: resume editing a draft event request (SCRUM-54)
-- Follows 60_event_drafts.sql. Affects event-service; the replaced status guard below is shared by every status change.
--
-- 60 left the organiser with no UPDATE policy on events ("re-saving a draft is SCRUM-54"). This adds it, for the organiser's
-- own drafts only, and the functions that re-save and submit one.
--
-- AC2 (re-save): update_event_draft() is security invoker, so the policy below is what decides which rows it can touch.
-- A policy cannot limit columns, so a BEFORE UPDATE trigger (events_organiser_draft_guard) refuses an organiser changing the
-- columns that are not part of the form, for every route a write could take, not just the function. The function itself only
-- names the 14 draft fields.
-- AC3 (submit): submit_event_draft() moves the caller's own draft to Submitted and writes the draft -> submitted history row in
-- one transaction. It is security definer, because a plain update cannot do it (the policy above pins status = 'draft'); it
-- therefore checks the caller itself: an event organiser, their own row, still a draft (AC4). The strict rules are
-- parseEventRequest (packages/shared), which event-service runs first; the function repeats the "mandatory fields filled in"
-- part so a caller who skips the service still cannot submit an empty draft.
-- AC4: a request that is not a draft is refused (DR002), and the UPDATE policy never matches it.
-- Custom SQLSTATEs (class DR): DR001 not the caller's draft or not found, DR002 not a draft any more, DR003 incomplete.
-- No notification is written: notify_event_decision (44) only reacts to approved and rejected.
-- The history row is written by the function, so no organiser INSERT policy for draft -> submitted history is added: such a
-- policy would let an organiser forge history rows by inserting them directly.
--
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

-- ============================================================================
-- AC3 / AC4: SUBMIT A DRAFT
-- ============================================================================
-- events_status_change_guard (14, replaced by 43 for the Safety Officer) lets only the assigned coordinator change an event's
-- status, so it would refuse the organiser submitting their own draft. Same function, one more exception: the organiser
-- of the row, draft -> submitted. It is only reachable through submit_event_draft(), because the organiser UPDATE policy keeps status = 'draft'.

create or replace function public.events_status_change_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and old.assigned_coordinator_id is distinct from auth.uid()
     -- SCRUM-100/AC3 (migration 43): a Safety Officer's change request returns the event to Planning
     and not (old.status = 'awaiting_arrangements' and new.status = 'planning'
              and public.current_user_role() = 'safety_officer')
     -- SCRUM-54/AC3: an organiser submits their own draft
     and not (old.status = 'draft' and new.status = 'submitted' and old.organiser_id = auth.uid()) then
    raise exception 'Only the coordinator assigned to this event can change its status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.submit_event_draft(p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  blank constant text := 'Untitled draft';
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'event_organiser' then
    raise exception 'Only an event organiser can submit a draft' using errcode = '42501';
  end if;

  select * into v_event from events where id = p_event_id and organiser_id = auth.uid() for update;
  if not found then
    raise exception 'Draft not found' using errcode = 'DR001';
  end if;
  if v_event.status is distinct from 'draft' or v_event.is_draft is not true then
    raise exception 'This request has already been submitted' using errcode = 'DR002';
  end if;

  if v_event.name = blank
     or coalesce(btrim(v_event.purpose), '') = ''
     or coalesce(btrim(v_event.description), '') = ''
     or coalesce(btrim(v_event.venue_requirements), '') = ''
     or coalesce(btrim(v_event.accessibility_requirements), '') = ''
     or coalesce(btrim(v_event.equipment_requirements_notes), '') = ''
     or v_event.preferred_start_datetime is null
     or v_event.preferred_end_datetime is null
     or v_event.preferred_room_layout_id is null
     or coalesce(v_event.expected_attendance, 0) < 1
     or (v_event.registration_required
         and (v_event.registration_capacity is null or v_event.registration_opens_at is null or v_event.registration_closes_at is null))
  then
    raise exception 'The draft is missing required details' using errcode = 'DR003';
  end if;

  -- no registration: nothing about capacity or a window is kept, as create_event_request / parseEventRequest do
  update events set
    status = 'submitted',
    is_draft = false,
    submitted_at = now(),
    registration_capacity = case when registration_required then registration_capacity else null end,
    registration_opens_at = case when registration_required then registration_opens_at else null end,
    registration_closes_at = case when registration_required then registration_closes_at else null end
  where id = p_event_id
  returning * into v_event;

  insert into event_status_history (event_id, old_status, new_status, changed_by)
  values (p_event_id, 'draft', 'submitted', auth.uid());

  return v_event;
end;
$$;

revoke execute on function public.submit_event_draft(uuid) from public, anon;
grant execute on function public.submit_event_draft(uuid) to authenticated;

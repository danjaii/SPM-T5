-- ConnectSphere: an organiser deletes their own draft event request (SCRUM-56/AC1,AC2)
-- Follows 51_lead_queue_summary.sql on this branch. The draft stories (SCRUM-53, SCRUM-54) use 52 to 54 on their own branches and this
-- migration does not depend on them: it works on any events row with status 'draft'. Affects event-service only.
--
-- 14_events_rls.sql revokes UPDATE on events from authenticated and anon and has no DELETE policy, on purpose: writes to events go
-- through security definer functions so that history and guards cannot be bypassed. An RLS DELETE policy would never be reached
-- ("permission denied for table events"), and granting DELETE would let any coordinator delete events directly. So the delete is a
-- security definer function modelled on submit_event_draft() and update_event_draft(): only an event organiser, only their own row,
-- only while it is a draft. The organiser keeps no DELETE privilege on the table.
--
-- Custom SQLSTATEs, as in 53 and 54: DR001 not the caller's draft or not found (indistinguishable on purpose), DR002 not a draft.
--
-- Child rows: every table that references events(id) does so on delete cascade (status and coordinator history, sessions, change
-- requests, comments, documents, venue bookings, equipment reservations, technical support requests, registrations, notifications,
-- assignment logs, change history, safety checks), so a draft's own rows are removed with it and none is orphaned. The only reference
-- without a cascade is events.cloned_from_event_id; a copy is made from a completed or past request, never from a draft, and if one
-- ever pointed at a draft the foreign key would refuse this delete (SQLSTATE 23503) and the draft would stay.

create or replace function public.delete_event_draft(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'event_organiser' then
    raise exception 'Only an event organiser can delete a draft' using errcode = '42501';
  end if;

  -- locked, so a submit that races this delete cannot slip between the check and the delete
  select * into v_event from events where id = p_event_id and organiser_id = auth.uid() for update;
  if not found then
    raise exception 'Draft not found' using errcode = 'DR001';
  end if;
  if v_event.status is distinct from 'draft' or v_event.is_draft is not true then
    raise exception 'This request has already been submitted' using errcode = 'DR002';
  end if;

  delete from events where id = p_event_id;
end;
$$;

revoke execute on function public.delete_event_draft(uuid) from public, anon;
grant execute on function public.delete_event_draft(uuid) to authenticated;

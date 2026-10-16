-- SCRUM-67 (docs/specs/review-change-request.md): the event's coordinator reviews an organiser's change request (SCRUM-66).
-- Follows 41_technical_assignment_notifications.sql.
--
-- review_change_request(p_request_id, p_approve, p_reason, p_changes, p_send_back), security definer:
--   - only the event's current assigned coordinator (42501), and only a pending request (CS067 ALREADY_REVIEWED);
--   - approving: p_changes must be exactly the request's fields and requested values (22023 otherwise), as event-service read
--     them ({ from, to }, a seeded plain value read as "from the current value"). They are saved through
--     update_event_details() (migration 40), so the change history records the coordinator's change, an event changed since
--     the request is refused (CS111), a finished event is refused (CS112), and p_send_back sends the affected arrangements
--     back for review (SCRUM-113). The request is marked approved in the same transaction;
--   - rejecting: a reason is required (22023), at most 2000 characters; the event is not touched.
-- event_change_requests stays closed to direct UPDATE (migration 15); this function is the only way to decide a request.
--
-- Affects event-service (the review routes). Adds one function; changes no existing data.

create or replace function public.review_change_request(
  p_request_id uuid,
  p_approve    boolean,
  p_reason     text default null,
  p_changes    jsonb default null,
  p_send_back  jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request  event_change_requests;
  v_event    events;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_field    text;
  v_wanted   jsonb;
begin
  select * into v_request from event_change_requests where id = p_request_id for update;
  if found then
    select * into v_event from events where id = v_request.event_id;
  end if;
  -- AC7: only the event's current assigned coordinator (a request that does not exist says nothing more)
  if v_request.id is null
     or public.current_user_role() is distinct from 'event_coordinator'
     or v_event.assigned_coordinator_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  -- AC8: decided once
  if v_request.status <> 'pending' then
    raise exception using errcode = 'CS067', message = 'ALREADY_REVIEWED';
  end if;

  if p_approve then
    if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb
       or v_request.proposed_changes is null or jsonb_typeof(v_request.proposed_changes) <> 'object' then
      raise exception using errcode = '22023', message = 'Nothing to apply.';
    end if;
    -- every field of the request, and nothing else, with exactly the requested value
    for v_field in select jsonb_object_keys(v_request.proposed_changes) loop
      if not p_changes ? v_field then
        raise exception using errcode = '22023', message = format('The request''s %s is not applied.', v_field);
      end if;
    end loop;
    for v_field in select jsonb_object_keys(p_changes) loop
      if not v_request.proposed_changes ? v_field then
        raise exception using errcode = '22023', message = format('%s was not requested.', v_field);
      end if;
      v_wanted := v_request.proposed_changes -> v_field;
      if jsonb_typeof(v_wanted) = 'object' and v_wanted ? 'to' then
        v_wanted := v_wanted -> 'to';
      end if;
      if (p_changes -> v_field -> 'to') is distinct from v_wanted then
        raise exception using errcode = '22023', message = format('%s is not the requested value.', v_field);
      end if;
    end loop;

    -- AC3: the same save as the coordinator's own edit (change history, stale and locked checks, SCRUM-113 send-back)
    perform public.update_event_details(v_request.event_id, p_changes, p_send_back);
    update event_change_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_request_id;
  else
    -- AC4, AC5: a reason, and the event untouched
    if v_reason is null or length(v_reason) > 2000 then
      raise exception using errcode = '22023', message = 'Give a reason for rejecting this request.';
    end if;
    update event_change_requests
    set status = 'rejected', review_notes = v_reason, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_request_id;
  end if;
end;
$$;

revoke execute on function public.review_change_request(uuid, boolean, text, jsonb, jsonb) from public, anon;
grant execute on function public.review_change_request(uuid, boolean, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

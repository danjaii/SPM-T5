-- ConnectSphere: registrations confirmed automatically up to capacity, for SCRUM-169
-- Follows 67_conflicting_change_requests.sql
--
-- Every registration was saved as Pending (waitlisted) and nothing confirmed it, so an event never filled up. The customer's rule
-- (W9 r29): attendees register directly up to capacity, and the organiser decides beyond it. Both functions are security definer
-- because an attendee may not insert a Confirmed row (11's policy), and an organiser has no update policy on registrations (29's
-- lets only the attendee withdraw). Both lock the event row, so places are counted one request at a time.
--
-- Affects event-service (POST /events/:id/registrations and its decision route). Adds functions; changes no existing data and no
-- existing function. 11's insert policy stays: a direct insert can still only create a Pending row.

create or replace function public.register_for_event(p_event_id uuid, p_details jsonb)
returns registration_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
  v_status registration_status := 'registered';
begin
  -- SCRUM-169/AC5: the lock makes attendees take turns, so each counts the places after the previous one has finished
  select * into v_event from events where id = p_event_id for update;

  -- An attendee's token can call this directly and it can confirm, so it repeats what list_public_events() and availabilityOf()
  -- (event-service) decide: a public event, inside its registration window, that has not started
  if not found
     or v_event.status <> 'confirmed'
     or not v_event.registration_required
     or v_event.registration_closes_at <= now()
     or v_event.registration_opens_at > now()
     or v_event.preferred_start_datetime <= now() then
    raise exception using errcode = 'CS169', message = 'REGISTRATION_CLOSED';
  end if;

  -- SCRUM-169/AC1, AC2: a place is free, or no capacity means no limit. Only Confirmed holds a place (SCRUM-83/AC13)
  if v_event.registration_capacity is not null
     and (select count(*) from event_registrations r where r.event_id = p_event_id and r.status = 'registered') >= v_event.registration_capacity then
    v_status := 'waitlisted';
  end if;

  -- The partial unique index from 11 still refuses a second active registration (23505)
  insert into event_registrations (event_id, attendee_id, status, registration_details)
  values (p_event_id, auth.uid(), v_status, p_details);
  return v_status;
end;
$$;

revoke execute on function public.register_for_event(uuid, jsonb) from public, anon;
grant execute on function public.register_for_event(uuid, jsonb) to authenticated;

-- SCRUM-169/AC3, AC4: the event's organiser confirms or declines a Pending registration. p_decision is 'confirm' or 'decline'.
create or replace function public.decide_registration(p_registration_id uuid, p_decision text)
returns registration_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_event events%rowtype;
  v_status registration_status;
begin
  if p_decision not in ('confirm', 'decline') then
    raise exception using errcode = 'CS169', message = 'INVALID_DECISION';
  end if;

  select r.event_id into v_event_id from event_registrations r where r.id = p_registration_id;
  -- AC3: the organiser's decision only. The same answer as an unknown id, so ids can't be probed
  if v_event_id is null or not public.is_event_organiser(v_event_id) then
    raise exception using errcode = 'CS169', message = 'NOT_FOUND';
  end if;

  -- AC4: the same lock as register_for_event(), so a decision and a registration can't both take the last place
  select * into v_event from events where id = v_event_id for update;
  if v_event.status <> 'confirmed' then
    raise exception using errcode = 'CS169', message = 'EVENT_CLOSED';
  end if;

  -- Read after the lock: the attendee may have withdrawn in the meantime
  select r.status into v_status from event_registrations r where r.id = p_registration_id for update;
  if v_status <> 'waitlisted' then
    raise exception using errcode = 'CS169', message = 'NOT_PENDING';
  end if;

  -- AC4: refused unless a place has been freed. Declining uses no place, so it is always allowed
  if p_decision = 'confirm'
     and v_event.registration_capacity is not null
     and (select count(*) from event_registrations r where r.event_id = v_event_id and r.status = 'registered') >= v_event.registration_capacity then
    raise exception using errcode = 'CS169', message = 'EVENT_FULL';
  end if;

  -- 'cancelled' is what every page shows as Rejected (registrationStatus() in packages/shared)
  v_status := case p_decision when 'confirm' then 'registered'::registration_status else 'cancelled'::registration_status end;
  update event_registrations set status = v_status where id = p_registration_id;
  return v_status;
end;
$$;

revoke execute on function public.decide_registration(uuid, text) from public, anon;
grant execute on function public.decide_registration(uuid, text) to authenticated;

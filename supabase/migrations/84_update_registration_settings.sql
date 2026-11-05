-- SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): the assigned coordinator adjusts an event's registration
-- capacity and window, for instance while a venue block has returned the event to Planning.
-- Follows 76_organiser_home.sql on main; the pending migrations 77 to 83 are independent of this one. Append-only: nothing earlier
-- is edited.
--
--   update_registration_settings(event, capacity, opens, closes)
--     Only the event's assigned coordinator (42501 otherwise; P0002 when the event does not exist), on an event that is not closed
--     (CL001: Completed, Cancelled, Rejected) and that takes registrations (22023, hint 'registration'). The rules are the event
--     request form's (SCRUM-49): a capacity from 1 to 100000, an opening and a closing time, the closing after the opening and no
--     later than the event's start; each refusal is 22023 with the field name as its hint. The one rule only the database can
--     check: the capacity may not be lower than the number of Confirmed ('registered') registrations (Pending ones hold no place,
--     SCRUM-83/AC13), so nobody who holds a place is pushed out. Times in the past are allowed (that is how registration is closed
--     early). The registrations themselves are never touched. Each change is logged in activity_log.
--
-- Registration is already closed while an event is not Confirmed (register_for_event 68 refuses; list_public_events 28 lists only
-- Confirmed or Cancelled events), so nothing about that changes here. No table changes. Affects event-service.

create or replace function public.update_registration_settings(
  p_event_id uuid,
  p_capacity int,
  p_opens    timestamptz,
  p_closes   timestamptz
)
returns table (registration_capacity int, registration_opens_at timestamptz, registration_closes_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_event     events%rowtype;
  v_confirmed int;
begin
  if public.current_user_role() is distinct from 'event_coordinator' then
    raise exception 'Only the coordinator assigned to this event can do this' using errcode = '42501';
  end if;

  -- lock the event so a change and a registration are taken one after the other
  select * into v_event from events where events.id = p_event_id for update;
  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if v_event.assigned_coordinator_id is distinct from auth.uid() then
    raise exception 'Only the coordinator assigned to this event can do this' using errcode = '42501';
  end if;
  if public.is_closed_event_status(v_event.status) then
    raise exception 'This event is closed, so its registration can''t be changed' using errcode = 'CL001';
  end if;
  if not v_event.registration_required then
    raise exception 'This event does not take registrations' using errcode = '22023', hint = 'registration';
  end if;

  if p_capacity is null or p_capacity < 1 then
    raise exception 'Enter a whole number of 1 or more' using errcode = '22023', hint = 'registration_capacity';
  end if;
  if p_capacity > 100000 then
    raise exception 'The capacity can''t be more than 100000' using errcode = '22023', hint = 'registration_capacity';
  end if;
  if p_opens is null then
    raise exception 'Enter the registration opening date and time' using errcode = '22023', hint = 'registration_opens_at';
  end if;
  if p_closes is null then
    raise exception 'Enter the registration closing date and time' using errcode = '22023', hint = 'registration_closes_at';
  end if;
  if p_closes <= p_opens then
    raise exception 'Registration must close after it opens' using errcode = '22023', hint = 'registration_closes_at';
  end if;
  if v_event.preferred_start_datetime is not null and p_closes > v_event.preferred_start_datetime then
    raise exception 'Registration must close by the event start' using errcode = '22023', hint = 'registration_closes_at';
  end if;

  select count(*)::int into v_confirmed
    from event_registrations r
   where r.event_id = p_event_id and r.status = 'registered';
  if p_capacity < v_confirmed then
    raise exception '% attendees are already confirmed, so the capacity can''t be lower than %.', v_confirmed, v_confirmed
      using errcode = '22023', hint = 'registration_capacity';
  end if;

  update events
     set registration_capacity = p_capacity,
         registration_opens_at = p_opens,
         registration_closes_at = p_closes
   where events.id = p_event_id;

  insert into activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'registration_settings_changed', 'event', p_event_id,
          format('Registration settings changed: capacity %s to %s, opens %s to %s, closes %s to %s',
                 v_event.registration_capacity, p_capacity, v_event.registration_opens_at, p_opens,
                 v_event.registration_closes_at, p_closes));

  return query select p_capacity, p_opens, p_closes;
end;
$$;

revoke execute on function public.update_registration_settings(uuid, int, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_registration_settings(uuid, int, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

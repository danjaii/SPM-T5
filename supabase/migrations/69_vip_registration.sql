-- ConnectSphere: the organiser adds a VIP past the registration cap, for SCRUM-170
-- Follows 68_registration_capacity.sql
--
-- The customer allows an organiser to add VIPs by hand past the normal registration cap, up to the venue's capacity (W4 r5).
-- add_vip_registration() is security definer because neither an organiser nor an attendee may write a Confirmed row directly
-- (11's insert policy, 29's update policy).
--
-- is_vip is the label the registration list shows, set only by that function. RLS decides which rows a caller can touch and can't
-- put one column off limits, so, as 03 does for users.role, the grants are narrowed to the columns callers write today.
--
-- Affects event-service (POST /events/:id/vip-registrations, GET /events/:id/registrations). Adds a column (default false), so no
-- existing registration changes.

alter table public.event_registrations
  add column if not exists is_vip boolean not null default false;

revoke insert, update on public.event_registrations from anon, authenticated;
grant insert (event_id, attendee_id, status, registration_details) on public.event_registrations to authenticated;
grant update (status, withdrawn_at) on public.event_registrations to authenticated;

-- p_email is the attendee's profile email, ignoring case and surrounding spaces.
create or replace function public.add_vip_registration(p_event_id uuid, p_email text)
returns registration_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events%rowtype;
  v_attendee_id uuid;
  v_active_id uuid;
  v_active_status registration_status;
  v_venue_capacity int;
begin
  -- AC3: the organiser's decision only. The same answer as an unknown event, so ids can't be probed
  if not public.is_event_organiser(p_event_id) then
    raise exception using errcode = 'CS170', message = 'NOT_FOUND';
  end if;

  -- AC2: the same lock as register_for_event() (68), so two callers can't both take the venue's last place
  select * into v_event from events where id = p_event_id for update;
  if v_event.status <> 'confirmed' or not v_event.registration_required then
    raise exception using errcode = 'CS170', message = 'EVENT_CLOSED';
  end if;

  -- AC1: a VIP must already have an attendee account (the assumption agreed for this story)
  select u.id into v_attendee_id from users u
  where lower(u.email) = lower(trim(p_email)) and u.role = 'attendee' and u.is_active;
  if v_attendee_id is null then
    raise exception using errcode = 'CS170', message = 'ACCOUNT_NOT_FOUND';
  end if;

  -- AC4: one active registration per attendee per event (W9 r28; 11's partial unique index is the backstop)
  select r.id, r.status into v_active_id, v_active_status from event_registrations r
  where r.event_id = p_event_id and r.attendee_id = v_attendee_id and r.status in ('registered', 'waitlisted')
  for update;
  if v_active_status = 'registered' then
    raise exception using errcode = 'CS170', message = 'ALREADY_REGISTERED';
  end if;

  -- AC2: with several venues everyone Confirmed must fit in each, so the smallest is the limit. Approved or legacy 'confirmed'
  -- bookings, as list_public_events() (28) counts them
  select min(v.max_capacity) into v_venue_capacity
  from venue_bookings b join venues v on v.id = b.venue_id
  where b.event_id = p_event_id and b.status in ('approved', 'confirmed');
  if v_venue_capacity is null then
    raise exception using errcode = 'CS170', message = 'NO_VENUE';
  end if;

  if (select count(*) from event_registrations r where r.event_id = p_event_id and r.status = 'registered') >= v_venue_capacity then
    raise exception using errcode = 'CS170', message = 'VENUE_FULL', detail = v_venue_capacity::text;
  end if;

  if v_active_id is not null then
    -- AC4: the Pending row is confirmed. 65's trigger tells the attendee, as it does for any status change
    update event_registrations set status = 'registered', is_vip = true where id = v_active_id;
  else
    insert into event_registrations (event_id, attendee_id, status, is_vip) values (p_event_id, v_attendee_id, 'registered', true);
    -- AC1: 65's trigger fires on updates only, so a new row sends the same notification from here
    insert into notifications (user_id, event_id, type, title, message)
    values (v_attendee_id, p_event_id, 'registration_status_changed', 'Your registration changed',
            format('Your registration for %s is now Confirmed.', v_event.name));
  end if;
  return 'registered';
end;
$$;

revoke execute on function public.add_vip_registration(uuid, text) from public, anon;
grant execute on function public.add_vip_registration(uuid, text) to authenticated;

-- SCRUM-185/AC2: Venue Staff lift a venue unavailability block (docs/specs/venue-block-lifting.md).
-- Follows 76_organiser_home.sql on main; the pending migrations 77 (SCRUM-183), 78 (SCRUM-182) and 79 (SCRUM-181) are
-- independent of this one, which only needs 39 (the block), 46 (the flags and venue_short_sgt) and 35 (notifications.venue_booking_id).
-- Append-only: nothing earlier is edited.
--
--   lift_venue_unavailability(venue, block)   venue_staff only (42501 otherwise); P0002 when the block is not this venue's.
--     For every open venue_unavailable flag of the block whose booking has not ended, the event's assigned coordinator gets one
--     'venue_block_lifted' notification (SCRUM-106's rule: events.assigned_coordinator_id, never requested_by). It then logs the
--     lift and deletes the block, and the flags go with it (venue_booking_flags.unavailability_id is on delete cascade), all in
--     one transaction. Returns how many flags were cleared and how many coordinators were told.
--
-- Nobody can delete from venue_unavailability directly (39 revoked it), so this function is the only way a block goes.

create or replace function public.lift_venue_unavailability(
  p_venue_id uuid,
  p_block_id uuid
)
returns table (flags_cleared int, notified int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_block     record;
  v_flag      record;
  v_reason    text;
  v_booked    text;
  v_cleared   int := 0;
  v_notified  int := 0;
  v_message   text;
begin
  if public.current_user_role() is distinct from 'venue_staff' then
    raise exception 'Only venue staff can lift an unavailable period.' using errcode = '42501';
  end if;

  -- the same venue row lock as mark_venue_unavailable, so a lift cannot interleave with a mark or a booking on this venue
  perform v.id from public.venues v where v.id = p_venue_id for no key update;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0002';
  end if;

  select u.id, u.start_datetime, u.end_datetime, u.reason::text as reason
    into v_block
    from public.venue_unavailability u
   where u.id = p_block_id and u.venue_id = p_venue_id
     for update;
  if not found then
    raise exception 'Unavailable period not found.' using errcode = 'P0002';
  end if;

  v_reason := case v_block.reason
    when 'maintenance' then 'Maintenance'
    when 'equipment_failure' then 'Equipment failure'
    when 'renovation' then 'Renovation'
    when 'safety' then 'Safety concern'
    when 'internal_activity' then 'Internal activity'
    else 'Other'
  end;

  for v_flag in
    select f.id as flag_id, f.booking_id, f.resolved_at,
           e.id as event_id, e.name as event_name, e.assigned_coordinator_id,
           v.name as venue_name, b.event_start_datetime as b_start, b.event_end_datetime as b_end,
           exists (
             select 1 from public.venue_booking_flags o
              where o.booking_id = f.booking_id and o.kind = 'venue_unavailable'
                and o.unavailability_id <> v_block.id and o.resolved_at is null
           ) as still_flagged
      from public.venue_booking_flags f
      join public.venue_bookings b on b.id = f.booking_id
      join public.events e on e.id = b.event_id
      join public.venues v on v.id = b.venue_id
     where f.unavailability_id = v_block.id and f.kind = 'venue_unavailable'
  loop
    -- only a flag that is still open counts; a resolved one (the booking was replaced or closed) tells nobody
    if v_flag.resolved_at is not null then
      continue;
    end if;
    v_cleared := v_cleared + 1;

    -- a booking that has already ended, or an event nobody is assigned to, has no one to tell
    if v_flag.assigned_coordinator_id is null or v_flag.b_end <= now() then
      continue;
    end if;

    v_booked := public.venue_short_sgt(v_flag.b_start) || ' to '
      || case when (v_flag.b_start at time zone 'Asia/Singapore')::date = (v_flag.b_end at time zone 'Asia/Singapore')::date
              then to_char(v_flag.b_end at time zone 'Asia/Singapore', 'HH24:MI')
              else public.venue_short_sgt(v_flag.b_end) end;

    v_message := format('%s: the unavailable period at %s (%s to %s, %s) has been lifted. Your booking on %s is ',
                        v_flag.event_name, v_flag.venue_name,
                        public.venue_short_sgt(v_block.start_datetime), public.venue_short_sgt(v_block.end_datetime),
                        v_reason, v_booked)
      || case when v_flag.still_flagged
              then 'still affected by another unavailable period.'
              else 'no longer affected by it.' end;

    insert into public.notifications (user_id, event_id, venue_booking_id, type, title, message)
    values (v_flag.assigned_coordinator_id, v_flag.event_id, v_flag.booking_id, 'venue_block_lifted',
            'Venue available again', v_message);
    v_notified := v_notified + 1;
  end loop;

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'venue_unavailability_lifted', 'venue', p_venue_id,
          format('Lifted the unavailable period %s to %s (%s)', v_block.start_datetime, v_block.end_datetime, v_block.reason)
          || case when v_cleared > 0 then format('; %s booking(s) no longer flagged', v_cleared) else '' end);

  -- the flags of this block go with it (on delete cascade)
  delete from public.venue_unavailability where id = v_block.id;

  return query select v_cleared, v_notified;
end;
$$;

revoke execute on function public.lift_venue_unavailability(uuid, uuid) from public, anon;
grant execute on function public.lift_venue_unavailability(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

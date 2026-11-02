-- SCRUM-159 (Figma 02): the Event Organiser Home. One call gives the page every one of the caller's own events with what the
-- list shows beside it: the coordinator and when they were assigned, the approved venues, an open clarification request from
-- the coordinator (a request with no answer from the organiser yet) and the outcome of the latest decided change request.
-- Security definer because an organiser cannot read venue bookings (migration 09) or other users' rows (SCRUM-154); it
-- returns only rows of events the caller organises. Affects event-service (GET /events/my-requests/home) and apps/web.

create or replace function public.organiser_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is distinct from 'event_organiser' then
    raise exception 'Only an Event Organiser can do this' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(row order by e_created desc)
    from (
      select e.created_at as e_created, jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'status', e.status,
        'start', e.preferred_start_datetime,
        'end', e.preferred_end_datetime,
        'expected_attendance', e.expected_attendance,
        'submitted_at', e.submitted_at,
        'updated_at', e.updated_at,
        'venue_names', array(
          select v.name from venue_bookings b join venues v on v.id = b.venue_id
          where b.event_id = e.id and b.status in ('approved', 'confirmed')
          order by b.event_start_datetime, v.name),
        'coordinator_name', (select u.full_name from users u where u.id = e.assigned_coordinator_id),
        'coordinator_assigned_at', (
          select h.assigned_at from event_coordinator_history h
          where h.event_id = e.id and h.coordinator_id = e.assigned_coordinator_id and h.unassigned_at is null
          order by h.assigned_at desc limit 1),
        'clarification', (
          select jsonb_build_object('author_name', u.full_name, 'text', c.comment_text, 'asked_at', c.created_at)
          from event_comments c join users u on u.id = c.author_id
          where c.event_id = e.id and c.is_clarification_request
            and not exists (
              select 1 from event_comments a
              where a.parent_comment_id = c.id and a.author_id = e.organiser_id)
          order by c.created_at desc limit 1),
        'change_outcome', (
          select jsonb_build_object('status', r.status, 'decided_at', r.reviewed_at)
          from event_change_requests r
          where r.event_id = e.id and r.status in ('approved', 'rejected')
          order by r.reviewed_at desc nulls last limit 1)
      ) as row
      from events e
      where e.organiser_id = auth.uid()
    ) mine
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.organiser_home() from public, anon;
grant execute on function public.organiser_home() to authenticated;

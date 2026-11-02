-- SCRUM-165 (Figma 19): the Safety Officer Home. One call gives the page everything: the events ready for a check, each
-- marked when it has been checked before (changes requested, rejected, or an approval an important change revoked: a
-- re-check), how many events wait on their coordinator after a decision, this month's approvals and the latest decisions.
-- Security definer because Safety Officers cannot read venue bookings or equipment requests (as safety_check_queue() in
-- migration 37, whose ready rule it reuses). Affects event-service (GET /safety-checks/home) and apps/web.

create or replace function public.safety_officer_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_user_role() is distinct from 'safety_officer' then
    raise exception 'Only a Safety Officer can do this' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ready', coalesce((
      select jsonb_agg(r order by r->>'start' nulls last, r->>'name')
      from (
        select jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'start', e.preferred_start_datetime,
          'end', e.preferred_end_datetime,
          'expected_attendance', e.expected_attendance,
          'venue_names', array(
            select v.name from venue_bookings b join venues v on v.id = b.venue_id
            where b.event_id = e.id and b.status in ('approved', 'confirmed')
            order by b.event_start_datetime, v.name),
          'recheck', exists (select 1 from safety_checks c where c.event_id = e.id)
        ) as r
        from events e
        where e.status = 'awaiting_arrangements' and public.is_ready_for_safety_check(e.id)
      ) ready
    ), '[]'::jsonb),
    'waiting_on_coordinator', (
      select count(*) from events e
      where e.status = 'planning' and public.latest_safety_decision(e.id) in ('changes_requested', 'rejected')
    ),
    'approved_this_month', (
      select count(*) from safety_checks c
      where c.decision = 'approved' and c.decided_at >= date_trunc('month', now())
    ),
    'revoked_this_month', (
      select count(*) from safety_checks c
      where c.decision = 'approved' and c.revoked_at >= date_trunc('month', now())
    ),
    'recent', coalesce((
      select jsonb_agg(r order by r->>'decided_at' desc)
      from (
        select jsonb_build_object('event_id', e.id, 'name', e.name, 'decision', c.decision, 'decided_at', c.decided_at) as r
        from safety_checks c join events e on e.id = c.event_id
        order by c.decided_at desc, c.id desc
        limit 4
      ) latest
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.safety_officer_home() from public, anon;
grant execute on function public.safety_officer_home() to authenticated;

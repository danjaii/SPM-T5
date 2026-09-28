-- ER-01/AC4: minimal coordinator-only access projection. AC2 will add the
-- request's display fields later; this function currently exposes only its ID.
create function public.review_submitted_requests(request_id uuid default null)
returns table (id uuid)
language sql stable security invoker set search_path = ''
as $$
  select e.id from public.events e
  where e.status = 'submitted'
    and e.assigned_coordinator_id = (select auth.uid())
    and (request_id is null or e.id = request_id)
    and exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.is_active and u.role = 'event_coordinator'
    );
$$;
revoke all on function public.review_submitted_requests(uuid) from public, anon;
grant execute on function public.review_submitted_requests(uuid) to authenticated;

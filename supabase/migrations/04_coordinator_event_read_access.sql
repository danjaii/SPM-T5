-- ER-01/AC4: coordinators may read only events assigned to them.
-- RESTRICTIVE combines with the existing permissive policy using AND;
-- adding another permissive policy would leave blanket reads available.
-- Other roles retain their existing policies in this read-access increment.
-- Active-account restrictions and broader write policies are separate work.

create policy events_coordinator_assignment_read on public.events
  as restrictive for select to authenticated
  using (
    not exists (
      select 1 from public.users
      where id = (select auth.uid()) and role = 'event_coordinator'
    )
    or assigned_coordinator_id = (select auth.uid())
  );

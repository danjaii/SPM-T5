-- ER-01/AC4: verify an active participant before exposing event rows.
-- The organiser's own-event access is preserved outside coordinator review.
create policy events_active_participant_read on public.events
  as restrictive for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.is_active
        and (
          (u.role = 'event_coordinator' and events.assigned_coordinator_id = u.id)
          or (u.role = 'event_organiser' and events.organiser_id = u.id)
        )
    )
  );

-- Protect the identity records used by the read policy. Profile creation and
-- deletion remain auth-service admin operations. Migration 03's column grants
-- already prohibit role/is_active edits; now updates also require the own row.
create policy users_own_profile_update on public.users
  as restrictive for update to authenticated
  using (id = (select auth.uid()) and is_active)
  with check (id = (select auth.uid()) and is_active);
create policy users_admin_insert_only on public.users
  as restrictive for insert to authenticated with check (false);
create policy users_admin_delete_only on public.users
  as restrictive for delete to authenticated using (false);

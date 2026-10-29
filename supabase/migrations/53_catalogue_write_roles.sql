-- ConnectSphere: catalogue writes follow the owning role (SCRUM-155, ADR 0003)
-- Follows 52_users_contact_privacy.sql (SCRUM-154, open in PR #138); 51 is the latest on main.
-- Spec: docs/specs/catalogue-write-roles.md
--
-- 02_rls.sql gave each of these eight tables one blanket policy: any signed-in user could insert, edit or delete any row by
-- querying the database directly. Reads stay open to every signed-in user (nothing that shows the catalogue changes), and
-- writes now go only to the role that owns the data. No service or page writes these tables today, and every test fixture
-- that does uses the secret key, which bypasses RLS, so no consumer needs a change.
--
--   table                                     SELECT       INSERT             UPDATE              DELETE
--   venues                                    signed in    venue_staff        venue_staff (1)     none
--   venue_supported_layouts, venue_facilities signed in    venue_staff        venue_staff         venue_staff
--   room_layouts, facilities                  signed in    venue_staff        venue_staff         venue_staff (2)
--   equipment                                 signed in    technical_support  technical_support   none
--   organisations, event_categories           signed in    none               none                none
--
--   (1) migration 26's column grant stays, so setup_minutes and turnaround_minutes are written only by set_venue_timing().
--       set_venue_timing() and mark_venue_unavailable() are security definer and check the role themselves; they are not
--       touched here.
--   (2) a layout a venue supports (venue_supported_layouts) or an event prefers (events.preferred_room_layout_id) is refused
--       by its foreign key, which has no "on delete"; Venue Staff retire a layout with is_active = false. Deleting a facility
--       removes it from every venue (venue_facilities is "on delete cascade"); nothing else refers to a facility.
--
-- Where a role is never allowed an action, the table privilege is revoked as well (as migration 39 did for
-- venue_unavailability), so the caller gets a permission error (42501) and not a silent "0 rows changed". For a role-gated
-- table a refused INSERT is an RLS violation (42501) and a refused UPDATE or DELETE by the wrong role changes no rows.
-- anon never had a policy; its write privileges are revoked here too so that stays true if one is ever added.
--
-- current_user_role() is the security definer helper from 07_venue_bookings_rls.sql.

-- ============================================================================
-- VENUES, owned by Venue Staff
-- ============================================================================

drop policy venues_authenticated_all on venues;
create policy venues_select_authenticated on venues
  for select to authenticated using (true);
create policy venues_insert_venue_staff on venues
  for insert to authenticated with check (public.current_user_role() = 'venue_staff');
create policy venues_update_venue_staff on venues
  for update to authenticated
  using (public.current_user_role() = 'venue_staff')
  with check (public.current_user_role() = 'venue_staff');
revoke delete on venues from authenticated, anon;

-- ============================================================================
-- LINK TABLES AND LAYOUT / FACILITY LOOKUPS, owned by Venue Staff
-- ============================================================================

drop policy venue_supported_layouts_authenticated_all on venue_supported_layouts;
create policy venue_supported_layouts_select_authenticated on venue_supported_layouts
  for select to authenticated using (true);
create policy venue_supported_layouts_insert_venue_staff on venue_supported_layouts
  for insert to authenticated with check (public.current_user_role() = 'venue_staff');
create policy venue_supported_layouts_update_venue_staff on venue_supported_layouts
  for update to authenticated
  using (public.current_user_role() = 'venue_staff')
  with check (public.current_user_role() = 'venue_staff');
create policy venue_supported_layouts_delete_venue_staff on venue_supported_layouts
  for delete to authenticated using (public.current_user_role() = 'venue_staff');

drop policy venue_facilities_authenticated_all on venue_facilities;
create policy venue_facilities_select_authenticated on venue_facilities
  for select to authenticated using (true);
create policy venue_facilities_insert_venue_staff on venue_facilities
  for insert to authenticated with check (public.current_user_role() = 'venue_staff');
create policy venue_facilities_update_venue_staff on venue_facilities
  for update to authenticated
  using (public.current_user_role() = 'venue_staff')
  with check (public.current_user_role() = 'venue_staff');
create policy venue_facilities_delete_venue_staff on venue_facilities
  for delete to authenticated using (public.current_user_role() = 'venue_staff');

drop policy room_layouts_authenticated_all on room_layouts;
create policy room_layouts_select_authenticated on room_layouts
  for select to authenticated using (true);
create policy room_layouts_insert_venue_staff on room_layouts
  for insert to authenticated with check (public.current_user_role() = 'venue_staff');
create policy room_layouts_update_venue_staff on room_layouts
  for update to authenticated
  using (public.current_user_role() = 'venue_staff')
  with check (public.current_user_role() = 'venue_staff');
create policy room_layouts_delete_venue_staff on room_layouts
  for delete to authenticated using (public.current_user_role() = 'venue_staff');

drop policy facilities_authenticated_all on facilities;
create policy facilities_select_authenticated on facilities
  for select to authenticated using (true);
create policy facilities_insert_venue_staff on facilities
  for insert to authenticated with check (public.current_user_role() = 'venue_staff');
create policy facilities_update_venue_staff on facilities
  for update to authenticated
  using (public.current_user_role() = 'venue_staff')
  with check (public.current_user_role() = 'venue_staff');
create policy facilities_delete_venue_staff on facilities
  for delete to authenticated using (public.current_user_role() = 'venue_staff');

-- ============================================================================
-- EQUIPMENT, owned by Technical Support Staff
-- ============================================================================

drop policy equipment_authenticated_all on equipment;
create policy equipment_select_authenticated on equipment
  for select to authenticated using (true);
create policy equipment_insert_technical_support on equipment
  for insert to authenticated with check (public.current_user_role() = 'technical_support_staff');
create policy equipment_update_technical_support on equipment
  for update to authenticated
  using (public.current_user_role() = 'technical_support_staff')
  with check (public.current_user_role() = 'technical_support_staff');
revoke delete on equipment from authenticated, anon;

-- ============================================================================
-- ORGANISATIONS AND EVENT CATEGORIES, read-only through the API
-- ============================================================================
-- Nothing in the app creates either today (both come from the seed); the secret key still writes them.

drop policy organisations_authenticated_all on organisations;
create policy organisations_select_authenticated on organisations
  for select to authenticated using (true);
revoke insert, update, delete on organisations from authenticated, anon;

drop policy event_categories_authenticated_all on event_categories;
create policy event_categories_select_authenticated on event_categories
  for select to authenticated using (true);
revoke insert, update, delete on event_categories from authenticated, anon;

-- ============================================================================
-- anon: no writes anywhere in the catalogue
-- ============================================================================

revoke insert, update, delete on venue_supported_layouts, venue_facilities, room_layouts, facilities from anon;
revoke insert, update on venues, equipment from anon;

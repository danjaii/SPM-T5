-- ConnectSphere: equipment reservations and technical support requests follow the event's access (SCRUM-153, ADR 0003)
-- Follows 53_catalogue_write_roles.sql (SCRUM-155) and 52_users_contact_privacy.sql (SCRUM-154), both open; 51 is the
-- latest on main. Spec: docs/specs/equipment-reservations-rls.md
--
-- equipment_reservations had two restrictive policies on top of the blanket one from 02_rls.sql: insert (migration 25) and
-- update (migration 32). Reads and deletes were open to every signed-in user, and technical_support_requests had only the
-- blanket policy. This replaces the blanket policies, so a reservation is read only by the people involved in its event.
--
--   equipment_reservations              SELECT                                   INSERT                  UPDATE                  DELETE
--     technical_support_staff           every row                                none                    every row (1)           none
--     event_coordinator (assigned)      the event's rows                         the event's requests (2) none (3)                none
--     event_organiser (of the event)    the event's rows                         none                    none                    none
--     any other role / other event      none                                     none                    none                    none
--
--   technical_support_requests          SELECT                                   INSERT                  UPDATE                  DELETE
--     technical_support_staff           every row                                none                    every row               none
--     event_coordinator (assigned)      the event's rows                         the event's requests (4) none                   none
--     any other role / other event      none                                     none                    none                    none
--
--   (1) migration 32's restrictive policy is unchanged and still the only reason a coordinator's direct update fails.
--   (2) migration 25's restrictive insert policy is unchanged: their own name, status 'requested', an open event, an
--       approved venue booking. The permissive policy here only says "the event's assigned coordinator".
--   (3) a coordinator changes a request through update_equipment_request() (migration 45), which is security definer.
--   (4) a new 'requested' row in their own name that nobody has reviewed. Nothing in the app writes this table yet; this
--       is the smallest shape that fits the roles, for the story that builds the screen to revisit.
--
-- Nobody deletes a reservation or a technical support request through the API: every function that releases or changes
-- reservations (reserve_equipment, review_equipment_request, update_equipment_request, change_venue_booking,
-- cancel_venue_booking, update_event_details, venue_booking_take_over) is security definer and only inserts or updates, and
-- rows still go with their event (on delete cascade runs as the table owner). equipment_free_units() is security definer,
-- so a coordinator's "Available 4 / need 6" still counts other events' holds while the rows themselves are hidden from them.
--
-- The event lookups use is_assigned_coordinator() and is_event_organiser() (migration 07), never a subquery on events.
-- Affects equipment-service (readers run as the caller), event-service (arrangementImpact reads as the assigned
-- coordinator) and the auth-service technical support dashboard.

-- ============================================================================
-- EQUIPMENT RESERVATIONS
-- ============================================================================

drop policy equipment_reservations_authenticated_all on equipment_reservations;

create policy equipment_reservations_select on equipment_reservations
  for select to authenticated
  using (
    public.current_user_role() = 'technical_support_staff'
    or public.is_assigned_coordinator(event_id)
    or public.is_event_organiser(event_id)
  );

-- Permissive companions to the restrictive insert (25) and update (32) policies, which need one to exist.
create policy equipment_reservations_insert_coordinator on equipment_reservations
  for insert to authenticated
  with check (public.is_assigned_coordinator(event_id));

create policy equipment_reservations_update_technical_support_staff on equipment_reservations
  for update to authenticated
  using (public.current_user_role() = 'technical_support_staff')
  with check (public.current_user_role() = 'technical_support_staff');

revoke delete on equipment_reservations from authenticated, anon;

-- ============================================================================
-- TECHNICAL SUPPORT REQUESTS
-- ============================================================================

drop policy technical_support_requests_authenticated_all on technical_support_requests;

create policy technical_support_requests_select on technical_support_requests
  for select to authenticated
  using (
    public.current_user_role() = 'technical_support_staff'
    or public.is_assigned_coordinator(event_id)
  );

create policy technical_support_requests_insert_coordinator on technical_support_requests
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_coordinator'
    and public.is_assigned_coordinator(event_id)
    and status = 'requested'
    and requested_by = auth.uid()
    and reviewed_by is null
    and reviewed_at is null
  );

create policy technical_support_requests_update_technical_support on technical_support_requests
  for update to authenticated
  using (public.current_user_role() = 'technical_support_staff')
  with check (public.current_user_role() = 'technical_support_staff');

revoke delete on technical_support_requests from authenticated, anon;

-- anon never had a policy; keep its write privileges off so that stays true if one is ever added
revoke insert, update on equipment_reservations, technical_support_requests from anon;

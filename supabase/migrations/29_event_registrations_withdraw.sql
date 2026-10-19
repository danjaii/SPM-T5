-- ConnectSphere: withdrawing an event registration, for SCRUM-73 (Withdraw from an event)
-- Follows 28_multiple_venue_bookings.sql
--
-- 11_event_registrations.sql allowed no updates ("withdrawal is a later story"), so RLS silently changed no row when
-- POST /events/my-registrations/:id/withdraw (event-service) set a registration to 'withdrawn'.
--
-- Affects event-service (POST /events/my-registrations/:id/withdraw). No other service writes event_registrations.

drop policy if exists event_registrations_withdraw on event_registrations;

create policy event_registrations_withdraw on event_registrations
  for update to authenticated
  -- SCRUM-73/AC1: only the attendee's own registration. The event's organiser and coordinator can see its
  -- registrations (11's select policy), but withdrawing is the attendee's decision, not theirs
  -- SCRUM-73/AC2: and only an active one: Confirmed (registered) or Pending (waitlisted), not Rejected or Withdrawn
  using (attendee_id = auth.uid() and status in ('registered', 'waitlisted'))
  -- SCRUM-73/AC6: the only change is to Withdrawn, so an attendee can't confirm themselves (as 11's insert policy
  -- refuses a registration inserted as Confirmed)
  -- SCRUM-73/AC1: and it stays the attendee's own, so a withdrawn registration can't be moved into someone else's
  -- history. 11's select policy happens to refuse that too, but this policy shouldn't depend on who may read rows
  with check (attendee_id = auth.uid() and status = 'withdrawn');

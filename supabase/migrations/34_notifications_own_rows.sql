-- ConnectSphere: own-rows Row Level Security for notifications (SCRUM-46)
-- Follows 30_change_cancel_venue_booking.sql
--
-- 02_rls.sql gave notifications one blanket policy (any authenticated user, full access), so any signed-in
-- user could read, rewrite or delete anyone's notifications. This replaces it, in the style of
-- 07_venue_bookings_rls.sql. The service-role key still bypasses RLS, so seed.sql and producers (SCRUM-47, SCRUM-106)
-- that write rows are unaffected.
--
-- Role matrix (the same for every role: notifications are personal, so no role sees another user's):
--
--   SELECT  every signed-in role: only rows where user_id = auth.uid().
--   INSERT  nobody through the API. Producers use the service role, or `security definer` SQL such as a trigger on
--           the domain table, which writes the row in the same transaction as the change it announces.
--   UPDATE  every signed-in role: only their own rows, and only the is_read column, and only to true. A
--           notification can be marked read but never un-read, and title, message and owner cannot be rewritten.
--   DELETE  nobody through the API.
--   anon    nothing.
--
-- New columns:
--   read_at           when the row was first read; set by the trigger below, never by the caller.
--   venue_booking_id  a typed link to a venue booking (nullable, cascades with the booking), next to the existing
--                     event_id. A foreign key rather than a free-text URL, so a link cannot point anywhere the
--                     producer did not mean. notification-service checks the caller can still see the target (AC7).
--
-- Affects notification-service (new in SCRUM-46), which reads and updates as the caller. Nothing else in services/
-- reads or writes notifications. This closes notifications for the per-role RLS work (SCRUM-91, 92, 93).

-- ============================================================================
-- COLUMNS AND INDEX
-- ============================================================================
alter table notifications
  add column if not exists read_at timestamptz,
  add column if not exists venue_booking_id uuid references venue_bookings(id) on delete cascade;

-- Rows already marked read (the seed) get a read time, so the invariant "read means read_at is set" holds.
update notifications set read_at = created_at where is_read and read_at is null;

-- The list is "my notifications, newest first"; the old index was on (user_id, is_read).
create index if not exists idx_notifications_user_created on notifications(user_id, created_at desc);

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
-- RLS decides which rows; it cannot stop an allowed update from also rewriting the message. As in
-- 03_users_role_privilege.sql and 07_venue_bookings_rls.sql, narrow the grants to what the API really does.
revoke insert, update, delete on notifications from authenticated, anon;
revoke select on notifications from anon;
grant update (is_read) on notifications to authenticated;

-- ============================================================================
-- POLICIES
-- ============================================================================
drop policy if exists notifications_authenticated_all on notifications;
drop policy if exists notifications_select_own on notifications;
drop policy if exists notifications_update_own on notifications;

create policy notifications_select_own on notifications
  for select to authenticated
  using (user_id = auth.uid());

-- with check ... and is_read: the only change a caller can make is to mark their own row read.
create policy notifications_update_own on notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_read);

-- ============================================================================
-- TRIGGER: read_at
-- ============================================================================
-- Records when a notification was first read, whoever marked it (the caller, or the service role).
create or replace function public.notifications_set_read_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_read and not old.is_read then
    new.read_at := coalesce(new.read_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_set_read_at on notifications;
create trigger notifications_set_read_at
  before update on notifications
  for each row execute function public.notifications_set_read_at();

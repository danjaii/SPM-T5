-- ConnectSphere: stop users editing users.role
-- Follows 02_rls.sql
--
-- 02_rls.sql's users_authenticated_all policy is "for all ... using (true)
-- with check (true)", so today any authenticated user can UPDATE any row in
-- users, including setting role to whatever they like — a privilege
-- escalation bug flagged in CLAUDE.md's "Known gaps".
--
-- Row Level Security policies decide which ROWS a client can touch; they
-- can't express "this column is off-limits regardless of row". Column-level
-- privileges are the right tool for that, so this migration narrows the
-- authenticated role's UPDATE grant on users down to the columns a user may
-- legitimately self-edit. role (and email/organisation_id/department/
-- is_active) become unwritable by anon/authenticated entirely; changing them
-- must go through auth-service with the service-role key, which bypasses
-- RLS and table/column grants alike.
--
-- This intentionally does not touch which ROWS are editable (still any row,
-- per 02_rls.sql) — replacing that blanket row access with per-role/own-row
-- policies is the separate, larger gap already tracked in CLAUDE.md.

revoke update on users from authenticated;

grant update (
  full_name,
  phone,
  communication_preferences
) on users to authenticated;

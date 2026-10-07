-- Week 7 customer changes (docs/specs/user-profile.md, SCRUM-69): two new internal roles.
--   event_coordinator_lead  oversees incoming event requests and assigns them to Event Coordinators (change 5)
--   safety_officer          reviews the operational safety of planned events (change 6)
-- They are added to the same list as the existing roles, so the shared ROLES list (packages/shared/src/roles.ts) and the
-- database agree. A new enum value cannot be used in the same transaction that adds it, so this file only adds the values:
-- accounts, departments and the access rules for these roles belong to their own stories.
-- Affects every service that reads users.role. Nothing existing changes: no current account has either role.

alter type user_role add value if not exists 'event_coordinator_lead';
alter type user_role add value if not exists 'safety_officer';

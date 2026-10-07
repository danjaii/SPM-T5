-- SCRUM-69 (docs/specs/user-profile.md): what each internal role is responsible for, shown on the profile page.
-- Stored once for each role, not for each person: a staff member's profile shows their own department (users.department) and
-- the responsibilities of their role (this table). Like event_categories and room_layouts, it is a lookup list, so the wording can
-- change without a new release. Nobody changes it through the app: a signed-in user can only read it.
-- Needs migration 16 (it uses the two new roles). External roles (event_organiser, attendee) have no rows.
-- The wording follows the Week 1 Customer Briefing (the "Main Responsibility" table and the event planning process) and the
-- customer's week 7 changes (changes 5 and 6).
-- Whoever creates accounts for a role must make sure the role has rows here, or the profile says "Not recorded".

create table if not exists role_responsibilities (
  id          uuid primary key default gen_random_uuid(),
  role        user_role not null,
  position    integer not null,       -- the order they are listed in, from 1
  description text not null,
  unique (role, position)
);

alter table role_responsibilities enable row level security;

-- Any signed-in user may read the list. There is no policy for insert, update or delete, so nobody can change it through the API.
drop policy if exists role_responsibilities_read on role_responsibilities;
create policy role_responsibilities_read on role_responsibilities for select to authenticated using (true);

revoke all on role_responsibilities from anon, authenticated;
grant select on role_responsibilities to authenticated;

insert into role_responsibilities (role, position, description) values
  ('event_coordinator', 1, 'Act as the main internal point of contact for the events assigned to them'),
  ('event_coordinator', 2, 'Review event requests, ask for clarification or amendments, and approve or reject them'),
  ('event_coordinator', 3, 'Search for venues and submit venue booking requests'),
  ('event_coordinator', 4, 'Monitor the outstanding arrangements and confirm the event'),
  ('event_coordinator', 5, 'Review the changes an Event Organiser requests'),

  ('event_coordinator_lead', 1, 'Oversee the incoming event requests waiting to be assigned'),
  ('event_coordinator_lead', 2, 'Review basic event information and assign a suitable Event Coordinator'),
  ('event_coordinator_lead', 3, 'Reassign events where necessary'),
  ('event_coordinator_lead', 4, 'View all coordinator assignments and the active events under their supervision'),

  ('venue_staff', 1, 'Maintain the venue catalogue and the layouts each venue supports'),
  ('venue_staff', 2, 'Mark venues unavailable (maintenance, renovation, safety or other operational reasons)'),
  ('venue_staff', 3, 'Approve or reject venue booking requests, with a reason or an alternative'),
  ('venue_staff', 4, 'Prepare venues for events'),

  ('technical_support_staff', 1, 'Maintain the equipment catalogue and its operational status'),
  ('technical_support_staff', 2, 'Check whether enough suitable equipment is available for an event''s date and time'),
  ('technical_support_staff', 3, 'Reserve equipment for events'),
  ('technical_support_staff', 4, 'Provide technical support for events, where assigned'),

  ('safety_officer', 1, 'Review the operational safety of planned events once the venue and technical arrangements are confirmed'),
  ('safety_officer', 2, 'Consider attendance, venue capacity and layout, emergency access, accessibility, equipment placement, crowd movement and venue restrictions'),
  ('safety_officer', 3, 'Approve the event, reject the safety arrangement, or request changes')
on conflict (role, position) do nothing;

-- ask PostgREST to pick up the new table straight away (harmless if it already has)
notify pgrst, 'reload schema';

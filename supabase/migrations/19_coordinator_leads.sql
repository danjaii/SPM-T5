-- SCRUM-75/AC5 (docs/specs/event-coordinator-lead-role.md): each Event Coordinator can be linked to the one Event Coordinator
-- Lead who supervises them. A Lead can supervise any number of coordinators.
--
-- One nullable column on users, so "one Lead per coordinator" holds by construction. A trigger makes sure a link only ever
-- goes from an event_coordinator to an event_coordinator_lead (a foreign key cannot check the role on either side).
-- Links are set up by an admin or seed data: 03_users_role_privilege.sql limits what signed-in users may update on users to
-- their own name, phone and preferences, and this file does not widen that, so nobody can change a link through the API.
-- Affects every service that reads users (event-service uses it for the Lead features). No existing row changes.

alter table users
  add column if not exists supervising_lead_id uuid references users(id) on delete set null;

create index if not exists idx_users_supervising_lead on users(supervising_lead_id);

create or replace function public.users_lead_link_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.supervising_lead_id is null then
    return new;
  end if;
  if new.role <> 'event_coordinator' then
    raise exception 'Only an Event Coordinator can be linked to an Event Coordinator Lead'
      using errcode = '23514';
  end if;
  if not exists (select 1 from users where id = new.supervising_lead_id and role = 'event_coordinator_lead') then
    raise exception 'A coordinator can only be linked to an Event Coordinator Lead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_lead_link_guard on users;
create trigger trg_users_lead_link_guard
  before insert or update of supervising_lead_id, role on users
  for each row execute function public.users_lead_link_guard();

-- Initial schema for ConnectSphere
create type user_role as enum (
  'event_organiser',
  'event_coordinator',
  'venue_staff',
  'technical_support',
  'attendee'
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text,
  created_at timestamptz not null default now()
);

create type event_status as enum ('draft', 'submitted', 'in_review', 'approved', 'rejected');

create table events (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references profiles(id),
  coordinator_id uuid references profiles(id),
  name text not null,
  purpose text,
  description text,
  proposed_start timestamptz,
  proposed_end timestamptz,
  expected_attendance integer,
  status event_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table events enable row level security;

-- Example RLS: organisers see only their own events; coordinators see submitted+ events.
create policy "organisers manage own events"
  on events for all
  using (organiser_id = auth.uid());

create policy "coordinators view submitted events"
  on events for select
  using (
    status != 'draft'
    and exists (
      select 1 from profiles
      where profiles.id = auth.uid() and profiles.role = 'event_coordinator'
    )
  );

-- ConnectSphere Event Planning and Venue Booking System
-- Initial schema migration
-- Target: Supabase (Postgres 15+)
--
-- Conventions used throughout:
--   * Primary keys are uuid, generated with gen_random_uuid() (pgcrypto, enabled by default on Supabase).
--   * Fixed workflows (statuses that the app's state machine controls) are Postgres ENUMs.
--   * Values the customer said they can extend later ("or any other type defined by
--     ConnectSphere") are lookup tables instead of enums, so new rows do not need a migration.
--   * public.users.id is a foreign key onto auth.users(id), the Supabase-managed auth table.
--     This migration does not create auth.users; Supabase already provides it.
--   * updated_at columns are kept current by the set_updated_at() trigger defined at the bottom
--     of the "helper functions" section.

create extension if not exists pgcrypto;

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

create type user_role as enum (
  'event_organiser',
  'event_coordinator',
  'venue_staff',
  'technical_support_staff',
  'attendee'
);

create type event_status as enum (
  'draft',
  'submitted',
  'under_review',
  'returned',            -- sent back to organiser for amendment
  'approved',
  'planning',
  'awaiting_arrangements',
  'confirmed',
  'completed',
  'cancelled',
  'rejected'
);

create type venue_booking_status as enum (
  'requested',
  'tentative',
  'approved',
  'confirmed',
  'rejected',
  'cancelled'
);

create type venue_unavailability_reason as enum (
  'maintenance',
  'renovation',
  'safety',
  'internal_activity',
  'other'
);

create type equipment_operational_status as enum (
  'available',
  'damaged',
  'under_maintenance',
  'retired'
);

create type equipment_reservation_status as enum (
  'requested',
  'approved',
  'rejected',
  'reserved',
  'cancelled'
);

create type technical_support_status as enum (
  'requested',
  'in_review',
  'confirmed',
  'unavailable',
  'cancelled'
);

create type change_request_status as enum (
  'pending',
  'approved',
  'rejected'
);

create type registration_status as enum (
  'registered',
  'waitlisted',
  'withdrawn',
  'cancelled'
);

create type attendance_status as enum (
  'pending',
  'attended',
  'no_show'
);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- IDENTITY
-- ============================================================================

create table organisations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  industry          text,
  contact_email     text,
  contact_phone     text,
  address           text,
  created_at        timestamptz not null default now()
);

-- Extends Supabase's auth.users with profile and role data.
-- Every ConnectSphere user (internal or external, including attendees) has a row here.
create table users (
  id                      uuid primary key references auth.users(id) on delete cascade,
  role                    user_role not null,
  full_name               text not null,
  email                   text not null unique,
  phone                   text,
  organisation_id         uuid references organisations(id),  -- populated for event_organiser
  department              text,                                -- populated for internal staff
  communication_preferences jsonb not null default '{}'::jsonb,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

create index idx_users_role on users(role);
create index idx_users_organisation on users(organisation_id);

-- ============================================================================
-- LOOKUP TABLES (customer-extensible)
-- ============================================================================

create table event_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text,
  is_active     boolean not null default true
);

create table room_layouts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text,
  is_active     boolean not null default true
);

create table facilities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text
);

-- ============================================================================
-- VENUES
-- ============================================================================

create table venues (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  address               text not null,
  description           text,
  max_capacity          int not null check (max_capacity > 0),
  operating_hours_start time,
  operating_hours_end   time,
  is_accessible         boolean not null default false,
  accessibility_notes   text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

create table venue_supported_layouts (
  id                      uuid primary key default gen_random_uuid(),
  venue_id                uuid not null references venues(id) on delete cascade,
  room_layout_id          uuid not null references room_layouts(id),
  max_capacity_for_layout int not null check (max_capacity_for_layout > 0),
  unique (venue_id, room_layout_id)
);

create table venue_facilities (
  venue_id      uuid not null references venues(id) on delete cascade,
  facility_id   uuid not null references facilities(id) on delete cascade,
  primary key (venue_id, facility_id)
);

create table venue_unavailability (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id) on delete cascade,
  start_datetime  timestamptz not null,
  end_datetime    timestamptz not null,
  reason          venue_unavailability_reason not null,
  notes           text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  check (end_datetime > start_datetime)
);

create index idx_venue_unavailability_venue_range on venue_unavailability(venue_id, start_datetime, end_datetime);

-- ============================================================================
-- EVENTS
-- ============================================================================

create table events (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  description                 text,
  purpose                     text,
  event_category_id           uuid references event_categories(id),
  client_organisation_id      uuid references organisations(id),
  organiser_id                uuid not null references users(id),
  assigned_coordinator_id     uuid references users(id),
  status                      event_status not null default 'draft',
  is_draft                    boolean not null default true,
  preferred_start_datetime    timestamptz,
  preferred_end_datetime      timestamptz,
  expected_attendance         int check (expected_attendance >= 0),
  preferred_room_layout_id    uuid references room_layouts(id),
  accessibility_requirements  text,
  equipment_requirements_notes text,
  registration_required       boolean not null default false,
  registration_capacity       int check (registration_capacity >= 0),
  registration_opens_at       timestamptz,
  registration_closes_at      timestamptz,
  cloned_from_event_id        uuid references events(id),
  submitted_at                timestamptz,
  confirmed_at                timestamptz,
  cancelled_at                timestamptz,
  completed_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (preferred_end_datetime is null or preferred_end_datetime > preferred_start_datetime),
  check (registration_closes_at is null or registration_opens_at is null or registration_closes_at > registration_opens_at)
);

create trigger trg_events_updated_at
  before update on events
  for each row execute function set_updated_at();

create index idx_events_status on events(status);
create index idx_events_organiser on events(organiser_id);
create index idx_events_coordinator on events(assigned_coordinator_id);
create index idx_events_client_org on events(client_organisation_id);
create index idx_events_preferred_start on events(preferred_start_datetime);

create table event_status_history (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  old_status    event_status,
  new_status    event_status not null,
  changed_by    uuid references users(id),
  reason        text,
  changed_at    timestamptz not null default now()
);

create index idx_event_status_history_event on event_status_history(event_id);

create table event_coordinator_history (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  coordinator_id  uuid not null references users(id),
  assigned_by     uuid references users(id),
  assigned_at     timestamptz not null default now(),
  unassigned_at   timestamptz
);

create index idx_event_coordinator_history_event on event_coordinator_history(event_id);

create table event_sessions (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  session_name  text not null,
  session_date  date not null,
  start_time    time not null,
  end_time      time not null,
  sequence_no   int not null,
  description   text,
  check (end_time > start_time)
);

create index idx_event_sessions_event on event_sessions(event_id);

create table event_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  requested_by        uuid not null references users(id),
  change_description  text not null,
  proposed_changes    jsonb,
  status              change_request_status not null default 'pending',
  reviewed_by         uuid references users(id),
  review_notes        text,
  requested_at        timestamptz not null default now(),
  reviewed_at         timestamptz
);

create index idx_event_change_requests_event on event_change_requests(event_id);

create table event_comments (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  author_id           uuid not null references users(id),
  parent_comment_id   uuid references event_comments(id) on delete cascade,
  comment_text        text not null,
  created_at          timestamptz not null default now()
);

create index idx_event_comments_event on event_comments(event_id);

create table event_documents (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  uploaded_by   uuid references users(id),
  file_name     text not null,
  file_url      text not null,
  file_type     text,
  description   text,
  uploaded_at   timestamptz not null default now()
);

create index idx_event_documents_event on event_documents(event_id);

-- ============================================================================
-- VENUE BOOKINGS
-- ============================================================================

create table venue_bookings (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references events(id) on delete cascade,
  venue_id                uuid not null references venues(id),
  requested_by            uuid references users(id),
  reviewed_by             uuid references users(id),
  status                  venue_booking_status not null default 'requested',
  setup_start_datetime    timestamptz,
  event_start_datetime    timestamptz not null,
  event_end_datetime      timestamptz not null,
  teardown_end_datetime   timestamptz,
  review_notes            text,
  created_at              timestamptz not null default now(),
  reviewed_at             timestamptz,
  check (event_end_datetime > event_start_datetime),
  check (setup_start_datetime is null or setup_start_datetime <= event_start_datetime),
  check (teardown_end_datetime is null or teardown_end_datetime >= event_end_datetime)
);

create index idx_venue_bookings_venue_range on venue_bookings(venue_id, event_start_datetime, event_end_datetime);
create index idx_venue_bookings_event on venue_bookings(event_id);
create index idx_venue_bookings_status on venue_bookings(status);

-- ============================================================================
-- EQUIPMENT AND TECHNICAL SUPPORT
-- ============================================================================

create table equipment (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  type                text,
  description         text,
  total_quantity      int not null check (total_quantity >= 0),
  location            text,
  operational_status  equipment_operational_status not null default 'available',
  created_at          timestamptz not null default now()
);

create table equipment_reservations (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  equipment_id        uuid not null references equipment(id),
  quantity_requested  int not null check (quantity_requested > 0),
  quantity_reserved   int check (quantity_reserved >= 0),
  status              equipment_reservation_status not null default 'requested',
  requested_by        uuid references users(id),
  reviewed_by         uuid references users(id),
  start_datetime      timestamptz not null,
  end_datetime        timestamptz not null,
  notes               text,
  created_at          timestamptz not null default now(),
  check (end_datetime > start_datetime)
);

create index idx_equipment_reservations_equipment_range on equipment_reservations(equipment_id, start_datetime, end_datetime);
create index idx_equipment_reservations_event on equipment_reservations(event_id);

create table technical_support_requests (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  description   text not null,
  status        technical_support_status not null default 'requested',
  requested_by  uuid references users(id),
  reviewed_by   uuid references users(id),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);

create index idx_technical_support_requests_event on technical_support_requests(event_id);

create table technical_staff_assignments (
  id                            uuid primary key default gen_random_uuid(),
  technical_support_request_id  uuid not null references technical_support_requests(id) on delete cascade,
  staff_id                      uuid not null references users(id),
  assigned_by                   uuid references users(id),
  role_note                     text,
  start_datetime                timestamptz,
  end_datetime                  timestamptz,
  assigned_at                   timestamptz not null default now()
);

create index idx_technical_staff_assignments_request on technical_staff_assignments(technical_support_request_id);
create index idx_technical_staff_assignments_staff on technical_staff_assignments(staff_id);

-- ============================================================================
-- REGISTRATION
-- ============================================================================

create table event_registrations (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references events(id) on delete cascade,
  attendee_id           uuid not null references users(id),
  status                registration_status not null default 'registered',
  attendance_status     attendance_status not null default 'pending',
  waitlist_position     int,
  registered_at         timestamptz not null default now(),
  withdrawn_at          timestamptz,
  registration_details  jsonb,
  unique (event_id, attendee_id)
);

create index idx_event_registrations_event on event_registrations(event_id);
create index idx_event_registrations_attendee on event_registrations(attendee_id);
create index idx_event_registrations_status on event_registrations(event_id, status);

-- ============================================================================
-- CROSS CUTTING: NOTIFICATIONS AND AUDIT
-- ============================================================================

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  event_id      uuid references events(id) on delete cascade,
  type          text not null,
  title         text not null,
  message       text not null,
  is_read       boolean not null default false,
  created_at    timestamptz not null default now()
);

create index idx_notifications_user on notifications(user_id, is_read);

create table activity_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references users(id),
  action_type   text not null,
  entity_type   text not null,
  entity_id     uuid not null,
  description   text,
  created_at    timestamptz not null default now()
);

create index idx_activity_log_entity on activity_log(entity_type, entity_id);
create index idx_activity_log_actor on activity_log(actor_id);

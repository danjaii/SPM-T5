-- ConnectSphere: tables, storage and per-role RLS for event review (SCRUM-25 to 28, 42, 43)
-- Follows 07_venue_bookings_rls.sql
--
-- event-service's review routes read and write three tables that no migration created, and a storage
-- bucket that did not exist. This adds them, and replaces event_comments' blanket policy
-- (02_rls.sql) with per-role policies. Other tables keep their blanket policies.
--
--   event_comment_mentions      who a comment @mentions (SCRUM-27)
--   event_comment_attachments   files attached to a comment; the file is in the event-attachments
--                               bucket at <event_id>/<anything> (SCRUM-28)
--   coordinator_assignment_logs one row per (re)assignment of an event's coordinator (SCRUM-42/43)
--
-- Who may see and write review data (the same people the routes already allow):
--   SELECT  any event_coordinator, and the organiser of that event.
--   INSERT  the same people, as themselves. A mention must target someone who can see the event.
--           Assignment logs: event_coordinator only.
--   UPDATE / DELETE  nobody through the API. Comments, mentions, attachments and the assignment
--           history are append-only records (SCRUM-43/AC4 preserves history).
--
-- The service-role key still bypasses RLS. Affects event-service only; no existing table changes.
-- event_comments keeps its column name comment_text (01_schema.sql): the routes must use it.

-- ============================================================================
-- HELPERS
-- ============================================================================
-- security definer so the lookups are not themselves filtered by RLS (and cannot recurse into the
-- policies that call them); search_path is pinned. Same pattern as 07.

-- Can this user see an event's review data: any coordinator, or the event's own organiser?
create or replace function public.user_can_access_event(p_user uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_user
      and (
        u.role = 'event_coordinator'
        or (u.role = 'event_organiser'
            and exists (select 1 from public.events e where e.id = p_event_id and e.organiser_id = u.id))
      )
  )
$$;

create or replace function public.comment_event_id(p_comment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.event_id from public.event_comments c where c.id = p_comment_id
$$;

create or replace function public.is_comment_author(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.event_comments c where c.id = p_comment_id and c.author_id = auth.uid()
  )
$$;

-- The event id in a storage path "<event_id>/<file>", or null if the first folder is not a uuid.
-- A CASE guards the cast so a malformed path yields null instead of an error.
create or replace function public.storage_path_event_id(p_name text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end
$$;

revoke execute on function public.user_can_access_event(uuid, uuid) from public, anon;
revoke execute on function public.comment_event_id(uuid) from public, anon;
revoke execute on function public.is_comment_author(uuid) from public, anon;
revoke execute on function public.storage_path_event_id(text) from public, anon;
grant execute on function public.user_can_access_event(uuid, uuid) to authenticated;
grant execute on function public.comment_event_id(uuid) to authenticated;
grant execute on function public.is_comment_author(uuid) to authenticated;
grant execute on function public.storage_path_event_id(text) to authenticated;

-- ============================================================================
-- TABLES
-- ============================================================================

create table event_comment_mentions (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references event_comments(id) on delete cascade,
  user_id     uuid not null references users(id),
  created_at  timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index idx_event_comment_mentions_comment on event_comment_mentions(comment_id);
create index idx_event_comment_mentions_user on event_comment_mentions(user_id);

create table event_comment_attachments (
  id            uuid primary key default gen_random_uuid(),
  comment_id    uuid not null references event_comments(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

create index idx_event_comment_attachments_comment on event_comment_attachments(comment_id);

create table coordinator_assignment_logs (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null references events(id) on delete cascade,
  coordinator_id            uuid not null references users(id),
  previous_coordinator_id   uuid references users(id),
  assigned_by               uuid not null references users(id),
  assigned_at               timestamptz not null default now()
);

create index idx_coordinator_assignment_logs_event on coordinator_assignment_logs(event_id, assigned_at);

-- ============================================================================
-- PRIVILEGES
-- ============================================================================
-- Append-only: no UPDATE or DELETE for signed-in users or anon, on the new tables and on comments.

revoke update, delete on event_comments, event_comment_mentions, event_comment_attachments,
  coordinator_assignment_logs from authenticated, anon;

-- ============================================================================
-- POLICIES
-- ============================================================================

alter table event_comment_mentions enable row level security;
alter table event_comment_attachments enable row level security;
alter table coordinator_assignment_logs enable row level security;

drop policy if exists event_comments_authenticated_all on event_comments;

create policy event_comments_select on event_comments
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), event_id));

-- A comment is written in the caller's own name, and a reply must sit in the same event as its
-- parent (otherwise a reply could surface inside an event the parent's author never saw).
create policy event_comments_insert on event_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.user_can_access_event(auth.uid(), event_id)
    and (parent_comment_id is null or public.comment_event_id(parent_comment_id) = event_id)
  );

create policy event_comment_mentions_select on event_comment_mentions
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), public.comment_event_id(comment_id)));

-- SCRUM-27/AC5: only the comment's author adds mentions, and only of someone who can see the event.
create policy event_comment_mentions_insert on event_comment_mentions
  for insert to authenticated
  with check (
    public.is_comment_author(comment_id)
    and public.user_can_access_event(user_id, public.comment_event_id(comment_id))
  );

create policy event_comment_attachments_select on event_comment_attachments
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), public.comment_event_id(comment_id)));

-- The file must live under the comment's own event folder, so it is covered by the storage policy.
create policy event_comment_attachments_insert on event_comment_attachments
  for insert to authenticated
  with check (
    public.is_comment_author(comment_id)
    and public.storage_path_event_id(storage_path) = public.comment_event_id(comment_id)
  );

create policy coordinator_assignment_logs_select on coordinator_assignment_logs
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), event_id));

create policy coordinator_assignment_logs_insert on coordinator_assignment_logs
  for insert to authenticated
  with check (
    public.current_user_role() = 'event_coordinator'
    and assigned_by = auth.uid()
  );

-- ============================================================================
-- STORAGE: event-attachments bucket (SCRUM-28)
-- ============================================================================
-- Private bucket; files are read through signed URLs. SCRUM-28/AC4-AC6: images, video and common
-- documents are accepted, anything else is rejected, and 10 MB is the largest file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-attachments',
  'event-attachments',
  false,
  10485760,
  array[
    'image/*',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do nothing;

create policy event_attachments_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-attachments'
    and public.user_can_access_event(auth.uid(), public.storage_path_event_id(name))
  );

create policy event_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-attachments'
    and public.user_can_access_event(auth.uid(), public.storage_path_event_id(name))
  );

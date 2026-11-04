-- ConnectSphere: supporting documents on an event request (SCRUM-51). Affects event-service and apps/web.
--
-- Files go in the existing private bucket event-attachments (migration 08, SCRUM-28), in the folder "<event id>/...". This table
-- is the list of what is attached to a request. As with events (see 62_event_draft_update_definer.sql), authenticated has no
-- write privilege on it: a row is written only by add_event_attachment() and removed only by remove_event_attachment(), which
-- check the caller themselves (an event organiser, their own request, still a draft; Week 9: organisers cannot edit a submitted
-- request). The same SQLSTATEs as the draft functions: DR001 not the caller's request or not found, DR002 not a draft any more.
-- AT001: the storage path is not in the request's own folder. AT002: a file type that is not accepted. AT003: a file over 10 MB (10485760 bytes, the bucket's file_size_limit).
-- AT004: no such attachment on that request.

create table event_request_attachments (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  file_name     text not null check (btrim(file_name) <> ''),
  storage_path  text not null unique,
  content_type  text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  uploaded_by   uuid not null references users(id),
  created_at    timestamptz not null default now()
);

create index idx_event_request_attachments_event on event_request_attachments(event_id);

alter table event_request_attachments enable row level security;

-- Same readers as the files themselves (08): the event's own organiser and coordinators.
create policy event_request_attachments_select on event_request_attachments
  for select to authenticated
  using (public.user_can_access_event(auth.uid(), event_id));

revoke all on event_request_attachments from anon, authenticated;
grant select on event_request_attachments to authenticated;

-- SCRUM-51/AC2: the types the event-attachments bucket accepts (08; packages/shared/src/attachments.ts is the same list)
create function public.is_attachment_type_allowed(p_type text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(coalesce(p_type, '')) ~ '^image/.+'
    or lower(coalesce(p_type, '')) = any (array[
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
    ])
$$;

create function public.add_event_attachment(
  p_event_id     uuid,
  p_file_name    text,
  p_storage_path text,
  p_content_type text,
  p_size_bytes   bigint
)
returns event_request_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_row   event_request_attachments;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'event_organiser' then
    raise exception 'Only an event organiser can attach files to a request' using errcode = '42501';
  end if;

  select * into v_event from events where id = p_event_id and organiser_id = auth.uid() for update;
  if not found then
    raise exception 'Draft not found' using errcode = 'DR001';
  end if;
  if v_event.status is distinct from 'draft' or v_event.is_draft is not true then
    raise exception 'This request has already been submitted' using errcode = 'DR002';
  end if;

  -- the file must sit in this request's own folder, the one the storage policies check
  if public.storage_path_event_id(p_storage_path) is distinct from p_event_id then
    raise exception 'The file is not in this request''s folder' using errcode = 'AT001';
  end if;

  if not public.is_attachment_type_allowed(p_content_type) then
    raise exception 'This file type is not supported' using errcode = 'AT002';
  end if;

  if p_size_bytes > 10485760 then
    raise exception 'This file is larger than the 10 MB limit' using errcode = 'AT003';
  end if;

  insert into event_request_attachments (event_id, file_name, storage_path, content_type, size_bytes, uploaded_by)
  values (p_event_id, btrim(p_file_name), p_storage_path, p_content_type, p_size_bytes, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_event_attachment(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.add_event_attachment(uuid, text, text, text, bigint) to authenticated;

-- SCRUM-51/AC4: remove an attachment from a request that is still the caller's own draft. Returns the removed row so the
-- service can delete the stored file (the row is not readable once gone).
create function public.remove_event_attachment(p_event_id uuid, p_attachment_id uuid)
returns event_request_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event events;
  v_row   event_request_attachments;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'event_organiser' then
    raise exception 'Only an event organiser can remove files from a request' using errcode = '42501';
  end if;

  select * into v_event from events where id = p_event_id and organiser_id = auth.uid() for update;
  if not found then
    raise exception 'Draft not found' using errcode = 'DR001';
  end if;
  if v_event.status is distinct from 'draft' or v_event.is_draft is not true then
    raise exception 'This request has already been submitted' using errcode = 'DR002';
  end if;

  delete from event_request_attachments where id = p_attachment_id and event_id = p_event_id returning * into v_row;
  if not found then
    raise exception 'Attachment not found' using errcode = 'AT004';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.remove_event_attachment(uuid, uuid) from public, anon;
grant execute on function public.remove_event_attachment(uuid, uuid) to authenticated;

-- The stored file goes through the Storage API (a direct delete on storage.objects is not allowed). Only an organiser may delete,
-- and only a file in the folder of their own request that is still a draft.
create function public.user_owns_draft_event(p_user uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.events e
    join public.users u on u.id = e.organiser_id
    where e.id = p_event_id and e.organiser_id = p_user and e.status = 'draft' and e.is_draft and u.role = 'event_organiser'
  )
$$;

revoke execute on function public.user_owns_draft_event(uuid, uuid) from public, anon;
grant execute on function public.user_owns_draft_event(uuid, uuid) to authenticated;

create policy event_attachments_delete_own_draft on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-attachments'
    and public.user_owns_draft_event(auth.uid(), public.storage_path_event_id(name))
  );

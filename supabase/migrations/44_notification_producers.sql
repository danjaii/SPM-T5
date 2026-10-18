-- SCRUM-47 (docs/specs/receive-notifications.md): users receive a notification when something relevant to them happens.
-- Follows 43_safety_request_changes.sql.
--
-- Each notification is written by a trigger in the same transaction as the change it announces (ADR 0002), so a change
-- that fails or rolls back leaves no notification behind.
--
-- 1. notify_coordinator_assignment() (trigger on coordinator_assignment_logs): the coordinator a Lead assigns or
--    reassigns is told they are responsible for the event (AC1).
-- 2. notify_event_decision() (trigger on event_status_history): the organiser is told their request was approved, or
--    rejected with the reason (AC4, AC5); a status set to what it already was is not announced (AC10).
-- 3. event_comments.is_clarification_request, and post_event_comment(), which saves a comment and its mentions together
--    (only the event's coordinator may ask for clarification, 42501). notify_new_comment() (deferred constraint trigger
--    on event_comments) runs at commit and gives each person one notification, the strongest reason first: the
--    organiser's answer to a clarification request (AC3), a clarification request (AC2), a mention (AC6), a reply (AC7);
--    never the comment's author (AC8, AC9).
-- 4. notify_safety_decision() (trigger on safety_checks): the event's coordinator and organiser are told each safety
--    decision, with the reason or the requested changes (AC12, proposed for SCRUM-47 in Jira).
--
-- Affects event-service (comment, decision and assign routes) and notification-service (the notification list). Adds a
-- column, functions and triggers; changes no existing data.

-- ---------------------------------------------------------------------------
-- 1. Coordinator assignment (AC1)
-- ---------------------------------------------------------------------------

create or replace function public.notify_coordinator_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into notifications (user_id, event_id, type, title, message)
  values (new.coordinator_id, new.event_id, 'coordinator_assigned', 'You are responsible for an event',
          (select e.name from events e where e.id = new.event_id));
  return new;
end;
$$;

drop trigger if exists trg_notify_coordinator_assignment on coordinator_assignment_logs;
create trigger trg_notify_coordinator_assignment
  after insert on coordinator_assignment_logs
  for each row execute function public.notify_coordinator_assignment();

-- ---------------------------------------------------------------------------
-- 2. Event request decisions (AC4)
-- ---------------------------------------------------------------------------
-- On event_status_history, not in the route: change_event_status() writes it, and both POST /events/:id/approve and
-- PATCH /events/:id/status call that.

create or replace function public.notify_event_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.new_status is not distinct from new.old_status then
    return new; -- AC10: the status did not change, so nothing happened to announce
  elsif new.new_status = 'approved' then
    insert into notifications (user_id, event_id, type, title, message)
    select e.organiser_id, e.id, 'event_approved', 'Your event request was approved', e.name
    from events e where e.id = new.event_id;
  elsif new.new_status = 'rejected' then
    insert into notifications (user_id, event_id, type, title, message)
    select e.organiser_id, e.id, 'event_rejected', 'Your event request was rejected',
           format('%s was rejected. Reason: %s', e.name, new.reason) -- AC11: the reason
    from events e where e.id = new.event_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_event_decision on event_status_history;
create trigger trg_notify_event_decision
  after insert on event_status_history
  for each row execute function public.notify_event_decision();

-- ---------------------------------------------------------------------------
-- 3. Comments (AC6, AC7, AC8, AC9)
-- ---------------------------------------------------------------------------

-- AC2: the event's coordinator can mark a comment as asking the organiser for clarification
alter table event_comments add column if not exists is_clarification_request boolean not null default false;

-- Saves a comment and its mentions together. security invoker: the caller's own RLS (migration 08) decides whether they
-- may comment and whom they may mention, exactly as when the route inserted them one by one.
create or replace function public.post_event_comment(
  p_event_id uuid,
  p_body text,
  p_parent_comment_id uuid default null,
  p_mentions uuid[] default '{}',
  p_clarification_request boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_comment_id uuid;
begin
  -- AC2: only the coordinator responsible for the event asks its organiser for clarification
  if p_clarification_request
     and not exists (select 1 from events e where e.id = p_event_id and e.assigned_coordinator_id = auth.uid()) then
    raise exception 'Only the event''s coordinator can ask for clarification' using errcode = '42501';
  end if;

  insert into event_comments (event_id, author_id, comment_text, parent_comment_id, is_clarification_request)
  values (p_event_id, auth.uid(), p_body, p_parent_comment_id, p_clarification_request)
  returning id into v_comment_id;

  insert into event_comment_mentions (comment_id, user_id)
  select v_comment_id, m from unnest(p_mentions) m;

  return v_comment_id;
end;
$$;

revoke execute on function public.post_event_comment(uuid, text, uuid, uuid[], boolean) from public, anon;
grant execute on function public.post_event_comment(uuid, text, uuid, uuid[], boolean) to authenticated;

-- AC2, AC6, AC7, AC9: the organiser asked for clarification, everyone mentioned, and the author of the comment replied to
-- each get one notification, the highest-ranked reason: clarification, then mention, then reply. Never the comment's own
-- author (AC8).
create or replace function public.notify_new_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message text := new.comment_text;
  v_mention record;
begin
  -- AC6: the comment stores a mention as "@[userId]"; the notification shows "@Full Name", as the comments section does
  for v_mention in
    select m.user_id, u.full_name from event_comment_mentions m join users u on u.id = m.user_id where m.comment_id = new.id
  loop
    v_message := replace(v_message, '@[' || v_mention.user_id || ']', '@' || coalesce(v_mention.full_name, 'Unknown user'));
  end loop;

  insert into notifications (user_id, event_id, type, title, message)
  select best.user_id, new.event_id, k.type, k.title, v_message
  from (
    select r.user_id, max(r.rank) as rank
    from (
      select m.user_id, 2 as rank from event_comment_mentions m where m.comment_id = new.id
      union all
      select p.author_id, 1 from event_comments p where p.id = new.parent_comment_id
      union all
      select e.organiser_id, 3 from events e where e.id = new.event_id and new.is_clarification_request
      union all
      -- AC3: an answer to a clarification request goes to the coordinator responsible for the event
      select e.assigned_coordinator_id, 4
      from event_comments p join events e on e.id = p.event_id
      where p.id = new.parent_comment_id and p.is_clarification_request
        and new.author_id = e.organiser_id -- only the organiser answers it
    ) r
    where r.user_id <> new.author_id
    group by r.user_id
  ) best
  join (values
    (1, 'comment_reply', 'Someone replied to your comment'),
    (2, 'comment_mention', 'You were mentioned in a comment'),
    (3, 'clarification_requested', 'Your coordinator needs more information'),
    (4, 'clarification_answered', 'The organiser answered your clarification request')
  ) k(rank, type, title) on k.rank = best.rank;
  return new;
end;
$$;

-- Deferred to the end of the transaction, so the comment's mentions (saved after it by post_event_comment) are there.
drop trigger if exists trg_notify_new_comment on event_comments;
create constraint trigger trg_notify_new_comment
  after insert on event_comments
  deferrable initially deferred
  for each row execute function public.notify_new_comment();

-- ---------------------------------------------------------------------------
-- 4. Safety decisions (AC12, proposed for SCRUM-47 in Jira)
-- ---------------------------------------------------------------------------
-- record_safety_decision() (migrations 37, 43) inserts one safety_checks row per decision; the event's coordinator and
-- organiser are each told it.

create or replace function public.notify_safety_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into notifications (user_id, event_id, type, title, message)
  select r.user_id, e.id, 'safety_' || new.decision, 'Safety check decision',
         e.name || coalesce(': ' || new.reason, '') -- the reason (rejected) or the requested changes, when given
  from events e
  cross join lateral (values (e.assigned_coordinator_id), (e.organiser_id)) r(user_id)
  where e.id = new.event_id and r.user_id is not null;
  return new;
end;
$$;

drop trigger if exists trg_notify_safety_decision on safety_checks;
create trigger trg_notify_safety_decision
  after insert on safety_checks
  for each row execute function public.notify_safety_decision();

notify pgrst, 'reload schema';

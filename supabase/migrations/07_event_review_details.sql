-- ER-01/AC2: extend the existing caller-scoped projection with display fields.
-- A changed return type requires replacing the function, including its grants.
begin;
drop function public.review_submitted_requests(uuid);
create function public.review_submitted_requests(request_id uuid default null)
returns table (
  id uuid,
  organiser_name text,
  name text,
  purpose text,
  preferred_start_datetime timestamptz,
  preferred_end_datetime timestamptz,
  expected_attendance integer,
  layout_preferences text,
  accessibility_requirements text,
  equipment_requirements_notes text,
  submitted_at timestamptz,
  status public.event_status
)
language sql stable security invoker set search_path = ''
as $$
  select e.id, organiser.full_name, e.name, e.purpose,
    e.preferred_start_datetime, e.preferred_end_datetime, e.expected_attendance,
    layout.name, e.accessibility_requirements, e.equipment_requirements_notes,
    e.submitted_at, e.status
  from public.events e
  join public.users organiser on organiser.id = e.organiser_id
  left join public.room_layouts layout on layout.id = e.preferred_room_layout_id
  where e.status = 'submitted'
    and e.assigned_coordinator_id = (select auth.uid())
    and (request_id is null or e.id = request_id)
    and exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.is_active and u.role = 'event_coordinator'
    );
$$;
revoke all on function public.review_submitted_requests(uuid) from public, anon;
grant execute on function public.review_submitted_requests(uuid) to authenticated;
commit;

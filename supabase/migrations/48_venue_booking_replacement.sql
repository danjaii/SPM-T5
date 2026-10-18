-- Replacing a venue booking affected by unavailability (SCRUM-107, docs/specs/replacement-venue.md). Needs 36 (flags), 46
-- (SCRUM-106's venue_unavailable flag) and 47 (the 'replaced' status). Append-only: nothing earlier is edited.
-- Touches venue-service (replacement candidates, POST /venue-bookings/:id/replacement, the booking DTOs) and equipment-service,
-- whose equipment_reservations rows move to the replacement.
--
-- A replacement is a NEW PENDING venue booking whose amends_booking_id is the original (the link SCRUM-60 uses). The original is
-- not written until Venue Staff approve the replacement; then the trigger below, in the same transaction as the approval,
-- takes over: original -> 'replaced', its flags resolve ('replaced', by 36's trigger), its equipment moves and resets.
--
-- Role matrix (RLS definition of done):
--   replaced_by_booking_id, replaced_at   written only by venue_booking_take_over(). No signed-in role has UPDATE on them
--                                         (07's column grants list the columns a role may change; these are not in them).
--                                         Readable wherever the booking is (venue_bookings_select, 07).
--   venue_booking_take_over()             internal trigger function: nobody may call it.

alter table venue_bookings
  add column replaced_by_booking_id uuid references venue_bookings(id),
  add column replaced_at timestamptz;

-- one replacement per original, and a replaced booking always says by whom and when (compared as text: the enum value is new)
create unique index venue_bookings_replaced_by_unique on venue_bookings (replaced_by_booking_id) where replaced_by_booking_id is not null;
alter table venue_bookings add constraint venue_bookings_replaced_columns check (
  (status::text = 'replaced') = (replaced_by_booking_id is not null)
  and (replaced_by_booking_id is null) = (replaced_at is null)
);

-- A replacement was approved: the original it replaces gives way. Acts ONLY when the original is holding and carries an open
-- 'venue_unavailable' flag, so an ordinary amendment (the original is rejected, SCRUM-60) is untouched. Runs in the approval's
-- transaction: if anything here fails, the approval rolls back. A replaced booking is not holding, so it stops occupying its
-- venue at once (107-S3) and the padded-overlap trigger and available_venues need no change.
create or replace function public.venue_booking_take_over()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.venue_bookings%rowtype;
begin
  if old.status::text <> 'requested' or new.status::text <> 'approved' or new.amends_booking_id is null then
    return null;
  end if;

  select * into v_original from public.venue_bookings where id = new.amends_booking_id for update;
  if not found or v_original.status::text not in ('requested', 'tentative', 'approved', 'confirmed') then
    return null;
  end if;
  if not exists (
    select 1 from public.venue_booking_flags f
    where f.booking_id = v_original.id and f.kind = 'venue_unavailable' and f.resolved_at is null
  ) then
    return null; -- the flag was resolved meanwhile: an ordinary approval (107-S7)
  end if;

  -- 36's trigger on venue_bookings resolves the original's flags with reason 'replaced' when its status changes
  update public.venue_bookings
     set status = 'replaced', replaced_by_booking_id = new.id, replaced_at = now()
   where id = v_original.id;

  -- decision 4: its equipment follows the replacement and goes back to technical support, as change_venue_booking() does for a
  -- new period (SCRUM-102/AC8). Cancelled rows stay where they are.
  update public.equipment_reservations set
    venue_booking_id  = new.id,
    start_datetime    = new.event_start_datetime,
    end_datetime      = new.event_end_datetime,
    status            = 'requested',
    quantity_reserved = null,
    reviewed_by       = null
  where venue_booking_id = v_original.id and status <> 'cancelled';

  insert into public.activity_log (actor_id, action_type, entity_type, entity_id, description)
  values (auth.uid(), 'venue_booking_replaced', 'venue_booking', v_original.id, format('Replaced by booking %s', new.id));
  return null;
end;
$$;

create trigger venue_booking_take_over
  after update of status on venue_bookings
  for each row execute function public.venue_booking_take_over();

revoke execute on function public.venue_booking_take_over() from public, anon, authenticated;

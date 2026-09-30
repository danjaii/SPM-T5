-- Venue booking requests (SCRUM-32/33/35/36/59/60, docs/specs/venue-booking-request.md).
-- Extends venue_bookings; touches venue-service and (via the dashboards) auth-service. Append-only:
-- nothing from 01-05 is edited.
--
-- Status mapping (API -> enum): PENDING = requested, APPROVED = approved (legacy tentative/confirmed
-- rows also hold the slot), REJECTED = rejected, WITHDRAWN = withdrawn.
-- A request "holds" its venue and period in: requested, tentative, approved, confirmed (DR5).

-- Lets a uuid (venue_id) be compared with = inside a GiST exclusion constraint.
create extension if not exists btree_gist;

-- DR8 snapshot: what the event looked like at submission. Nullable because legacy rows predate it.
-- "Venue requirements" has no column on events, so it holds the preferred room layout name.
alter table venue_bookings
  add column snapshot_event_name           text,
  add column snapshot_expected_attendance  int,
  add column snapshot_venue_requirements   text,
  add column snapshot_accessibility_needs  text;

-- SCRUM-60/59: an amendment points at the rejected request it amends. That request never changes.
-- from_suggestion marks a request created by accepting Venue Staff's suggestion (SCRUM-59).
alter table venue_bookings
  add column amends_booking_id uuid references venue_bookings(id),
  add column from_suggestion   boolean not null default false,
  add check (not from_suggestion or amends_booking_id is not null);

-- SCRUM-35 audit (DR13): who withdrew and when.
alter table venue_bookings
  add column withdrawn_by uuid references users(id),
  add column withdrawn_at timestamptz;

-- SCRUM-40 seam: Venue Staff's suggested alternative, recorded on the rejected request.
-- Either all three are set or none are.
alter table venue_bookings
  add column suggested_venue_id      uuid references venues(id),
  add column suggested_start_datetime timestamptz,
  add column suggested_end_datetime   timestamptz,
  add constraint venue_bookings_suggestion_complete check (
    (suggested_venue_id is null) = (suggested_start_datetime is null)
    and (suggested_venue_id is null) = (suggested_end_datetime is null)
  ),
  add constraint venue_bookings_suggestion_period check (
    suggested_end_datetime is null or suggested_end_datetime > suggested_start_datetime
  );

-- DR5 + DR11: no two holding requests may overlap at one venue. Half-open range, so back-to-back
-- periods are allowed. This is the atomic guarantee; the service's pre-check is only a courtesy.
alter table venue_bookings
  add constraint venue_bookings_no_overlap exclude using gist (
    venue_id with =,
    tstzrange(event_start_datetime, event_end_datetime, '[)') with &&
  ) where (status in ('requested', 'tentative', 'approved', 'confirmed'));

-- DR6: an event has at most one holding request at a time.
create unique index venue_bookings_one_active_per_event
  on venue_bookings (event_id)
  where status in ('requested', 'tentative', 'approved', 'confirmed');

-- 59-S3: a suggestion can be accepted once. No status filter: it stays used even if the request
-- created from it is later rejected or withdrawn.
create unique index venue_bookings_one_suggestion_accept
  on venue_bookings (amends_booking_id)
  where from_suggestion;

create index idx_venue_bookings_amends on venue_bookings(amends_booking_id);

import { VenueTimingForm } from "./VenueTimingForm";

export interface VenueDetails {
  id: string;
  name: string;
  address: string;
  description: string | null;
  max_capacity: number;
  operating_hours_start: string | null;
  operating_hours_end: string | null;
  is_accessible: boolean;
  accessibility_notes: string | null;
  layouts: { name: string; max_capacity: number }[];
  facilities: string[];
  /** SCRUM-101: whole minutes, 0 until Venue Staff set them. */
  setup_minutes: number;
  turnaround_minutes: number;
  /** SCRUM-101: true for Venue Staff only (101-S4). */
  can_edit_timing: boolean;
}

// SCRUM-29 AC2: all of a venue's characteristics, as used later for suitability checks
// we want to make sure that a venue's characteristics when the user clicks for further details can be shown
const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

export function VenueDetail({ venue }: { venue: VenueDetails }) {
  const hours =
    venue.operating_hours_start && venue.operating_hours_end
      ? `${venue.operating_hours_start.slice(0, 5)} – ${venue.operating_hours_end.slice(0, 5)}`
      : "Not listed";

  return (
    <section className="venue">
      <h1>{venue.name}</h1>
      {venue.description && <p className="dash__lede">{venue.description}</p>}

      <dl className="venue__facts">
        <dt>Location</dt>
        <dd>{venue.address}</dd>
        <dt>Maximum capacity</dt>
        <dd>{venue.max_capacity} people</dd>
        <dt>Operating hours</dt>
        <dd>{hours}</dd>
        <dt>Accessibility</dt>
        <dd>
          {venue.is_accessible ? "Accessible" : "Not marked as accessible"}
          {venue.accessibility_notes && <span className="venue__note">{venue.accessibility_notes}</span>}
        </dd>
        <dt>Setup time</dt>
        <dd>{minutes(venue.setup_minutes)}</dd>
        <dt>Turnaround time</dt>
        <dd>{minutes(venue.turnaround_minutes)}</dd>
      </dl>

      {venue.can_edit_timing && (
        <VenueTimingForm venueId={venue.id} setupMinutes={venue.setup_minutes} turnaroundMinutes={venue.turnaround_minutes} />
      )}

      <h2>Supported layouts</h2>
      {venue.layouts.length === 0 ? (
        <p className="empty">No layouts listed.</p>
      ) : (
        <ul className="venue__list">
          {venue.layouts.map((l) => <li key={l.name}>{`${l.name} (up to ${l.max_capacity})`}</li>)}
        </ul>
      )}

      <h2>Facilities</h2>
      {venue.facilities.length === 0 ? (
        <p className="empty">No facilities listed.</p>
      ) : (
        <ul className="venue__list">
          {venue.facilities.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
    </section>
  );
}

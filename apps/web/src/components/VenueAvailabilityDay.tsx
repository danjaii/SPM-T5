import { clock, type AvailabilityPeriod, type VenueAvailabilityData } from "@/lib/venueAvailability";

interface Segment {
  kind: "setup" | "event" | "turnaround";
  label: string;
  minutes: number;
}

/** Setup, event and turnaround as labelled parts of the occupied period (103-S5); a part of 0 minutes is left out. */
function segmentsOf(period: AvailabilityPeriod, day: string): Segment[] {
  const at = (iso: string) => new Date(iso).getTime();
  const minutes = (from: string, to: string) => (at(to) - at(from)) / 60_000;
  const parts: Segment[] = [
    { kind: "setup", label: `Setup ${clock(period.occupied_start, day)} to ${clock(period.event_start, day)}`, minutes: minutes(period.occupied_start, period.event_start) },
    { kind: "event", label: `Event ${clock(period.event_start, day)} to ${clock(period.event_end, day)}`, minutes: minutes(period.event_start, period.event_end) },
    { kind: "turnaround", label: `Turnaround ${clock(period.event_end, day)} to ${clock(period.occupied_end, day)}`, minutes: minutes(period.event_end, period.occupied_end) },
  ];
  return parts.filter((p) => p.minutes > 0);
}

// SCRUM-103/AC5 (103-S5): one day at a venue. Each booking is shown as the whole time it occupies the venue, with the event
// told apart from the setup before it and the turnaround after it. Every part is named in text, not only in colour.
export function VenueAvailabilityDay({ data }: { data: VenueAvailabilityData }) {
  return (
    <section className="venue avail">
      <h1>Availability: {data.venue.name}</h1>
      <p className="dash__lede">
        Venue times: setup {data.setup_minutes} minutes, turnaround {data.turnaround_minutes} minutes. A booking occupies the
        venue from its setup to the end of its turnaround, and the same time counts when you request a slot.
      </p>

      <form method="get" className="avail__form">
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={data.date} required />
        </div>
        <button className="btn" type="submit">Show day</button>
      </form>

      {data.periods.length === 0 ? (
        <p className="empty">No bookings on {data.date}: the venue is free all day.</p>
      ) : (
        <ul className="avail__list">
          {data.periods.map((period) => (
            <li key={`${period.occupied_start}-${period.event_start}`} className="avail__item">
              <p className="avail__summary">
                <strong>Occupied {clock(period.occupied_start, data.date)} to {clock(period.occupied_end, data.date)}</strong>{" "}
                <span className={`avail__status avail__status--${period.status.toLowerCase()}`}>
                  {period.status === "PENDING" ? "Pending" : "Approved"}
                </span>
              </p>
              <div className="avail__bar">
                {segmentsOf(period, data.date).map((segment) => (
                  <span
                    key={segment.kind}
                    className={`avail__segment avail__segment--${segment.kind}`}
                    style={{ flexGrow: segment.minutes }}
                  >
                    {segment.label}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import Link from "next/link";
import type { VenueSearchResultView } from "@/lib/venueSearch";

// SCRUM-65 AC7 + AC8: the venues a search found, each with its name, location, capacity, accessibility,
// supported layouts and facilities; or a message that nothing suitable was found.
export function VenueSearchResults({ venues }: { venues: VenueSearchResultView[] }) {
  // AC8
  if (venues.length === 0) {
    return <p className="empty" role="status">No suitable venues were found. Try changing the date, time or filters.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Venue</th>
            <th scope="col">Location</th>
            <th scope="col">Capacity</th>
            <th scope="col">Accessibility</th>
            <th scope="col">Layouts</th>
            <th scope="col">Facilities</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((v) => (
            <tr key={v.id}>
              <td><Link href={`/venues/${v.id}`}>{v.name}</Link></td>
              <td>{v.address}</td>
              <td>{v.max_capacity}</td>
              <td>
                {v.is_accessible ? "Accessible" : "Not accessible"}
                {v.accessibility_notes ? ` (${v.accessibility_notes})` : ""}
              </td>
              <td>{v.layouts.length > 0 ? v.layouts.map((l) => `${l.name} (${l.max_capacity})`).join(", ") : "None listed"}</td>
              <td>{v.facilities.length > 0 ? v.facilities.map((f) => f.name).join(", ") : "None listed"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

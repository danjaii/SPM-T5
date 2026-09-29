import Link from "next/link";

export interface VenueSummary {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
}

// SCRUM-29 AC1: the venue catalogue — each venue's name (linking to its details), location and maximum capacity
export function VenueList({ venues }: { venues: VenueSummary[] }) {
  // SCRUM-29 AC5: an empty catalogue gets a friendly message, not an empty table
  if (venues.length === 0) {
    return <p className="empty">No venues in the catalogue yet.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Venue</th>
            <th scope="col">Location</th>
            <th scope="col">Max capacity</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((v) => (
            <tr key={v.id}>
              <td><Link href={`/venues/${v.id}`}>{v.name}</Link></td>
              <td>{v.address}</td>
              <td>{v.max_capacity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

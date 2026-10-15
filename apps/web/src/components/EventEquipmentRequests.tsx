import Link from "next/link";
import type { EventEquipmentRequestsView } from "@/lib/equipmentRequests";

// SCRUM-86/AC2, AC3: the event's equipment requests, each with its own status. Shown to the assigned coordinator and
// Technical Support Staff (equipment-service answers nobody else); null means no section. AC6, AC7: the Request
// equipment button only when equipment-service says the viewer may add one.
export function EventEquipmentRequests({ eventId, data }: { eventId: string; data: EventEquipmentRequestsView | null }) {
  if (!data) return null;
  return (
    <section className="event-section" aria-labelledby="equipment-requests-heading">
      <h2 id="equipment-requests-heading">Equipment requests</h2>
      {data.requests.length === 0 ? (
        <p className="event-detail-card event-detail-card--quiet">No equipment has been requested for this event yet.</p>
      ) : (
        <div className="event-detail-card event-detail-card--table">
          <table>
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Quantity</th>
                <th>Venue</th>
                <th>Notes</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.equipment}</td>
                  <td>{r.quantity}</td>
                  <td>{r.venueName ?? "No venue"}</td>
                  <td>{r.notes ?? "—"}</td>
                  <td>
                    {r.statusLabel}
                    {/* SCRUM-102/AC7: released with its venue booking, which says why */}
                    {r.releasedReason && <span className="vb__note">Venue booking cancelled: {r.releasedReason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.canCreate && (
        <div className="event-buttons">
          <Link className="btn btn--secondary" href={`/events/${eventId}/equipment-request`}>Request equipment</Link>
        </div>
      )}
    </section>
  );
}

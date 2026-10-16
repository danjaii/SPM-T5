import Link from "next/link";
import { EQUIPMENT_REQUEST_REVIEW_MESSAGES } from "@spm-t5/shared";
import type { EquipmentQueueItemView } from "@/lib/equipmentRequests";

// SCRUM-87/AC1: the requests waiting for action, soonest event first (equipment-service orders them).
// AC2: none shows the spec's message.
export function EquipmentQueueList({ requests }: { requests: EquipmentQueueItemView[] }) {
  if (requests.length === 0) return <p className="empty">{EQUIPMENT_REQUEST_REVIEW_MESSAGES.queueEmpty}</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Event date</th>
            <th>Venue</th>
            <th>Equipment</th>
            <th>Quantity</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/equipment-requests/${r.id}`}>{r.eventName}</Link>
              </td>
              <td>{r.eventDate}</td>
              <td>{r.venueName ?? "No venue"}</td>
              <td>{r.equipment}</td>
              <td>{r.quantity}</td>
              <td><span className="status-badge">{r.statusLabel}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

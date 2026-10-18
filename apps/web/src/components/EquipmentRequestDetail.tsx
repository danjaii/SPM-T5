import Link from "next/link";
import type { EquipmentRequestDetailView } from "@/lib/equipmentRequests";
import { SentBackNotice } from "./SentBackNotice";

// SCRUM-87/AC3: one request in full, whatever its status. AC5: a Cannot Fulfil request shows its reason.
// SCRUM-88/AC2: a request the coordinator changed is marked Updated; AC8: who last changed it, and when.
export function EquipmentRequestDetail({ request }: { request: EquipmentRequestDetailView }) {
  return (
    <section className="vb">
      <h1>{request.equipment}</h1>
      <p className="event__status">
        Status <span className="status-badge">{request.statusLabel}</span>
        {request.updated && <> <span className="status-badge">Updated</span></>}
      </p>
      <SentBackNotice note={request.sentBack} />

      <dl className="vb__facts">
        <dt>Event</dt>
        <dd><Link href={`/events/${request.eventId}`}>{request.eventName}</Link></dd>
        <dt>Event date</dt>
        <dd>{request.eventDate}</dd>
        <dt>Time</dt>
        <dd>{request.startTime}–{request.endTime}</dd>
        <dt>Venue</dt>
        <dd>{request.venueName ?? "No venue"}</dd>
        <dt>Equipment</dt>
        <dd>{request.equipment}</dd>
        <dt>Quantity</dt>
        <dd>{request.quantity}</dd>
        <dt>Technical notes</dt>
        <dd>{request.notes || "None"}</dd>
        {request.lastChangedBy && (
          <>
            <dt>Last changed</dt>
            <dd>{request.lastChangedBy}, {request.lastChangedAt}</dd>
          </>
        )}
      </dl>

      {request.reason && (
        <>
          <h2>Why it cannot be fulfilled</h2>
          <p>{request.reason}</p>
        </>
      )}
    </section>
  );
}

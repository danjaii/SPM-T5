import type { ChangeRequestView } from "@/lib/events";

const STATUS_LABELS: Record<ChangeRequestView["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const formatRequestedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-66/AC7: each change request the organiser has made, with whether it is pending, approved or rejected.
export function EventChangeRequestList({ requests }: { requests: ChangeRequestView[] }) {
  return (
    <section className="event" aria-labelledby="change-requests">
      <h2 id="change-requests">Change requests</h2>
      {requests.length === 0 ? (
        <p className="field__hint">No change requests yet.</p>
      ) : (
        <ul className="vb__list">
          {requests.map((r) => (
            <li key={r.id}>
              <span className="status-badge">{STATUS_LABELS[r.status] ?? r.status}</span>{" "}
              {r.change_description} <span className="field__hint">({formatRequestedAt(r.requested_at)})</span>
              {r.status === "rejected" && r.review_notes && <p className="field__hint">{r.review_notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

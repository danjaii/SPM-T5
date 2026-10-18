"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReplacementCandidateDto, UnmetRequirement } from "@spm-t5/shared";
import { UnsuitableConfirm } from "./UnsuitableConfirm";
import { requestReplacementVenue } from "@/lib/venueBookings";

// SCRUM-107/AC1, AC2: the venues that are free for the flagged booking's period (setup and turnaround included) and big enough.
// Choosing one creates a PENDING request with the original's date, times, attendance and requirements; nothing is typed again.
// A venue that does not suit the event goes through the same inline confirm step as any request (SCRUM-110).
export function ReplacementPicker({ originalId, candidates }: { originalId: string; candidates: ReplacementCandidateDto[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [unsuitable, setUnsuitable] = useState<{ venue: ReplacementCandidateDto; unmet: UnmetRequirement[] }>();

  async function request(venue: ReplacementCandidateDto, overrideReason?: string) {
    setBusyId(venue.venueId);
    setError(undefined);
    const { ok, data } = await requestReplacementVenue(originalId, venue.venueId, overrideReason);
    if (ok && data.id) {
      router.push(`/venue-bookings/${data.id}`);
      return;
    }
    if (data.code === "UNSUITABLE_VENUE" && data.unmet) setUnsuitable({ venue, unmet: data.unmet });
    else setError((data as { error?: string }).error ?? "We couldn't request that venue. Please try again.");
    setBusyId(undefined);
  }

  if (candidates.length === 0) {
    return <p className="event-detail-card event-detail-card--quiet">No other venue is free for that period and big enough.</p>;
  }

  return (
    <section>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {unsuitable && (
        <UnsuitableConfirm
          unmet={unsuitable.unmet}
          busy={busyId !== undefined}
          onCancel={() => {
            setUnsuitable(undefined);
            setBusyId(undefined);
          }}
          onConfirm={(reason) => {
            const venue = unsuitable.venue;
            setUnsuitable(undefined);
            return request(venue, reason);
          }}
        />
      )}
      <div className="event-detail-card event-detail-card--table">
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Location</th>
              <th>Capacity</th>
              <th><span className="visually-hidden">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((v) => (
              <tr key={v.venueId}>
                <td>{v.name}</td>
                <td>{v.address}</td>
                <td>{v.maxCapacity}</td>
                <td>
                  <button
                    className="btn btn--secondary"
                    type="button"
                    disabled={busyId !== undefined}
                    aria-label={`Request ${v.name}`}
                    onClick={() => request(v)}
                  >
                    {busyId === v.venueId ? "Requesting…" : "Request this venue"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

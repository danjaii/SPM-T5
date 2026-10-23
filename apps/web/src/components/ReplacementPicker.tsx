"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReplacementCandidateDto, UnmetRequirement } from "@spm-t5/shared";
import { SearchX } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  // SCRUM-135/AC10: a designed empty state, not a bare sentence.
  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
        <SearchX aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-semibold text-foreground">No other venue is free for that period and big enough.</p>
        <p className="text-sm text-muted-foreground">Try the venue catalogue to search other dates, or change the event&apos;s requirements.</p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {error && <AuthAlert tone="error">{error}</AuthAlert>}
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
      <Table>
        <TableHeader className="max-md:sr-only">
          <TableRow>
            <TableHead>Venue</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Capacity</TableHead>
            <TableHead><span className="sr-only">Action</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((v) => (
            <TableRow key={v.venueId} className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-3">
              <TableCell className="font-semibold whitespace-normal max-md:p-0">{v.name}</TableCell>
              <TableCell className="whitespace-normal max-md:p-0">{v.address}</TableCell>
              <TableCell className="max-md:p-0">{v.maxCapacity}</TableCell>
              <TableCell className="text-right max-md:p-0 max-md:text-left">
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId !== undefined}
                  aria-label={`Request ${v.name}`}
                  onClick={() => request(v)}
                >
                  {busyId === v.venueId ? "Requesting…" : "Request this venue"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

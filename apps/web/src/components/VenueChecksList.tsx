import { Check, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { VenueChecks } from "@/lib/venueChecks";

// SCRUM-132/AC1, AC2, AC6: what a venue meets or misses, one line per requirement. Every line carries an icon and its
// words (a screen reader hears "Met" or "Not met"), and the card is labelled Suitable or Not suitable.
export function VenueChecksList({ result }: { result: VenueChecks }) {
  const suitable = result.overall === "suitable";
  return (
    <div className="mt-2 flex flex-col gap-2">
      <StatusBadge tone={suitable ? "success" : "danger"} label={suitable ? "Suitable" : "Not suitable"} className="self-start" />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Requirement checks">
        {result.checks.map((c) => (
          <li key={c.key} data-met={c.met} className="flex items-center gap-1.5 text-foreground">
            {c.met ? <Check aria-hidden="true" className="size-4 shrink-0 text-status-success-fg" /> : <X aria-hidden="true" className="size-4 shrink-0 text-destructive" />}
            <span className="sr-only">{c.met ? "Met: " : "Not met: "}</span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

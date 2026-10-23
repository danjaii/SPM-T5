import type { CriterionStatus } from "@spm-t5/shared";
import { Check, CircleHelp, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SuitabilityView } from "@/lib/venueSuitability";

// SCRUM-109: the result of the suitability check. Every line says its status in words (not colour alone) and
// "Check manually" lists the free-text requirements nobody can compare automatically.
const STATUS_LABEL: Record<CriterionStatus, string> = {
  met: "Met",
  not_met: "Not met",
  not_checked: "Not checked",
  manual: "Check manually",
};

// SCRUM-132/AC2, AC6: each line has an icon as well as its words, and the summary is a StatusBadge.
const STATUS_ICON: Record<CriterionStatus, { Icon: LucideIcon; className: string }> = {
  met: { Icon: Check, className: "text-status-success-fg" },
  not_met: { Icon: X, className: "text-destructive" },
  not_checked: { Icon: CircleHelp, className: "text-muted-foreground" },
  manual: { Icon: TriangleAlert, className: "text-status-warning-fg" },
};

function StatusIcon({ status }: { status: CriterionStatus }) {
  const { Icon, className } = STATUS_ICON[status];
  return <Icon aria-hidden="true" className={`size-4 shrink-0 ${className}`} />;
}

type Report = Pick<SuitabilityView, "overall" | "criteria" | "manualChecks"> & { venue?: { name: string } };

export function SuitabilityReport({ report }: { report: Report }) {
  const suitable = report.overall === "suitable";
  return (
    <section className="suitability flex flex-col gap-4" aria-label="Venue suitability">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground" role="status">
        {report.venue ? `${report.venue.name}:` : null}
        <StatusBadge tone={suitable ? "success" : "danger"} label={suitable ? "Suitable" : "Not suitable"} />
      </p>
      {/* Laid out like the request details: one labelled block per criterion in a two-column grid. */}
      <dl className="grid gap-4 sm:grid-cols-2">
        {report.criteria.map((c) => (
          <div key={c.key} data-status={c.status} className="flex flex-col gap-0.5">
            <dt className="text-xs font-semibold text-muted-foreground">{c.label}</dt>
            <dd className="flex flex-col gap-0.5 text-sm text-foreground">
              <span className="flex items-center gap-1.5 font-semibold">
                <StatusIcon status={c.status} />
                <span>{STATUS_LABEL[c.status]}</span>
              </span>
              <span className="text-muted-foreground">{c.message}</span>
            </dd>
          </div>
        ))}
      </dl>
      {report.manualChecks.length > 0 && (
        <div className="rounded-lg border border-status-warning-fg bg-status-warning p-3 text-sm text-status-warning-fg">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
            Check manually
          </h3>
          <ul className="mt-1 list-disc pl-4">
            {report.manualChecks.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

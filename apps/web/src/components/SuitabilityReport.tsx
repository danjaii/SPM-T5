import type { CriterionStatus } from "@spm-t5/shared";
import type { SuitabilityView } from "@/lib/venueSuitability";

// SCRUM-109: the result of the suitability check. Every line says its status in words (not colour alone) and
// "Check manually" lists the free-text requirements nobody can compare automatically.
const STATUS_LABEL: Record<CriterionStatus, string> = {
  met: "Met",
  not_met: "Not met",
  not_checked: "Not checked",
  manual: "Check manually",
};

type Report = Pick<SuitabilityView, "overall" | "criteria" | "manualChecks"> & { venue?: { name: string } };

export function SuitabilityReport({ report }: { report: Report }) {
  const suitable = report.overall === "suitable";
  return (
    <section className="suitability" aria-label="Venue suitability">
      <p className={`alert ${suitable ? "alert--ok" : "alert--error"}`} role="status">
        {report.venue ? `${report.venue.name}: ` : ""}
        <strong>{suitable ? "Suitable" : "Not suitable"}</strong>
      </p>
      <ul className="suitability__list">
        {report.criteria.map((c) => (
          <li key={c.key} data-status={c.status}>
            <strong>{c.label}</strong> <span className="status-badge">{STATUS_LABEL[c.status]}</span>
            <div>{c.message}</div>
          </li>
        ))}
      </ul>
      {report.manualChecks.length > 0 && (
        <>
          <h3>Check manually</h3>
          <ul>
            {report.manualChecks.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

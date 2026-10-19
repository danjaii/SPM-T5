import { reviewSections, type EventRequestFormValues } from "@/lib/eventRequestForm";
import type { RoomLayoutOption } from "@/lib/eventRequests";
import { Button } from "@/components/ui/button";

// SCRUM-123/AC3: everything entered, in the same sections as the steps, each with an Edit link back to its step.
export function ReviewStep({ values, layouts, onEdit }: { values: EventRequestFormValues; layouts: RoomLayoutOption[]; onEdit: (step: number) => void }) {
  const sections = reviewSections(values, (id) => layouts.find((l) => l.id === id)?.name);
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <section key={section.title} aria-labelledby={`review-${section.step}`} className="rounded-xl bg-muted p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`review-${section.step}`} className="text-base font-bold text-foreground">{section.title}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(section.step)}
              aria-label={`Edit ${section.title}`}>
              Edit
            </Button>
          </div>
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
            {section.rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-sm font-semibold text-foreground">{row.label}</dt>
                <dd className="text-sm break-words text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

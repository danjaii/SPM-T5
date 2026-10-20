import { reviewSections, type EventRequestFormValues } from "@/lib/eventRequestForm";
import type { RoomLayoutOption } from "@/lib/eventRequests";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

// SCRUM-123/AC3: everything entered, in the same sections as the steps, each with an Edit link back to its step. Each section
// is an accordion item, all open to start with so nothing is hidden, and the organiser can fold the ones already checked.
export function ReviewStep({ values, layouts, onEdit }: { values: EventRequestFormValues; layouts: RoomLayoutOption[]; onEdit: (step: number) => void }) {
  const sections = reviewSections(values, (id) => layouts.find((l) => l.id === id)?.name);
  return (
    <Accordion multiple className="border-b-0" defaultValue={sections.map((s) => s.title)}>
      {sections.map((section) => (
        <AccordionItem key={section.title} value={section.title}>
          <AccordionTrigger
            action={
              <Button type="button" variant="link" size="sm" onClick={() => onEdit(section.step)} aria-label={`Edit ${section.title}`}>
                Edit
              </Button>
            }
          >
            {section.title}
          </AccordionTrigger>
          <AccordionPanel>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[11rem_1fr]">
              {section.rows.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-sm text-muted-foreground">{row.label}</dt>
                  <dd className="text-sm font-medium break-words text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

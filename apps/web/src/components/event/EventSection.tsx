import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

// SCRUM-127: the card every block of the event page sits in (Figma frame 05): a bold title, an optional action on its right,
// then the content. The heading is tied to the section with aria-labelledby.
export function EventSection({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <Card className="gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={id} className="text-lg font-bold">{title}</h2>
          {action}
        </div>
        {children}
      </Card>
    </section>
  );
}

/** The quiet line a section shows when there is nothing in it yet. */
export function EmptyNote({ children, role }: { children: ReactNode; role?: "status" }) {
  return <p role={role} className="text-sm text-muted-foreground">{children}</p>;
}

/** A tab's block for someone the service will not show it to, so the tab is never blank. */
export function Unavailable({ id, title }: { id: string; title: string }) {
  return (
    <EventSection id={id} title={title}>
      <EmptyNote>This is not available to you for this event.</EmptyNote>
    </EventSection>
  );
}

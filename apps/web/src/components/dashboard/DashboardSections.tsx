import Link from "next/link";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import type { DashboardData } from "@/components/DashboardView";
import EventStatusBadge from "@/components/EventStatusBadge";
import { LinkedRow } from "@/components/LinkedRow";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROW_LINK_FOCUS_CLASS } from "@/lib/rowLink";

type Section = DashboardData["sections"][number];

const LINK = `font-semibold text-foreground underline-offset-4 hover:underline ${ROW_LINK_FOCUS_CLASS}`;

/** One table cell: the value, as a status badge when the column carries a status (SCRUM-127/AC3), linked when it has a link. */
function Value({ row, column }: { row: Section["rows"][number]; column: Section["columns"][number] }) {
  const href = column.linkKey ? row[column.linkKey] : undefined;
  const shown = column.statusKey ? <EventStatusBadge status={String(row[column.statusKey])} /> : row[column.key];
  if (!href) return <>{shown}</>;
  return <Link href={String(href)} className={column.statusKey ? ROW_LINK_FOCUS_CLASS : LINK}>{shown}</Link>;
}

/**
 * SCRUM-159: the tables auth-service gives a role's home page, in the new design: one card per section, the same titles,
 * columns and "Nothing to show yet.", each status as a badge with an icon, and a row that links somewhere opening it from
 * anywhere on the row (SCRUM-151). `footers` puts a link under a section, by its title. DashboardView keeps the old look for
 * the roles not redesigned yet.
 */
export function DashboardSections({ sections, footers = {} }: { sections: Section[]; footers?: Record<string, ReactNode> }) {
  return (
    <>
      {sections.map((section) => {
        const headingId = `section-${section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        return (
          <Card key={section.title} className="gap-4 p-4 sm:p-6" role="region" aria-labelledby={headingId}>
            <h2 id={headingId} className="text-lg font-bold text-foreground">{section.title}</h2>
            {section.rows.length === 0 ? (
              <div data-state="empty" className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
                <Inbox aria-hidden="true" className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>{section.columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {section.rows.map((row, i) => {
                    const cells = section.columns.map((c) => (
                      <TableCell key={c.key} className="whitespace-normal"><Value row={row} column={c} /></TableCell>
                    ));
                    // the row opens the first thing it links to, e.g. the event
                    const rowHref = section.columns.map((c) => (c.linkKey ? row[c.linkKey] : undefined)).find(Boolean);
                    return rowHref ? (
                      <LinkedRow key={i} href={String(rowHref)} className="border-b transition-colors">{cells}</LinkedRow>
                    ) : (
                      <TableRow key={i}>{cells}</TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {footers[section.title]}
          </Card>
        );
      })}
    </>
  );
}

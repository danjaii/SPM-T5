import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { LeadKpi } from "@/lib/leadQueueView";

// SCRUM-126/AC1: the figures above the Lead's queue (Figma 04: Unassigned, Active events, Events this month, Reassigned this week).
export function LeadKpiCards({ kpis }: { kpis: LeadKpi[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Queue summary">
      {kpis.map((k) => (
        <li key={k.label}>
          <Card className="h-full">
            <CardContent className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{k.label}</p>
              <p className="font-heading text-3xl font-bold">
                {k.href ? <Link href={k.href} aria-label={`${k.value} ${k.label.toLowerCase()}, view them`} className="underline-offset-4 hover:underline">{k.value}</Link> : k.value}
              </p>
              {k.noteHref ? (
                <Link href={k.noteHref} className="flex items-center gap-1 text-xs font-semibold text-status-danger-fg underline-offset-4 hover:underline">
                  {k.note}
                  <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
                </Link>
              ) : (
                <p className={k.warn ? "flex items-center gap-1 text-xs font-semibold text-status-warning-fg" : "text-xs text-muted-foreground"}>
                  {k.warn && <Clock className="size-3 shrink-0" aria-hidden="true" />}
                  {k.note}
                </p>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

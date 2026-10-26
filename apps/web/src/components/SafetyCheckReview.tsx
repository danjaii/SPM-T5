"use client";

import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { TextareaField } from "@/components/ui/textarea-field";
import { SafetyCheckActions } from "@/components/SafetyCheckActions";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { SafetyCheckDetails } from "@/lib/safetyCheckServer";
import { safetyFactors } from "@/lib/safetyFactors";

interface Props {
  details: SafetyCheckDetails;
  /** Whether a decision can be recorded now; if not, the factors are only read. */
  canDecide: boolean;
}

// SCRUM-142/AC2 + AC3 (Figma frame 13): the six factors with Meets / Concern, the decision, and the arrangements the check
// covers. One component owns the factors the Safety Officer flags, because the decision sends their notes with it. A flagged
// factor is marked by an icon and the word "Concern", never by colour alone.
export function SafetyCheckReview({ details, canDecide }: Props) {
  const factors = safetyFactors(details);
  // a factor is a concern while it has an entry here; the entry is what needs to change
  const [concerns, setConcerns] = useState<Record<string, string>>({});
  const flagged = factors.filter((f) => f.id in concerns);

  const setConcern = (id: string, on: boolean) =>
    setConcerns((prev) => (on ? { ...prev, [id]: prev[id] ?? "" } : Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id))));

  const equipmentItems = details.equipment.reduce((sum, q) => sum + q.quantity, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="safety-factors-heading">
        <Card className="gap-0 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
            <h2 id="safety-factors-heading" className="text-lg font-bold">Six factors</h2>
            {canDecide && (
              <p className="text-sm font-semibold text-muted-foreground">
                {`${factors.length - flagged.length} meet · ${flagged.length} ${flagged.length === 1 ? "concern" : "concerns"}`}
              </p>
            )}
          </div>
          <ol>
            {factors.map((f, i) => {
              const isConcern = f.id in concerns;
              return (
                <li key={f.id} className="flex flex-col gap-3 border-b border-border px-5 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <h3 className="text-sm font-semibold">{f.title}</h3>
                        <ul className="text-xs text-muted-foreground">
                          {f.lines.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                      </div>
                    </div>
                    {canDecide && (
                      <div role="group" aria-label={`${f.title} result`} className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-pressed={!isConcern}
                          className="aria-pressed:border-status-success-fg aria-pressed:bg-status-success aria-pressed:text-status-success-fg"
                          onClick={() => setConcern(f.id, false)}
                        >
                          {!isConcern && <Check aria-hidden="true" />}
                          Meets
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-pressed={isConcern}
                          className="aria-pressed:border-status-warning-fg aria-pressed:bg-status-warning aria-pressed:text-status-warning-fg"
                          onClick={() => setConcern(f.id, true)}
                        >
                          {isConcern && <AlertTriangle aria-hidden="true" />}
                          Concern
                        </Button>
                      </div>
                    )}
                  </div>
                  {canDecide && isConcern && (
                    <TextareaField
                      id={`concern-${f.id}`}
                      label="What needs to change"
                      rows={2}
                      value={concerns[f.id]}
                      onChange={(e) => setConcerns((prev) => ({ ...prev, [f.id]: e.target.value }))}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      </section>

      <div className="flex flex-col gap-6">
        {canDecide && (
          <SafetyCheckActions
            eventId={details.id}
            role="safety_officer"
            concerns={flagged.map((f) => ({ title: f.title, note: concerns[f.id] }))}
          />
        )}

        <section aria-labelledby="safety-arrangements-heading">
          <Card className="gap-3 p-5">
            <h2 id="safety-arrangements-heading" className="text-base font-bold">Confirmed arrangements</h2>
            <ul className="flex flex-col gap-3 text-sm">
              {details.venues.map((v) => (
                <li key={`${v.name}-${v.start}`} className="flex items-start justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="font-semibold">{v.name}</span>
                    <span className="text-xs text-muted-foreground">{formatEventDateTime(v.start, v.end)}</span>
                  </span>
                  <StatusBadge tone="success" label="Confirmed" />
                </li>
              ))}
              {equipmentItems > 0 && (
                <li className="flex items-start justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="font-semibold">Equipment</span>
                    <span className="text-xs text-muted-foreground">{`${equipmentItems} ${equipmentItems === 1 ? "item" : "items"}`}</span>
                  </span>
                  <StatusBadge tone="success" label="Reserved" />
                </li>
              )}
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}

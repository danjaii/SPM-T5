import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeadCoordinator } from "@/lib/leadServer";

// SCRUM-126/AC2: each coordinator's active events beside the queue, with a bar scaled to the busiest one.
export function LeadWorkloadPanel({ coordinators }: { coordinators: LeadCoordinator[] }) {
  const busiest = Math.max(1, ...coordinators.map((c) => c.workload));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coordinator workload</CardTitle>
        <p className="text-xs text-muted-foreground">Active events per coordinator.</p>
      </CardHeader>
      <CardContent>
        {coordinators.length === 0 ? (
          <p className="text-sm text-muted-foreground">No coordinators are assigned to you.</p>
        ) : (
          <ul className="space-y-3">
            {coordinators.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{c.full_name}</span>
                  <span className="text-xs text-muted-foreground">{c.workload} active</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full bg-fg-primary" style={{ width: `${(c.workload / busiest) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

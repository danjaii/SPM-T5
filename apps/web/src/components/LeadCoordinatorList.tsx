import { Users } from "lucide-react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeadCoordinator } from "@/lib/leadServer";

// SCRUM-81/AC1, AC3, AC6: the Lead's active coordinators with their workload counts (0 included).
// SCRUM-126/AC11: a designed empty state.
export function LeadCoordinatorList({ coordinators }: { coordinators: LeadCoordinator[] }) {
  if (coordinators.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-10 text-center">
        <Users className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No coordinators are assigned to you.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event Coordinator</TableHead>
            <TableHead>Active events</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {coordinators.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">
                <Link className="underline-offset-4 hover:underline" href={`/lead/coordinators/${c.id}`}>{c.full_name}</Link>
              </TableCell>
              <TableCell>{c.workload}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

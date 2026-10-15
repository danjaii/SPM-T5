import Link from "next/link";
import type { LeadCoordinator } from "@/lib/leadServer";

// SCRUM-81/AC1, AC3, AC6: the Lead's active coordinators with their workload counts (0 included).
export function LeadCoordinatorList({ coordinators }: { coordinators: LeadCoordinator[] }) {
  if (coordinators.length === 0) return <p className="empty">No coordinators are assigned to you.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event Coordinator</th>
            <th>Active events</th>
          </tr>
        </thead>
        <tbody>
          {coordinators.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/lead/coordinators/${c.id}`}>{c.full_name}</Link></td>
              <td>{c.workload}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

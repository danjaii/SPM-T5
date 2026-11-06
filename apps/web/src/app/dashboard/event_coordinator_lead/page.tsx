import { redirect } from "next/navigation";

/**
 * SCRUM-188/AC1, AC2: the Lead's home is the unassigned queue, which already shows what the SCRUM-162 dashboard summarised.
 * Sign-in, "/", the access-denied page and "Back to dashboard" all send a role to /dashboard/<role>, so this address stays
 * and forwards rather than being removed.
 */
export default function EventCoordinatorLeadDashboard() {
  redirect("/lead/queue");
}

import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { SafetyOfficerHome, StartNextCheck } from "@/components/SafetyOfficerHome";
import { getSafetyHome } from "@/lib/safetyCheckServer";
import { greeting } from "@/lib/safetyHome";
import { getShellData } from "@/lib/shellServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Safety Officer Home · ConnectSphere" };

/**
 * SCRUM-165 (Figma 19): the Safety Officer Home: a greeting, four figures, the events waiting for a safety check (the
 * count links to /safety-checks, one back after changes is "Re-check needed") and the latest decisions. Replaces SCRUM-116's
 * empty dashboard and SCRUM-99/AC2's link, which the count and the Safety checks panel now are.
 */
export default async function SafetyOfficerDashboard() {
  const [shell, result] = await Promise.all([getShellData(), getSafetyHome()]);
  const title = greeting(shell?.user.fullName ?? "");

  if ("error" in result) return <PageFrame title={title} description="Events waiting for a safety check." error={result.error} />;

  const { ready } = result.home;
  const rechecks = ready.filter((e) => e.recheck).length;
  const description =
    ready.length === 0
      ? "No events are waiting for a safety check."
      : `${ready.length} ${ready.length === 1 ? "event is" : "events are"} ready for a safety check.${rechecks > 0 ? ` ${rechecks} ${rechecks === 1 ? "needs" : "need"} a re-check.` : ""}`;

  return (
    <PageFrame title={title} description={description} action={<StartNextCheck home={result.home} />}>
      <SafetyOfficerHome home={result.home} />
    </PageFrame>
  );
}

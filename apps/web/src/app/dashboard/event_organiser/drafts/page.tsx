import type { Metadata } from "next";
import { BfcacheGuard } from "@/components/BfcacheGuard";
import { OrganiserHome } from "@/components/OrganiserHome";
import { PageFrame } from "@/components/PageFrame";
import { getOrganiserHome } from "@/lib/organiserHomeServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Drafts · ConnectSphere" };

const DESCRIPTION = "Requests you have started but not submitted.";

/** SCRUM-124/AC2: the sidebar's Drafts item. It is Home (SCRUM-159) opened on its Drafts tab, which lists only drafts, each with its Draft badge. */
export default async function OrganiserDraftsPage() {
  const result = await getOrganiserHome();
  if ("error" in result) return <PageFrame title="Drafts" description={DESCRIPTION} error={result.error} />;

  return (
    <PageFrame title="Drafts" description={DESCRIPTION}>
      <BfcacheGuard />
      <OrganiserHome events={result.events} now={new Date().toISOString()} initialTab="drafts" />
    </PageFrame>
  );
}

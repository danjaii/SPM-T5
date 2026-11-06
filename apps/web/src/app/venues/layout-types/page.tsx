import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { LayoutTypeManager } from "@/components/LayoutTypeManager";
import { canManageLayoutTypes, getLayoutTypes } from "@/lib/layoutTypesServer";
import { BackLink, PAGE_MAIN, PageTitle } from "@/components/PageFrame";

// Rendered per request: who may manage layout types depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Layout types · ConnectSphere" };

// SCRUM-181: Venue Staff add, rename and delete room layout types. Anyone else is told why they cannot (181-S6); the service and
// the database refuse them too.
export default async function LayoutTypesPage() {
  const allowed = await canManageLayoutTypes();
  const loaded = allowed ? await getLayoutTypes() : undefined;

  return (
    <main className={PAGE_MAIN}>
      <BackLink href="/venues" to="venue catalogue" />
      <PageTitle>Layout types</PageTitle>
      {!allowed ? (
        <AuthAlert tone="error">Only venue staff can manage layout types.</AuthAlert>
      ) : loaded && "layoutTypes" in loaded ? (
        <>
          <p className="text-sm text-muted-foreground">
            The layouts a venue can offer. A new layout type is offered when adding or editing a venue straight away. A layout type that a venue
            uses cannot be deleted until the venue no longer offers it.
          </p>
          <LayoutTypeManager initial={loaded.layoutTypes} />
        </>
      ) : (
        <AuthAlert tone="error">{loaded && "error" in loaded ? loaded.error : "Something went wrong. Please try again."}</AuthAlert>
      )}
    </main>
  );
}

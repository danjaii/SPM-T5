import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { LayoutTypeManager } from "@/components/LayoutTypeManager";
import { canManageLayoutTypes, getLayoutTypes } from "@/lib/layoutTypesServer";

// Rendered per request: who may manage layout types depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Layout types · ConnectSphere" };

// SCRUM-181: Venue Staff add, rename and delete room layout types. Anyone else is told why they cannot (181-S6); the service and
// the database refuse them too.
export default async function LayoutTypesPage() {
  const allowed = await canManageLayoutTypes();
  const loaded = allowed ? await getLayoutTypes() : undefined;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 md:px-8">
      <Link
        href="/venues"
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to venue catalogue
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Layout types</h1>
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

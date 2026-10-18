import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getShellData } from "@/lib/shellServer";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";

// Rendered per request: the link home depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Access denied · ConnectSphere" };

/** SCRUM-122/AC3: where the route guard sends someone who opens a page outside their role. Shown inside the app shell. */
export default async function AccessDeniedPage() {
  const shell = await getShellData();
  if (!shell) redirect("/login");
  const { role } = shell.user;

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center justify-items-center gap-3">
          <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-status-danger text-status-danger-fg">
            <ShieldAlert className="size-6" />
          </span>
          <CardTitle className="text-xl font-bold">
            <h1>You don&apos;t have access to this page</h1>
          </CardTitle>
          <CardDescription>
            This page isn&apos;t part of the {roleLabel(role)} role. Your home page has everything you can use.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/dashboard/${role}`} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            Go to my home
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}

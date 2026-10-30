"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LINKED_ROW_CLASS, openRowLink } from "@/lib/rowLink";
import { cn } from "@/lib/utils";

// SCRUM-151/AC2-AC4: a plain table row that opens `href` from a click anywhere on it, for the server-rendered dashboard
// tables. Keyboard users still reach the page through the link inside the row.
// SCRUM-159: `className` adds the row look of the table it sits in (e.g. the shadcn table's border).
export function LinkedRow({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr className={cn(LINKED_ROW_CLASS, className)} onClick={(e) => openRowLink(e, router.push, href)}>
      {children}
    </tr>
  );
}

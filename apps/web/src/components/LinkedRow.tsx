"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LINKED_ROW_CLASS, openRowLink } from "@/lib/rowLink";

// SCRUM-151/AC2-AC4: a plain table row that opens `href` from a click anywhere on it, for the server-rendered dashboard
// tables. Keyboard users still reach the page through the link inside the row.
export function LinkedRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr className={LINKED_ROW_CLASS} onClick={(e) => openRowLink(e, router.push, href)}>
      {children}
    </tr>
  );
}

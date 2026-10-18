"use client";

import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import type { Role } from "@spm-t5/shared";
import { NavItem } from "@/components/ui/nav-item";
import { currentHref, NAV_ITEMS, type QueueCounts } from "@/lib/nav";

// SCRUM-121/AC1 + AC2: only the signed-in role's items, the current one highlighted, and a count beside a queue that has items.
export function SidebarNav({ role, counts, onNavigate }: { role: Role; counts: QueueCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = NAV_ITEMS[role];
  const current = currentHref(items, pathname);

  // NavItem is a plain anchor; a plain left click goes through the router so the shell stays mounted.
  function go(e: MouseEvent<HTMLAnchorElement>, href: string) {
    onNavigate?.();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.push(href);
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ label, href, icon: Icon, queue }) => {
        const count = queue ? counts[queue] : undefined;
        return (
          <NavItem
            key={href}
            onDark
            href={href}
            label={label}
            icon={<Icon />}
            count={count !== undefined && count > 0 ? count : undefined}
            selected={href === current}
            onClick={(e) => go(e, href)}
          />
        );
      })}
    </nav>
  );
}

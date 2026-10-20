"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { Logo } from "@/components/Logo";
import { NotificationBell } from "@/components/NotificationBell";
import { roleLabel } from "@/lib/roles";
import { ShellContext, type ShellState } from "./ShellContext";
import { SidebarNav } from "./SidebarNav";

// Pages that are shown before sign-in have no shell, even if a stale session cookie is still around.
const BARE = /^\/(login|register|forgot-password|reset-password)(\/|$)/;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function SidebarBody({ shell, onNavigate, onClose }: { shell: ShellState; onNavigate?: () => void; onClose?: () => void }) {
  const { user, counts } = shell;
  const onProfile = /^\/profile(\/|$)/.test(usePathname());
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <span className="text-nav-text [&_.logo]:text-nav-text">
          <Logo />
        </span>
        <span className="flex items-center gap-1">
          <span className="shell-bell relative"><NotificationBell /></span>
          {onClose && (
            <button type="button" aria-label="Close menu" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg text-nav-text hover:bg-nav-chip focus-visible:ring-2 focus-visible:ring-ring">
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </span>
      </div>
      <div className="mx-4 mt-3 rounded-lg bg-nav-chip px-3 py-1.5 text-xs font-medium text-nav-muted">{roleLabel(user.role)}</div>
      <div className="mt-4 flex-1 overflow-y-auto px-3">
        <SidebarNav role={user.role} counts={counts} onNavigate={onNavigate} />
      </div>
      <div className="flex items-center gap-2 border-t border-nav-border p-3">
        {/* SCRUM-122/AC12: the name opens the user's profile; there is no "My profile" nav item */}
        <Link
          href="/profile"
          onClick={onNavigate}
          aria-current={onProfile ? "page" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring ${onProfile ? "bg-nav-active" : "hover:bg-nav-chip"}`}
        >
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-highlight text-xs font-bold text-fg-primary">
            {initials(user.fullName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-nav-text"><span className="sr-only">My profile: </span>{user.fullName}</span>
            <span className="block truncate text-xs text-nav-muted">{roleLabel(user.role)}</span>
          </span>
        </Link>
        <LogoutButton />
      </div>
    </>
  );
}

/** SCRUM-121: the one app shell: a left sidebar from md up, a top bar with a slide-in menu below it. */
export function ShellFrame({ shell, children }: { shell: ShellState | null; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // SCRUM-121/AC3: the menu closes when the route changes and on Escape
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!shell || BARE.test(pathname)) return <>{children}</>;

  return (
    <ShellContext.Provider value={shell}>
      <div className="app-shell flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-nav-sidebar md:flex" aria-label="Sidebar">
          <SidebarBody shell={shell} />
        </aside>
        <div className="min-w-0 flex-1">
          <div className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-nav-sidebar px-4 md:hidden">
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen(true)}
              className="flex size-10 items-center justify-center rounded-lg text-nav-text hover:bg-nav-chip focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Menu aria-hidden="true" className="size-5" />
            </button>
            <span className="text-nav-text [&_.logo]:text-nav-text"><Logo /></span>
          </div>
          {children}
        </div>
        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-foreground/50" onClick={() => setOpen(false)} />
            <div id="mobile-menu" role="dialog" aria-label="Menu" className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col bg-nav-sidebar">
              <SidebarBody shell={shell} onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </ShellContext.Provider>
  );
}

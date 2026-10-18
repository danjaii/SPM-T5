import type { ReactNode } from "react";
import { roleLabel } from "@/lib/roles";
import { LogoutButton } from "./LogoutButton";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";

/**
 * The bar at the top of every signed-in page: the logo, then who is signed in (where the page knows), the notification
 * bell (SCRUM-47/AC11) and Log out. `children` take Log out's place on a page that shows something else there.
 */
export function AppHeader({ user, children }: { user?: { fullName: string; role: string }; children?: ReactNode }) {
  return (
    <header className="dash__bar">
      <Logo />
      <div className="dash__who">
        {user && (
          <span>
            {user.fullName} <span className="dash__role">{roleLabel(user.role)}</span>
          </span>
        )}
        <NotificationBell />
        {children ?? <LogoutButton />}
      </div>
    </header>
  );
}

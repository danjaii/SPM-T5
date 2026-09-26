import type { ReactNode } from "react";
import { Logo } from "./Logo";

/** The two-panel shell shared by sign in, register and password reset (per the sign-in mockup). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__brand">
        <Logo />
        <div>
          <div className="auth__eyebrow">Event operations platform</div>
          <p className="auth__headline">Every venue, every arrangement, one record.</p>
          <p className="auth__sub">
            Plan conferences, hold rooms, approve equipment and keep clients informed — without a single spreadsheet.
          </p>
        </div>
        <div className="auth__version">v1.4.2 · internal &amp; client access</div>
      </aside>
      <main className="auth__panel">
        <div className="auth__form">{children}</div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { canViewVenueCatalogue, isRole } from "@spm-t5/shared";
import { roleLabel } from "@/lib/roles";
import { BfcacheGuard } from "./BfcacheGuard";
import { LogoutButton } from "./LogoutButton";
import { Logo } from "./Logo";

export interface DashboardData {
  user: { fullName: string; email: string; role: string };
  sections: {
    title: string;
    /** linkKey: the row field holding a link for this column's value (set by auth-service, e.g. an event's status page). */
    columns: { key: string; label: string; linkKey?: string }[];
    rows: Record<string, string | number>[];
  }[];
}

export function DashboardView({ data }: { data: DashboardData }) {
  const { user, sections } = data;
  return (
    <>
      <BfcacheGuard />
      <header className="dash__bar">
        <Logo />
        <div className="dash__who">
          <span>
            {user.fullName} <span className="dash__role">{roleLabel(user.role)}</span>
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="dash__main">
        <h1>{roleLabel(user.role)} dashboard</h1>
        <p className="dash__lede">Signed in as {user.email}</p>
        {/* SCRUM-29 AC3 + AC4 + AC6 + AC7: same shared rule venue-service uses — coordinators and venue staff only */}
        {/* if role is event coord or venue staff, we show the link that leads them to see the venue catalogue */}
        {isRole(user.role) && canViewVenueCatalogue(user.role) && (
          <nav className="dash__links">
            <Link href="/venues">Venue catalogue</Link>
            {/* SCRUM-37/AC7: the pending request queue is for venue staff only */}
            {user.role === "venue_staff" && <Link href="/booking-queue">Pending booking requests</Link>}
          </nav>
        )}
        {sections.map((section) => (
          <section className="dash__section" key={section.title}>
            <h2>{section.title}</h2>
            <div className="table-wrap">
              {section.rows.length === 0 ? (
                <p className="empty">Nothing to show yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>{section.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, i) => (
                      <tr key={i}>
                        {section.columns.map((c) => {
                          const href = c.linkKey ? row[c.linkKey] : undefined;
                          return <td key={c.key}>{href ? <Link href={String(href)}>{row[c.key]}</Link> : row[c.key]}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { canViewVenueCatalogue, isLead, isRole } from "@spm-t5/shared";
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

/** children: extra sections a role's page adds below the tables (e.g. the attendee's List of events, SCRUM-71). */
export function DashboardView({ data, children }: { data: DashboardData; children?: ReactNode }) {
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
        <p className="dash__lede">Signed in as {user.fullName}</p>
        {/* SCRUM-68: every signed-in user has a profile to view and update, whatever their role */}
        <nav className="dash__links">
          <Link href="/profile">My profile</Link>
        </nav>
        {/* SCRUM-74/AC2: organisers and coordinators both see the registrations of the events they manage */}
        {(user.role === "event_organiser" || user.role === "event_coordinator") && (
          <nav className="dash__links">
            <Link href="/registrations-overview">Event registrations</Link>
          </nav>
        )}
        {/* SCRUM-29 AC3 + AC4 + AC6 + AC7: same shared rule venue-service uses — coordinators and venue staff only */}
        {/* if role is event coord or venue staff, we show the link that leads them to see the venue catalogue */}
        {isRole(user.role) && canViewVenueCatalogue(user.role) && (
          <nav className="dash__links">
            <Link href="/venues">Venue catalogue</Link>
            {/* SCRUM-65: searching venues for an event is for event coordinators */}
            {user.role === "event_coordinator" && <Link href="/venues/search">Search venues</Link>}
            {/* SCRUM-37/AC7: the pending request queue is for venue staff only */}
            {user.role === "venue_staff" && <Link href="/booking-queue">Pending booking requests</Link>}
          </nav>
        )}
        {/* SCRUM-18 (18-S13): the equipment availability check is for Technical Support Staff only */}
        {user.role === "technical_support_staff" && (
          <nav className="dash__links">
            <Link href="/equipment-availability">Check equipment availability</Link>
            {/* SCRUM-19: reserving equipment is for Technical Support Staff only */}
            <Link href="/equipment-reservation">Reserve equipment</Link>
            {/* SCRUM-87/AC7: reviewing equipment requests is for Technical Support Staff only */}
            <Link href="/equipment-requests">Equipment requests</Link>
          </nav>
        )}
        {/* SCRUM-75/AC4: the Lead home page links to the unassigned event queue and the coordinator overview */}
        {isLead(user.role) && (
          <nav className="dash__links">
            <Link href="/lead/queue">Unassigned event requests</Link>
            <Link href="/lead/coordinators">Coordinator overview</Link>
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
        {children}
      </main>
    </>
  );
}

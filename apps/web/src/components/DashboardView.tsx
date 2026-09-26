import { roleLabel } from "@/lib/roles";
import { BfcacheGuard } from "./BfcacheGuard";
import { LogoutButton } from "./LogoutButton";
import { Logo } from "./Logo";

export interface DashboardData {
  user: { fullName: string; email: string; role: string };
  sections: {
    title: string;
    columns: { key: string; label: string }[];
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
                      <tr key={i}>{section.columns.map((c) => <td key={c.key}>{row[c.key]}</td>)}</tr>
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

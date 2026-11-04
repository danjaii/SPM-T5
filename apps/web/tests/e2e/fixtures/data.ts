import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "./env";

// Arranging data for a test. The service-role REST API bypasses row-level security, so it can create rows a signed-in user
// never could (an event already Confirmed, a venue with set buffers). It is for arranging and for checking what the screen
// cannot prove, never for the action under test: that goes through the UI.
//
// Every row a test creates is tracked and deleted afterwards, in reverse order, so tests assert only on data they made
// (CLAUDE.md, SCRUM-143) and leave the shared database as they found it.

export async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not set: run from the repo with a root .env, or export the local service-role key");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function userId(email: string): Promise<string> {
  const rows = await rest<{ id: string }[]>(`users?select=id&email=eq.${encodeURIComponent(email)}`);
  if (!rows[0]) throw new Error(`no seeded user ${email}`);
  return rows[0].id;
}

/** Test data for one test: unique names, and cleanup of everything it inserted. */
export class TestData {
  private created: { table: string; id: string }[] = [];
  private readonly prefix: string;
  private readonly suffix = Math.random().toString(36).slice(2, 7);

  /** @param caseId the catalogue ID taken from the test title, e.g. E2E-CONF-02 */
  constructor(caseId: string) {
    this.prefix = caseId;
  }

  /** A name nobody else's test will produce, e.g. "E2E-CONF-02 Orchid k3j9a". */
  name(label: string): string {
    return `${this.prefix} ${label} ${this.suffix}`;
  }

  rest = rest;
  userId = userId;

  /** Inserts a row, remembers it for cleanup, and returns it. */
  async insert<T extends { id: string }>(table: string, row: Record<string, unknown>): Promise<T> {
    const [created] = await rest<T[]>(table, { method: "POST", body: JSON.stringify(row) });
    this.created.push({ table, id: created.id });
    return created;
  }

  /** Remembers a row some other call created (a UI action) so cleanup removes it too. */
  track(table: string, id: string): void {
    this.created.push({ table, id });
  }

  /** Deletes tracked rows, newest first. A failed delete is reported, not thrown: it must not hide the test's own result. */
  async cleanup(): Promise<void> {
    for (const { table, id } of this.created.reverse()) {
      try {
        await rest(`${table}?id=eq.${id}`, { method: "DELETE" });
      } catch (error) {
        console.warn(`[${this.prefix}] cleanup of ${table} ${id} failed:`, (error as Error).message);
      }
    }
    this.created = [];
  }
}

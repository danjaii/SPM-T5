import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// In-memory stand-in for Supabase (Auth + the tables auth-service touches).
// ---------------------------------------------------------------------------
export type Row = Record<string, unknown>;

export interface AuthUser { id: string; email: string; password: string; confirmed: boolean }

export function createFake() {
  const authUsers: AuthUser[] = [];
  const sessions = new Map<string, string>(); // access token -> user id
  const tables: Record<string, Row[]> = {
    users: [], events: [], venues: [], venue_bookings: [], equipment: [], technical_support_requests: [], event_registrations: [], organisations: [], role_responsibilities: [],
  };
  const calls = { resetEmails: [] as { email: string; redirectTo?: string }[], signedOut: [] as string[], deleted: [] as string[] };
  const selects: { table: string; columns: string }[] = []; // every select() the app issued, to pin PostgREST embeds
  let counter = 0;
  const failProfileInsert = { value: false };
  const failReads = { value: false };
  const failUpdates = { value: false };
  const signUpError = { value: null as null | { status: number; code: string; message: string } };

  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let changes: Row | undefined; // set by update(): applied to the matching rows when the query is awaited
    const builder = {
      select: (columns?: string) => { selects.push({ table, columns: columns ?? "" }); return builder; },
      eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder; },
      in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder; },
      update: (values: Row) => { changes = values; return builder; },
      // sorts by the column when the rows have comparable values there; rows without one keep their order
      order: (col?: string, opts?: { ascending?: boolean }) => {
        const dir = opts?.ascending === false ? -1 : 1;
        if (col) rows.sort((a, b) => (typeof a[col] === "number" && typeof b[col] === "number" ? ((a[col] as number) - (b[col] as number)) * dir : 0));
        return builder;
      },
      limit: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: async (row: Row) => {
        if (failProfileInsert.value) return { error: { message: "boom" } };
        if (tables[table].some((r) => r.email === row.email)) return { error: { message: "duplicate" } };
        tables[table].push(row);
        return { error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (changes) {
          if (failUpdates.value) return resolve({ error: { message: "db down" } });
          // like the real users.email unique constraint (Postgres error 23505)
          const taken = changes.email !== undefined && (tables[table] ?? []).some((r) => r.email === changes!.email && !rows.includes(r));
          if (taken) return resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
          rows.forEach((r) => Object.assign(r, changes));
          return resolve({ error: null });
        }
        return resolve(failReads.value ? { data: null, error: { message: "db down" } } : { data: rows, error: null });
      },
    };
    return builder;
  };

  const userFor = (token: string) => authUsers.find((u) => u.id === sessions.get(token));

  const anon = {
    auth: {
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const user = authUsers.find((u) => u.email === email && u.password === password && u.confirmed);
        if (!user) return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
        const token = `token-${++counter}`;
        sessions.set(token, user.id);
        return { data: { user: { id: user.id, email: user.email }, session: { access_token: token, expires_in: 3600 } }, error: null };
      },
      signUp: async ({ email, password }: { email: string; password: string }) => {
        if (signUpError.value) return { data: { user: null, session: null }, error: signUpError.value };
        if (authUsers.some((u) => u.email === email)) {
          return { data: { user: { id: "ignored", email, identities: [] }, session: null }, error: null };
        }
        const user = { id: `user-${++counter}`, email, password, confirmed: false };
        authUsers.push(user);
        return { data: { user: { id: user.id, email, identities: [{}] }, session: null }, error: null };
      },
      getUser: async (token: string) => {
        const user = userFor(token) ?? authUsers.find((u) => `reset-${u.id}` === token);
        return user ? { data: { user: { id: user.id, email: user.email } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } };
      },
      resetPasswordForEmail: async (email: string, opts?: { redirectTo?: string }) => {
        calls.resetEmails.push({ email, redirectTo: opts?.redirectTo });
        return { data: {}, error: null };
      },
    },
  };

  const admin = {
    from: (table: string) => query(table),
    auth: {
      admin: {
        signOut: async (token: string) => { sessions.delete(token); calls.signedOut.push(token); return { error: null }; },
        deleteUser: async (id: string) => { authUsers.splice(authUsers.findIndex((u) => u.id === id), 1); calls.deleted.push(id); return { error: null }; },
        updateUserById: async (id: string, attrs: { password: string }) => {
          const user = authUsers.find((u) => u.id === id);
          if (user) user.password = attrs.password;
          return { error: null };
        },
      },
    },
  };

  const deps = { anon, admin, forUser: () => ({ from: (t: string) => query(t) }) } as unknown as SupabaseDeps;

  /** Seeds an account that can log in (verified email + profile row). */
  const seedUser = (email: string, role: string, extra: Partial<AuthUser> & { isActive?: boolean } = {}) => {
    const id = `seed-${++counter}`;
    authUsers.push({ id, email, password: "Passw0rd!", confirmed: extra.confirmed ?? true });
    tables.users.push({ id, email, role, full_name: email.split("@")[0], is_active: extra.isActive ?? true });
    return id;
  };

  return { deps, tables, authUsers, sessions, calls, selects, seedUser, failProfileInsert, failReads, failUpdates, signUpError };
}

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createApp } from "../../../src/app";
import { createSupabaseDeps } from "../../../src/supabase";

/**
 * Live tests run against local Supabase (`supabase start`), never the hosted project: sign-up there sends
 * real confirmation emails. They need SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY from
 * `supabase status -o env`; without them the suites skip instead of failing (README → Database integration tests).
 */
const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SECRET_KEY: secretKey } = process.env;
export const hasDb = Boolean(url && publishableKey && secretKey);

if (hasDb && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url!)) {
  throw new Error(`Live tests only run against local Supabase, not ${url}. Export the values from \`supabase status -o env\`.`);
}

/** Every account these tests create starts with this, so cleanup can find them (and leftovers from a crashed run). */
const PREFIX = "it-reg-";

export function uniqueEmail(): string {
  return `${PREFIX}${Math.random().toString(36).slice(2, 10)}@example.com`;
}

/** The real app, wired to local Supabase exactly as server.ts wires it. */
export function liveApp() {
  return createApp(createSupabaseDeps());
}

/** Secret key: test setup and checks only (bypasses RLS). */
export function adminClient(): SupabaseClient {
  return createClient(url!, secretKey!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Whether Supabase Auth accepts this email + password, i.e. it holds the (hashed) password for the account. */
export async function canSignIn(email: string, password: string): Promise<boolean> {
  const anon = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anon.auth.signInWithPassword({ email, password });
  return !error;
}

async function allAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users;
}

/** Auth accounts and public.users profile rows for this email, ignoring letter case. */
export async function accountsFor(admin: SupabaseClient, email: string) {
  const authUsers = (await allAuthUsers(admin)).filter((u) => u.email?.toLowerCase() === email.toLowerCase());
  const { data: profiles, error } = await admin.from("users").select("*").ilike("email", email);
  if (error) throw new Error(error.message);
  return { authUsers, profiles: profiles as Record<string, unknown>[] };
}

/** An existing attendee (auth account + profile row), made with the secret key rather than the code under test. */
export async function seedAccount(admin: SupabaseClient, email: string): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: "Passw0rd!", email_confirm: true });
  if (error) throw new Error(error.message);
  const { error: profileError } = await admin
    .from("users")
    .insert({ id: data.user.id, role: "attendee", full_name: "Seeded Attendee", email });
  if (profileError) throw new Error(profileError.message);
}

/** Deletes every test account; the profile row goes with it (users.id → auth.users on delete cascade). */
export async function deleteTestAccounts(admin: SupabaseClient): Promise<void> {
  const mine = (await allAuthUsers(admin)).filter((u) => u.email?.toLowerCase().startsWith(PREFIX));
  await Promise.all(mine.map((u) => admin.auth.admin.deleteUser(u.id)));
}

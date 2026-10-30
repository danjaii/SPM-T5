import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SCRUM-53/AC4: how migration 60 defines create_event_draft. The suite has no way to read the database catalogue (no SQL driver),
 * so this reads the migration text, which is what the CI migrate job applies. The database behaviour that follows from it (a
 * direct insert is refused, an anonymous caller cannot execute the function, a coordinator gets 42501) is asserted in
 * tests/integration/eventDraftCreateRls.test.ts. The real catalogue was also checked by hand: see the SCRUM-53 report.
 */
const SQL = readFileSync(resolve(__dirname, "../../../../supabase/migrations/60_event_drafts.sql"), "utf8");
const SIGNATURE = "text, text, text, timestamptz, timestamptz, int, text, uuid, text, text, boolean, int, timestamptz, timestamptz";

/** The text of one statement, from its first line to its terminating semicolon (or $$; for a function body). */
const functionStatement = SQL.slice(SQL.indexOf("create function create_event_draft"), SQL.indexOf("$$;") + 3);

describe("SCRUM-53/AC4 create_event_draft is a security definer function with a fixed search_path", () => {
  it("is security definer, not invoker", () => {
    expect(functionStatement).toMatch(/\bsecurity definer\b/i);
    expect(functionStatement).not.toMatch(/\bsecurity invoker\b/i);
  });

  it("pins search_path to public, pg_temp, so a caller cannot redirect what it resolves", () => {
    expect(functionStatement).toMatch(/set search_path = public, pg_temp\b/i);
  });

  it("checks the caller itself: signed in and an event organiser, else 42501", () => {
    expect(functionStatement).toMatch(/auth\.uid\(\) is null/i);
    expect(functionStatement).toMatch(/current_user_role\(\)[^;]*'event_organiser'/i);
    expect(functionStatement).toMatch(/errcode = '42501'/i);
  });

  it("takes the organiser from auth.uid() and fixes the status, never from an argument", () => {
    expect(functionStatement).toMatch(/auth\.uid\(\), \(select u\.organisation_id from users u where u\.id = auth\.uid\(\)\)/i);
    expect(functionStatement).toMatch(/'draft', true, null/);
    expect(functionStatement).not.toMatch(/p_organiser|p_status|p_submitted_at/i);
  });
});

describe("SCRUM-53/AC4 who may execute create_event_draft", () => {
  it("revokes execute from public and anon, then grants it to authenticated only", () => {
    const revoke = SQL.indexOf(`revoke execute on function create_event_draft(\n  ${SIGNATURE}\n) from public, anon;`);
    const grant = SQL.indexOf(`grant execute on function create_event_draft(\n  ${SIGNATURE}\n) to authenticated;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(SQL).not.toMatch(/grant execute on function create_event_draft[^;]*\bto\b[^;]*\b(anon|public)\b/i);
  });

  it("adds no INSERT policy on events: the function is the only way to save a draft", () => {
    const code = SQL.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(code).not.toMatch(/create policy/i);
  });
});

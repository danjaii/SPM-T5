import type { AddressInfo } from "node:net";
import { targetKey, type AccessReader, type Target } from "../../src/readers/accessReader";
import type { NotificationRepository, NotificationRow } from "../../src/repositories/notificationRepository";
import type { SupabaseDeps } from "../../src/supabase";
import { createApp } from "../../src/app";

export function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "user-1",
    event_id: null,
    venue_booking_id: null,
    type: "event_submitted",
    title: "Event request submitted",
    message: "Your request has been submitted.",
    is_read: false,
    created_at: "2026-10-01T09:00:00Z",
    read_at: null,
    ...over,
  };
}

/** In-memory notifications that, like row level security, only ever answer for the asking user. */
export class FakeRepo implements NotificationRepository {
  queries: { userId: string; limit?: number }[] = [];
  constructor(public rows: NotificationRow[]) {}

  async list(userId: string, limit: number) {
    this.queries.push({ userId, limit });
    return this.rows
      .filter((r) => r.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  async countUnread(userId: string) {
    return this.rows.filter((r) => r.user_id === userId && !r.is_read).length;
  }
  async find(userId: string, id: string) {
    return this.rows.find((r) => r.id === id && r.user_id === userId) ?? null;
  }
  async markRead(userId: string, id: string) {
    const found = this.rows.find((r) => r.id === id && r.user_id === userId);
    if (!found) return null;
    found.is_read = true;
    found.read_at ??= "2026-10-15T01:00:00Z";
    return { ...found };
  }
}

export class FakeAccess implements AccessReader {
  constructor(
    public visible: Record<string, string> = {},
    public role: string | undefined = "event_coordinator",
  ) {}
  async roleOf() {
    return this.role;
  }
  async visibleLabels(targets: Target[]) {
    const out = new Map<string, string>();
    for (const t of targets) {
      const label = this.visible[targetKey(t)];
      if (label) out.set(targetKey(t), label);
    }
    return out;
  }
}

/** "good-token" belongs to user-1, "other-token" to user-2; anything else is not signed in. */
export const deps = {
  anon: {
    auth: {
      getUser: async (token: string) => {
        const id = token === "good-token" ? "user-1" : token === "other-token" ? "user-2" : undefined;
        return id ? { data: { user: { id } } } : { data: { user: null } };
      },
    },
  },
  forUser: () => {
    throw new Error("not used here");
  },
} as unknown as SupabaseDeps;

export const COOKIE = "cs_session=good-token";

/** Starts the app on a free port; returns a base URL and a stop function. */
export async function serve(repo: NotificationRepository, access: AccessReader) {
  const server = createApp(deps, { repoFor: () => repo, accessFor: () => access }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, stop: () => new Promise((resolve) => server.close(resolve)) };
}

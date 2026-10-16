import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseUserReader } from "../../src/readers/userReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { QueueService } from "../../src/services/queueService";
import { adminClient, DB_ENV, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-37 against real Postgres, reading as seeded Venue Staff so RLS (migration 07) applies:
 * they see every pending request, oldest first, and decided or withdrawn ones are left out.
 */
const STAFF = "kenneth.wong@connectsphere.example.com";
const COORDINATOR = "rachel.tan@connectsphere.example.com";

describe.skipIf(!hasDb)("SCRUM-37 pending request queue against Postgres", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  let queue: QueueService;
  let staffId: string;
  let coordinatorId: string;

  /** A booking inserted with the secret key. Own event and venue each, so the DR5/DR6 constraints never interfere. */
  async function arrange(day: number, extra: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: await fixtures.event("approved", coordinatorId),
        venue_id: await fixtures.venue(),
        requested_by: coordinatorId,
        status: "requested",
        event_start_datetime: `2030-10-${day}T01:00:00Z`,
        event_end_datetime: `2030-10-${day}T09:00:00Z`,
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  beforeAll(async () => {
    if (!DB_ENV.publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY must be set for the RLS tests (see README).");
    const staff = await signInAs(STAFF);
    staffId = staff.userId;
    coordinatorId = (await signInAs(COORDINATOR)).userId;
    queue = new QueueService({
      bookings: new SupabaseBookingRepository(staff.client),
      venues: new SupabaseVenueReader(staff.client),
      users: new SupabaseUserReader(staff.client),
    });
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  const caller = () => ({ id: staffId, role: "venue_staff" as const });

  it("37-S1/S2 lists pending requests with names, earliest submission first, equal times by id", async () => {
    const early = await arrange(11, { created_at: "2030-01-01T09:00:00Z" });
    const [tieA, tieB] = [await arrange(12, { created_at: "2030-01-01T10:00:00Z" }), await arrange(13, { created_at: "2030-01-01T10:00:00Z" })].sort();
    const late = await arrange(14, { created_at: "2030-01-01T11:00:00Z" });
    const mine = new Set([early, tieA, tieB, late]);

    const items = (await queue.list(caller())).filter((i) => mine.has(i.id));
    expect(items.map((i) => i.id)).toEqual([early, tieA, tieB, late]);
    expect(items[0]).toMatchObject({ requestedByName: "Rachel Tan", date: "2030-10-11", startTime: "09:00", endTime: "17:00" });
  });

  it("37-S3 approved, rejected and withdrawn requests are not listed", async () => {
    const pending = await arrange(15);
    const others = [
      await arrange(16, { status: "approved", reviewed_by: staffId, reviewed_at: new Date().toISOString() }),
      await arrange(17, { status: "rejected", reviewed_by: staffId, reviewed_at: new Date().toISOString(), review_notes: "No" }),
      await arrange(18, { status: "withdrawn", withdrawn_by: coordinatorId, withdrawn_at: new Date().toISOString() }),
    ];
    const ids = (await queue.list(caller())).map((i) => i.id);
    expect(ids).toContain(pending);
    for (const id of others) expect(ids).not.toContain(id);
  });

  it("37-S4 an amendment is listed with the request it amends", async () => {
    const r1 = await arrange(19, { status: "rejected", reviewed_by: staffId, reviewed_at: new Date().toISOString(), review_notes: "Booked" });
    const r2 = await arrange(20, { amends_booking_id: r1 });
    const item = (await queue.list(caller())).find((i) => i.id === r2);
    expect(item?.amendsRequestId).toBe(r1);
  });

  it("37-S6 a decided request shows who decided it, when, and the reason", async () => {
    const decidedAt = new Date("2030-02-02T03:00:00Z");
    const id = await arrange(21, { status: "rejected", reviewed_by: staffId, reviewed_at: decidedAt.toISOString(), review_notes: "Under maintenance" });
    const detail = await queue.detail(caller(), id);
    expect(detail).toMatchObject({
      status: "REJECTED",
      decidedByName: "Kenneth Wong",
      decidedAt: decidedAt.toISOString(),
      rejectionReason: "Under maintenance",
    });
    await expect(queue.detail(caller(), "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ httpStatus: 404 });
  });

  // SCRUM-113: the note migration 40 stores on a venue booking sent back for review, read as Venue Staff
  it("113-S7 a venue booking sent back for review shows what changed, its room layout by name", async () => {
    const { data: layout } = await admin.from("room_layouts").select("id, name").limit(1).single();
    const id = await arrange(19, {
      sent_back_changes: {
        expected_attendance: { from: 480, to: 600 },
        preferred_room_layout_id: { from: null, to: layout!.id },
      },
      sent_back_at: "2030-01-02T03:00:00Z",
    });

    const detail = await queue.detail(caller(), id);

    expect(detail.sentBack).toEqual({
      sentBackAt: "2030-01-02T03:00:00.000Z",
      changes: [
        { field: "expected_attendance", label: "Expected attendance", from: 480, to: 600 },
        { field: "preferred_room_layout_id", label: "Room layout", from: null, to: layout!.name },
      ],
    });
  });
});

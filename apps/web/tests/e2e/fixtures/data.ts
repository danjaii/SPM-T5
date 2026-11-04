import { SUPABASE_SECRET_KEY, SUPABASE_URL } from "./env";
import { ACCOUNTS, type Persona } from "./accounts";

// Arranging data for a test. The service-role REST API bypasses row-level security, so it can create rows a signed-in user
// never could (an event already Confirmed, a venue with set buffers). It is for arranging and for checking what the screen
// cannot prove, never for the action under test: that goes through the UI.
//
// Every row a test creates is tracked and deleted afterwards, newest first, so tests assert only on data they made
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

export interface VenueRow { id: string; name: string; max_capacity: number }
export interface EventRow { id: string; name: string }
export interface BookingRow { id: string; status: string }
export interface EquipmentRow { id: string; name: string; total_quantity: number }

/** A booking period in Singapore time (UTC+8), as the app reads times a person types. */
export function sgt(day: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const utc = new Date(`${day}T00:00:00Z`);
  utc.setUTCHours(h - 8, m);
  return utc.toISOString();
}

/** Test data for one test: unique names, and cleanup of everything it inserted. */
export class TestData {
  private created: { table: string; query: string }[] = [];
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
  /** The id of a seeded persona's account. */
  idOf = (who: Persona) => userId(ACCOUNTS[who].email);

  /** Inserts a row, remembers it for cleanup, and returns it. */
  async insert<T extends { id: string }>(table: string, row: Record<string, unknown>): Promise<T> {
    const [created] = await rest<T[]>(table, { method: "POST", body: JSON.stringify(row) });
    this.created.push({ table, query: `id=eq.${created.id}` });
    return created;
  }

  /**
   * Remembers rows that a UI action will create, matched by a PostgREST filter (for example `event_id=eq.<id>`), so cleanup
   * removes them too. Register it right after the parent row is inserted: cleanup runs newest first, so the children go
   * before the parent.
   */
  trackWhere(table: string, query: string): void {
    this.created.push({ table, query });
  }

  /** A piece of equipment with `totalQuantity` units, available. Reservations made against it are removed before it is. */
  async equipment(opts: { totalQuantity?: number; label?: string } = {}): Promise<EquipmentRow> {
    const item = await this.insert<EquipmentRow>("equipment", {
      name: this.name(opts.label ?? "Equipment"),
      type: "E2E",
      total_quantity: opts.totalQuantity ?? 10,
      operational_status: "available",
    });
    this.trackWhere("equipment_reservations", `equipment_id=eq.${item.id}`);
    return item;
  }

  /** The reservation rows of a piece of equipment, for checking what a screen cannot show. */
  reservationsOf(item: EquipmentRow): Promise<{ status: string; quantity_reserved: number | null }[]> {
    return rest(`equipment_reservations?select=status,quantity_reserved&equipment_id=eq.${item.id}&order=created_at`);
  }

  /**
   * A venue with the given capacity and buffers (default none). Venue search only offers a venue that is open for the times
   * asked and has the layout asked for (and is accessible, when the event needs that), so give `hours` (Singapore time), `layout` (a
   * seeded layout name, such as "Theatre", seating the whole capacity) and `accessible` for a venue a search should find.
   */
  async venue(opts: { capacity?: number; setupMinutes?: number; turnaroundMinutes?: number; hours?: [string, string]; layout?: string; accessible?: boolean; label?: string } = {}): Promise<VenueRow> {
    const venue = await this.insert<VenueRow>("venues", {
      name: this.name(opts.label ?? "Venue"),
      address: "1 Test Road",
      max_capacity: opts.capacity ?? 200,
      setup_minutes: opts.setupMinutes ?? 0,
      turnaround_minutes: opts.turnaroundMinutes ?? 0,
      ...(opts.hours ? { operating_hours_start: opts.hours[0], operating_hours_end: opts.hours[1] } : {}),
      ...(opts.accessible ? { is_accessible: true, accessibility_notes: "Step-free access." } : {}),
    });
    if (opts.layout) {
      const [layout] = await rest<{ id: string }[]>(`room_layouts?select=id&name=eq.${encodeURIComponent(opts.layout)}`);
      if (!layout) throw new Error(`no seeded layout "${opts.layout}"`);
      await this.insert("venue_supported_layouts", { venue_id: venue.id, room_layout_id: layout.id, max_capacity_for_layout: opts.capacity ?? 200 });
    }
    return venue;
  }

  /**
   * An event, organised by `organiser` and assigned to `coordinator` (null: not assigned yet), in the given status (default
   * approved). Give `day`,
   * `start` and `end` (Singapore time) for an event that has a date: equipment reservation lists only events that have not
   * started and pre-fills the form from the event's times.
   */
  async event(opts: { organiser?: Persona; coordinator?: Persona | null; status?: string; attendance?: number; label?: string; day?: string; start?: string; end?: string; submittedAt?: string } = {}): Promise<EventRow> {
    const [organiser, coordinator] = await Promise.all([this.idOf(opts.organiser ?? "organiser"), opts.coordinator === null ? null : this.idOf(opts.coordinator ?? "coordinator")]);
    const event = await this.insert<EventRow>("events", {
      name: this.name(opts.label ?? "Event"),
      organiser_id: organiser,
      assigned_coordinator_id: coordinator,
      status: opts.status ?? "approved",
      is_draft: false,
      expected_attendance: opts.attendance ?? 50,
      ...(opts.submittedAt ? { submitted_at: opts.submittedAt } : {}),
      ...(opts.day ? { preferred_start_datetime: sgt(opts.day, opts.start ?? "09:00"), preferred_end_datetime: sgt(opts.day, opts.end ?? "17:00") } : {}),
    });
    // bookings and equipment rows a UI action adds for this event go before the event itself
    this.trackWhere("venue_bookings", `event_id=eq.${event.id}`);
    this.trackWhere("equipment_reservations", `event_id=eq.${event.id}`);
    return event;
  }

  /**
   * An equipment request ("requested") from the coordinator side. Technical Support Staff can only see an event once it has
   * technical work (events_select, event_has_technical_work), so an event they reserve for needs one. A "requested" row
   * does not count against availability: only approved and reserved reservations do (18-S8).
   */
  async equipmentRequest(opts: { event: EventRow; equipment: EquipmentRow; quantity?: number; day: string; start: string; end: string }): Promise<{ id: string }> {
    return this.insert<{ id: string }>("equipment_reservations", {
      event_id: opts.event.id,
      equipment_id: opts.equipment.id,
      quantity_requested: opts.quantity ?? 1,
      status: "requested",
      start_datetime: sgt(opts.day, opts.start),
      end_datetime: sgt(opts.day, opts.end),
    });
  }

  /** A booking held at a venue on `day` from `start` to `end` (Singapore time). `requested` is what the app calls Pending. */
  async booking(opts: { event: EventRow; venue: VenueRow; requestedBy: Persona; day: string; start: string; end: string; status?: string }): Promise<BookingRow> {
    return this.insert<BookingRow>("venue_bookings", {
      event_id: opts.event.id,
      venue_id: opts.venue.id,
      requested_by: await this.idOf(opts.requestedBy),
      status: opts.status ?? "approved",
      event_start_datetime: sgt(opts.day, opts.start),
      event_end_datetime: sgt(opts.day, opts.end),
    });
  }

  /** The booking rows of an event, for checking what the screen cannot show (that nothing was created). */
  bookingsOf(event: EventRow): Promise<BookingRow[]> {
    return rest<BookingRow[]>(`venue_bookings?select=id,status&event_id=eq.${event.id}`);
  }

  /** Deletes tracked rows, newest first. A failed delete is reported, not thrown: it must not hide the test's own result. */
  async cleanup(): Promise<void> {
    for (const { table, query } of this.created.reverse()) {
      try {
        await rest(`${table}?${query}`, { method: "DELETE" });
      } catch (error) {
        console.warn(`[${this.prefix}] cleanup of ${table} ${query} failed:`, (error as Error).message);
      }
    }
    this.created = [];
  }
}

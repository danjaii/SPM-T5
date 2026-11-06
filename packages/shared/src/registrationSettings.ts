// SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): the coordinator adjusts an event's registration capacity and
// window, for instance while the event is back in Planning after a venue block. The rules are the event request form's
// (parseEventRequest, SCRUM-49), shared by event-service and apps/web so both check the same way. The one rule only the database
// can check, that the capacity may not drop below the Confirmed registrations, lives in update_registration_settings() (migration 84).

/** The largest capacity the form accepts. */
export const REGISTRATION_CAPACITY_MAX = 100_000;

export type RegistrationSettingsField = "registration_capacity" | "registration_opens_at" | "registration_closes_at";

/** What the settings are once validated: the capacity as a whole number and both times as UTC instants (ISO strings). */
export interface RegistrationSettings {
  registration_capacity: number;
  registration_opens_at: string;
  registration_closes_at: string;
}

export type ParsedRegistrationSettings =
  | { ok: true; data: RegistrationSettings }
  | { ok: false; fieldErrors: Partial<Record<RegistrationSettingsField | "body", string>> };

/** An instant from an ISO string with a zone, or null when it is not a real date and time. */
function instant(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  // Date.parse rolls 2031-02-31 over to March, so check that the date part survives a round trip
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const datePart = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (datePart) {
    const probe = new Date(Date.UTC(Number(datePart[1]), Number(datePart[2]) - 1, Number(datePart[3])));
    if (probe.getUTCMonth() !== Number(datePart[2]) - 1 || probe.getUTCDate() !== Number(datePart[3])) return null;
  }
  return ms;
}

/**
 * Checks the settings the coordinator sends. `eventStart` is the event's preferred start, which registration must close by; null
 * when it is not known. Returns every bad field at once, one message each. Fields that are not settings are dropped.
 */
export function parseRegistrationSettings(body: unknown, eventStart: string | Date | null): ParsedRegistrationSettings {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, fieldErrors: { body: "Send the settings as an object." } };
  }
  const input = body as Record<string, unknown>;
  const errors: Partial<Record<RegistrationSettingsField, string>> = {};

  // the capacity: a whole number from 1; digits typed into a form arrive as a string
  const rawCapacity = input.registration_capacity;
  let capacity: number | null = null;
  if (rawCapacity === undefined || rawCapacity === null || (typeof rawCapacity === "string" && rawCapacity.trim() === "")) {
    errors.registration_capacity = "Enter the registration capacity.";
  } else {
    const n = typeof rawCapacity === "string" ? Number(rawCapacity.trim()) : rawCapacity;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) errors.registration_capacity = "Enter a whole number of 1 or more.";
    else if (n > REGISTRATION_CAPACITY_MAX) errors.registration_capacity = `The capacity can't be more than ${REGISTRATION_CAPACITY_MAX}.`;
    else capacity = n;
  }

  let opens: number | null = null;
  if (input.registration_opens_at === undefined || input.registration_opens_at === null || input.registration_opens_at === "") {
    errors.registration_opens_at = "Enter the registration opening date and time.";
  } else {
    opens = instant(input.registration_opens_at);
    if (opens === null) errors.registration_opens_at = "Enter a valid opening date and time.";
  }

  let closes: number | null = null;
  if (input.registration_closes_at === undefined || input.registration_closes_at === null || input.registration_closes_at === "") {
    errors.registration_closes_at = "Enter the registration closing date and time.";
  } else {
    closes = instant(input.registration_closes_at);
    if (closes === null) errors.registration_closes_at = "Enter a valid closing date and time.";
  }

  // compare only the times that are valid by themselves, so one mistake is not reported twice
  if (opens !== null && closes !== null) {
    const start = eventStart === null ? null : new Date(eventStart).getTime();
    if (closes <= opens) errors.registration_closes_at = "Registration must close after it opens.";
    else if (start !== null && !Number.isNaN(start) && closes > start) errors.registration_closes_at = "Registration must close by the event start.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  // no error was recorded, so each value above was set
  return {
    ok: true,
    data: {
      registration_capacity: capacity as number,
      registration_opens_at: new Date(opens as number).toISOString(),
      registration_closes_at: new Date(closes as number).toISOString(),
    },
  };
}

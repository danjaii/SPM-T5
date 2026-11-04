import type { Role } from "./roles";

// SCRUM-182 (docs/specs/equipment-catalogue-maintenance.md): Technical Support Staff add and edit equipment, and change an item's
// operational status. The checks live here so the page and equipment-service use the very same code and can never disagree.

export const EQUIPMENT_NAME_MAX_LENGTH = 120;
export const EQUIPMENT_TYPE_MAX_LENGTH = 60;
export const EQUIPMENT_DESCRIPTION_MAX_LENGTH = 500;
export const EQUIPMENT_LOCATION_MAX_LENGTH = 120;
/** A typo guard (ours; the seeded catalogue holds 2 to 25 of each item). */
export const EQUIPMENT_QUANTITY_MAX = 100000;

/** The database's `equipment_operational_status`, in the order the form offers them. */
export const EQUIPMENT_OPERATIONAL_STATUSES = ["available", "damaged", "under_maintenance", "retired"] as const;
export type EquipmentOperationalStatus = (typeof EQUIPMENT_OPERATIONAL_STATUSES)[number];

/** What the status choice says, in words (the page also shows an icon, so a status is never colour alone). */
export const EQUIPMENT_OPERATIONAL_STATUS_LABELS: Record<EquipmentOperationalStatus, string> = {
  available: "Available",
  damaged: "Damaged",
  under_maintenance: "Under maintenance",
  retired: "Retired",
};

/** 182-S5: only Technical Support Staff maintain the equipment catalogue; everyone else browses it read-only. */
export function canManageEquipmentCatalogue(role: Role): boolean {
  return role === "technical_support_staff";
}

export function isEquipmentOperationalStatus(value: unknown): value is EquipmentOperationalStatus {
  return typeof value === "string" && (EQUIPMENT_OPERATIONAL_STATUSES as readonly string[]).includes(value);
}

export interface EquipmentInput {
  name: string;
  type: string | null;
  description: string | null;
  totalQuantity: number;
  location: string | null;
  /** An edit sends it (it is required); a new item always starts available. */
  operationalStatus: EquipmentOperationalStatus;
}

export type EquipmentInputField = "name" | "type" | "description" | "totalQuantity" | "location" | "operationalStatus";

export type ParsedEquipmentInput =
  | { ok: true; data: EquipmentInput }
  | { ok: false; fieldErrors: Partial<Record<EquipmentInputField, string>> };

/** Trimmed, runs of white space made one space. */
export function cleanEquipmentText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** A whole number from 1 to the limit, given as a number or a numeric string; null for anything else. */
function wholeQuantity(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= EQUIPMENT_QUANTITY_MAX ? n : null;
}

/**
 * 182-S1, S2, S4: checks a request body. Every refused field gets its own message. An optional text field left out or blank is
 * null. `mode` is "add" (the default): a new item always starts available, whatever status the body names. In "edit" mode the
 * status is required, so an edit that leaves it out is refused and can never put a damaged item back in service by accident.
 */
export function parseEquipmentInput(body: unknown, mode: "add" | "edit" = "add"): ParsedEquipmentInput {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Partial<Record<EquipmentInputField, string>> = {};

  const text = (key: string): string | undefined => (typeof b[key] === "string" ? cleanEquipmentText(b[key] as string) : undefined);

  const name = text("name") ?? "";
  if (name === "") fieldErrors.name = "Enter the equipment's name.";
  else if (name.length > EQUIPMENT_NAME_MAX_LENGTH) fieldErrors.name = `The name can be at most ${EQUIPMENT_NAME_MAX_LENGTH} characters.`;

  const optional = (key: "type" | "description" | "location", max: number, label: string): string | null => {
    const value = text(key) ?? "";
    if (value.length > max) fieldErrors[key] = `The ${label} can be at most ${max} characters.`;
    return value === "" ? null : value;
  };
  const type = optional("type", EQUIPMENT_TYPE_MAX_LENGTH, "type");
  const description = optional("description", EQUIPMENT_DESCRIPTION_MAX_LENGTH, "description");
  const location = optional("location", EQUIPMENT_LOCATION_MAX_LENGTH, "location");

  const quantity = wholeQuantity(b.totalQuantity);
  if (quantity === null) fieldErrors.totalQuantity = `Quantity must be a whole number from 1 to ${EQUIPMENT_QUANTITY_MAX}.`;

  const status = mode === "add" ? "available" : b.operationalStatus;
  if (!isEquipmentOperationalStatus(status)) fieldErrors.operationalStatus = "Choose one of the listed statuses.";

  if (Object.keys(fieldErrors).length > 0 || quantity === null || !isEquipmentOperationalStatus(status)) return { ok: false, fieldErrors };
  return { ok: true, data: { name, type, description, totalQuantity: quantity, location, operationalStatus: status } };
}

/** One catalogue item as the Equipment catalogue page lists it. */
export interface EquipmentCatalogueItem {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  totalQuantity: number;
  location: string | null;
  operationalStatus: EquipmentOperationalStatus;
}

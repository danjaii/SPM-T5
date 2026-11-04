import type { SupabaseClient } from "@supabase/supabase-js";
import type { EquipmentCatalogueItem, EquipmentInput, EquipmentOperationalStatus } from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";

/** SCRUM-182: reads, adds and edits catalogue items (and an item's operational status). */
export interface EquipmentCatalogueStore {
  list(): Promise<EquipmentCatalogueItem[]>;
  create(input: EquipmentInput): Promise<{ id: string }>;
  update(id: string, input: EquipmentInput): Promise<{ id: string }>;
}

const INSUFFICIENT_PRIVILEGE = "42501";
const NO_SUCH_ITEM = "P0002";
const INVALID_FIELD = "22023";

interface Row {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  total_quantity: number;
  location: string | null;
  operational_status: EquipmentOperationalStatus;
}

/**
 * Calls the create_equipment and update_equipment database functions (migration 78) as the caller, and reads the list as the
 * caller. The functions allow technical support staff only, so RLS stays the authority; the route's role check is just the
 * friendly 403.
 */
export class SupabaseEquipmentCatalogueStore implements EquipmentCatalogueStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(): Promise<EquipmentCatalogueItem[]> {
    const { data, error } = await this.db
      .from("equipment")
      .select("id, name, type, description, total_quantity, location, operational_status")
      .order("name", { ascending: true });
    if (error) throw new Error(`Reading the equipment catalogue failed: ${error.message}`, { cause: error });
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      description: r.description,
      totalQuantity: r.total_quantity,
      location: r.location,
      operationalStatus: r.operational_status,
    }));
  }

  async create(input: EquipmentInput): Promise<{ id: string }> {
    const { data, error } = await this.db.rpc("create_equipment", {
      p_name: input.name,
      p_type: input.type,
      p_description: input.description,
      p_total_quantity: input.totalQuantity,
      p_location: input.location,
    });
    if (error) throw refusal(error, "add");
    return data as { id: string };
  }

  async update(id: string, input: EquipmentInput): Promise<{ id: string }> {
    const { data, error } = await this.db.rpc("update_equipment", {
      p_id: id,
      p_name: input.name,
      p_type: input.type,
      p_description: input.description,
      p_total_quantity: input.totalQuantity,
      p_location: input.location,
      p_status: input.operationalStatus,
    });
    if (error) throw refusal(error, "edit");
    return data as { id: string };
  }
}

/** What a refused call becomes: the friendly answer for the refusals the functions raise on purpose, anything else as it is. */
function refusal(error: { code?: string; message: string; hint?: string }, verb: "add" | "edit"): Error {
  if (error.code === INSUFFICIENT_PRIVILEGE) return forbidden();
  if (error.code === NO_SUCH_ITEM) return notFound("Equipment not found.");
  if (error.code === INVALID_FIELD && error.hint) return validationFailed({ [error.hint]: error.message });
  return new Error(`Could not ${verb} the equipment: ${error.message}`, { cause: error });
}

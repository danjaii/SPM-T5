import type { SupabaseClient } from "@supabase/supabase-js";

/** One catalogue item: what the availability check needs to know about it. */
export interface EquipmentInfo {
  id: string;
  name: string;
  /** The kind of item (AV, Audio, Lighting...), or null if the catalogue does not say. */
  type: string | null;
  totalQuantity: number;
  operationalStatus: "available" | "damaged" | "under_maintenance" | "retired";
}

export interface EquipmentReader {
  /** The whole catalogue (it is small). */
  list(): Promise<EquipmentInfo[]>;
}

type Row = Record<string, unknown>;

const toEquipment = (r: Row): EquipmentInfo => ({
  id: r.id as string,
  name: r.name as string,
  type: (r.type as string | null) ?? null,
  totalQuantity: r.total_quantity as number,
  operationalStatus: r.operational_status as EquipmentInfo["operationalStatus"],
});

export class SupabaseEquipmentReader implements EquipmentReader {
  constructor(private readonly db: SupabaseClient) {}

  async list(): Promise<EquipmentInfo[]> {
    const { data, error } = await this.db
      .from("equipment")
      .select("id, name, type, total_quantity, operational_status")
      .order("name", { ascending: true });
    if (error) throw new Error(`Reading equipment failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toEquipment);
  }
}

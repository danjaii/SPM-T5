import type { SupabaseClient } from "@supabase/supabase-js";

/** One catalogue item: what the availability check needs to know about it. */
export interface EquipmentInfo {
  id: string;
  name: string;
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
  totalQuantity: r.total_quantity as number,
  operationalStatus: r.operational_status as EquipmentInfo["operationalStatus"],
});

export class SupabaseEquipmentReader implements EquipmentReader {
  constructor(private readonly db: SupabaseClient) {}

  async list(): Promise<EquipmentInfo[]> {
    const { data, error } = await this.db
      .from("equipment")
      .select("id, name, total_quantity, operational_status")
      .order("name", { ascending: true });
    if (error) throw new Error(`Reading equipment failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toEquipment);
  }
}

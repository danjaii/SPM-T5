import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import type { InventoryPeriodQuery } from "@/lib/equipmentInventory";

// SCRUM-137/AC2: the period the inventory is shown for. A plain GET form, so the period lands in the address (it can be
// bookmarked or shared) and the page reloads with it; no script is needed to use it.
export function InventoryPeriodForm({ period, fieldErrors = {} }: { period: InventoryPeriodQuery; fieldErrors?: Record<string, string> }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-4" aria-label="Period">
      <InputField id="date" name="date" label="Date" type="date" defaultValue={period.date} error={fieldErrors.date} />
      <InputField id="startTime" name="startTime" label="Start time" type="time" defaultValue={period.startTime} error={fieldErrors.startTime} />
      <InputField id="endTime" name="endTime" label="End time" type="time" defaultValue={period.endTime} error={fieldErrors.endTime} />
      <Button type="submit">Show inventory</Button>
    </form>
  );
}

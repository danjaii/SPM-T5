import { PackageOpen } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InventoryItemView } from "@/lib/equipmentInventory";
import { holdersText } from "@/lib/equipmentRequests";
import { OUT_OF_SERVICE_DISPLAY, RESERVED_DISPLAY } from "@/lib/status";

// SCRUM-137/AC2: every catalogue item for the chosen period. Only free, working units count as available ("6 of 10"),
// and each reason the rest are not is a StatusBadge: out of service (Damaged, Under maintenance, Retired) or Reserved,
// with the events holding them. Below the md breakpoint each row stacks into a card, so nothing scrolls sideways.
export function InventoryTable({ items }: { items: InventoryItemView[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
        <PackageOpen aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-semibold text-foreground">The equipment catalogue is empty.</p>
        <p className="text-sm text-muted-foreground">Items added to the catalogue will show up here.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader className="max-md:sr-only">
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Free at that time</TableHead>
          <TableHead>Why the rest are not free</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id} className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-3">
            <TableCell className="whitespace-normal max-md:p-0">
              <span className="font-semibold text-foreground">{item.name}</span>
              {item.type && <span className="block text-sm text-muted-foreground">{item.type}</span>}
            </TableCell>
            <TableCell className="text-base font-semibold max-md:p-0">{`${item.available} of ${item.total}`}</TableCell>
            <TableCell className="whitespace-normal max-md:p-0">
              <div className="flex flex-col items-start gap-1.5">
                {item.outOfService && <StatusBadge {...OUT_OF_SERVICE_DISPLAY[item.outOfService]} />}
                {item.heldBy.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge {...RESERVED_DISPLAY} />
                    <span className="text-sm text-muted-foreground">{holdersText(item.heldBy)}</span>
                  </div>
                )}
                {!item.outOfService && item.heldBy.length === 0 && <span className="text-sm text-muted-foreground">All free</span>}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

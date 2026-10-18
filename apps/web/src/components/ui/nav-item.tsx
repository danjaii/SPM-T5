import * as React from "react";

import { cn } from "@/lib/utils";

interface Props extends React.ComponentProps<"a"> {
  label: string;
  /** Icon slot: pass a lucide icon element. */
  icon?: React.ReactNode;
  /** Count slot: a queue count, shown in a pill. Omit to hide it. */
  count?: number | string;
  selected?: boolean;
}

// SCRUM-120: Figma App/Nav Item. The selected item has a pale aqua fill and bold primary text; the count is a pill that
// turns solid primary when selected. Hover is the neutral accent token. SCRUM-121 puts these in the shared sidebar.
export function NavItem({ label, icon, count, selected = false, className, ...props }: Props) {
  return (
    <a
      data-slot="nav-item"
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-lg py-2 pr-2.5 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected ? "bg-highlight font-bold text-fg-primary" : "font-medium text-foreground hover:bg-accent",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 items-center [&_svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span
          className={cn(
            "rounded-full px-2 py-px text-xs font-bold",
            selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </a>
  );
}

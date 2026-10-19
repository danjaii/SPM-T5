"use client";

import { createContext, useContext } from "react";
import type { Role } from "@spm-t5/shared";
import type { QueueCounts } from "@/lib/nav";

export interface ShellState {
  user: { fullName: string; role: Role };
  counts: QueueCounts;
}

// null outside the shell (signed-out pages, and tests that render a page on its own).
export const ShellContext = createContext<ShellState | null>(null);
export const useShell = () => useContext(ShellContext);

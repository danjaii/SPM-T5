import type { ReactNode } from "react";
import { getShellData } from "@/lib/shellServer";
import { ShellFrame } from "./shell/ShellFrame";

/** SCRUM-121: wraps every page in the role's sidebar when someone is signed in; signed-out pages render as they were. */
export async function AppShell({ children }: { children: ReactNode }) {
  return <ShellFrame shell={await getShellData()}>{children}</ShellFrame>;
}

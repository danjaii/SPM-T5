import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const KINDS = {
  error: { icon: AlertCircle, role: "alert", tone: "bg-status-danger text-status-danger-fg" },
  warning: { icon: AlertTriangle, role: "status", tone: "bg-status-warning text-status-warning-fg" },
  ok: { icon: CheckCircle2, role: "status", tone: "bg-status-success text-status-success-fg" },
} as const;

// SCRUM-127: a result or error line with an icon as well as colour, so it is never colour alone. Errors are announced at once.
export function InlineMessage({ kind, children, className }: { kind: keyof typeof KINDS; children: ReactNode; className?: string }) {
  const { icon: Icon, role, tone } = KINDS[kind];
  return (
    <div role={role} className={cn("flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium", tone, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

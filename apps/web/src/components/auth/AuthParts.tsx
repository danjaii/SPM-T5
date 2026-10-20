import { AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** SCRUM-122: the pieces every auth page (sign in, register, password reset) shares, so they look the same. */

export function AuthHeader({ title, lede }: { title: string; lede: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{lede}</p>
    </div>
  );
}

/** A message in the card: an error or a success, always an icon plus text (never colour alone). */
export function AuthAlert({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm font-medium",
        tone === "error" ? "border-destructive bg-status-danger text-status-danger-fg" : "border-status-success-fg bg-status-success text-status-success-fg",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function AuthLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn("font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...props}
    />
  );
}

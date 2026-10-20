import * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

interface Props {
  id: string;
  label: string;
  helper?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** Receives the props that tie the control to its message, so any control (select, textarea, chips) can use the field. */
  children: (control: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode;
}

// SCRUM-123/AC2: label, helper text and an inline error for controls InputField does not cover. The error is an icon plus
// text, tied to the control with aria-describedby, and a required field is marked in text as well as by an asterisk.
export function FormField({ id, label, helper, error, required, className, children }: Props) {
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || helper);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
        {required ? <span aria-hidden="true" className="text-destructive"> *</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": hasMessage ? messageId : undefined })}
      {error ? (
        <p id={messageId} className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
          {error}
        </p>
      ) : helper ? (
        <p id={messageId} className="text-sm text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

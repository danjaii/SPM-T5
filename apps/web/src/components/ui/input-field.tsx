import * as React from "react";
import { AlertCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props extends Omit<React.ComponentProps<"input">, "id"> {
  id: string;
  label: string;
  helper?: string;
  error?: string;
}

// SCRUM-120: Input with its label, helper and error states. The error is an icon plus text (not just a red border) and is
// tied to the input with aria-invalid and aria-describedby, so it reaches screen readers too.
export function InputField({ id, label, helper, error, className, ...props }: Props) {
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || helper);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={hasMessage ? messageId : undefined} {...props} />
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

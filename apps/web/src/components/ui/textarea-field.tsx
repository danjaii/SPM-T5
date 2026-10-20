import * as React from "react";
import { AlertCircle } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props extends Omit<React.ComponentProps<"textarea">, "id"> {
  id: string;
  label: string;
  helper?: string;
  error?: string;
}

// SCRUM-125: Textarea with its label, helper and error states, the multi-line twin of InputField. The error is an icon plus
// text and is tied to the textarea with aria-invalid and aria-describedby.
export function TextareaField({ id, label, helper, error, className, ...props }: Props) {
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || helper);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      <Textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={hasMessage ? messageId : undefined} {...props} />
      {error ? (
        <p id={messageId} role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
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

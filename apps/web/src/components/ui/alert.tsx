import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const alertVariants = cva(
  "relative flex w-full flex-col gap-1 rounded-lg border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        // SCRUM-135: tinted like the status badges, so an alert is never read as a button.
        warning: "border-status-warning-fg bg-status-warning text-status-warning-fg",
        danger: "border-status-danger-fg bg-status-danger text-status-danger-fg",
      },
    },
    defaultVariants: { variant: "warning" },
  }
)

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="alert-title" className={cn("font-bold", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("text-sm", className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }

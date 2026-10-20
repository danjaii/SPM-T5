import type { ReactNode } from "react";
import { ROLE_OPTIONS } from "@/lib/roles";

// Chip wording from the sign-in mock-up (shorter than the role names used elsewhere).
const CHIP_LABELS = ["Event Organiser", "Attendee", "Coordinator Lead", "Event Coordinator", "Venue Staff", "Technical Support", "Safety Officer"];

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">C</span>
      <span className="text-lg font-bold text-foreground">ConnectSphere</span>
    </div>
  );
}

/** SCRUM-122: the two-panel layout of the sign-in mock-up, shared by sign in, register and password reset.
 *  Below md the brand panel shrinks to the logo and one line, so the form comes first and the page never scrolls sideways. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="relative flex flex-col gap-4 overflow-hidden bg-highlight px-6 py-6 text-foreground md:w-1/2 md:max-w-2xl md:gap-7 md:px-16 md:py-14">
        <BrandMark />
        <div aria-hidden="true" className="absolute -top-16 left-2/3 hidden size-56 rounded-full bg-primary/40 md:block" />
        <div aria-hidden="true" className="absolute top-28 left-3/4 hidden size-32 rounded-full bg-card md:block" />
        <div className="hidden flex-1 md:block" />
        <h2 className="text-2xl font-bold md:text-5xl md:leading-tight">Plan events without the back-and-forth.</h2>
        <p className="hidden text-base leading-6 md:block">
          Requests, venues, equipment and approvals for every ConnectSphere event, in one place.
        </p>
        <div className="hidden flex-col gap-2.5 md:flex">
          <p className="text-sm font-semibold text-muted-foreground">One sign-in. You see only what your role needs.</p>
          <ul className="flex flex-wrap gap-2" aria-label="Roles">
            {CHIP_LABELS.map((label, i) => (
              <li key={ROLE_OPTIONS[i]?.value ?? label} className="rounded-full bg-card px-3 py-1.5 text-sm font-medium text-foreground">{label}</li>
            ))}
          </ul>
        </div>
        <div className="hidden flex-1 md:block" />
      </aside>
      <main className="flex flex-1 items-center justify-center px-4 py-8 md:px-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-md md:p-10">{children}</div>
      </main>
    </div>
  );
}

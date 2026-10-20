import { Bell, Building2, Check, Home, Inbox, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { NavItem } from "@/components/ui/nav-item";
import { StatusStepper } from "@/components/event/StatusStepper";
import { StatusBadge } from "@/components/ui/status-badge";
import { ALL_STATUS_DISPLAYS, type StatusTone } from "@/lib/status";
import type { MeasuredPair } from "@/lib/tokens";

const TONES: StatusTone[] = ["neutral", "info", "warning", "success", "danger"];

const TOKEN_GROUPS: { title: string; names: string[] }[] = [
  { title: "Surface and text", names: ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "muted", "muted-foreground", "accent", "accent-foreground"] },
  { title: "Actions", names: ["primary", "primary-hover", "primary-foreground", "secondary", "secondary-foreground", "destructive", "destructive-hover", "fg-primary", "highlight"] },
  { title: "Lines and focus", names: ["border", "border-strong", "input", "ring"] },
  { title: "Status tones", names: TONES.flatMap((t) => [`status-${t}`, `status-${t}-fg`]) },
];

// A swatch shows a token's own colour, so it reads the CSS variable through the style prop rather than a utility class.
function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden="true" className="size-10 shrink-0 rounded-lg border border-border-strong" style={{ background: `var(--${name})` }} />
      <span className="min-w-0 text-sm">
        <span className="block truncate font-semibold">--{name}</span>
        <span className="text-muted-foreground">{hex}</span>
      </span>
    </li>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-6">
      <h2 id={id} className="text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-3">{children}</div>;
const Caption = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;
const Subhead = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-bold tracking-wide text-muted-foreground uppercase">{children}</h3>
);

export function Styleguide({ tokens, pairs }: { tokens: Record<string, string>; pairs: MeasuredPair[] }) {
  const failing = pairs.filter((p) => !p.pass).length;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 bg-background px-4 py-8 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold">Styleguide</h1>
        <p className="text-muted-foreground">SCRUM-120: theme tokens and core components, from the ConnectSphere UI mock-ups.</p>
      </header>

      <Section id="tokens" title="Tokens">
        <div className="grid gap-6 sm:grid-cols-2">
          {TOKEN_GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-3">
              <Subhead>{g.title}</Subhead>
              <ul className="flex flex-col gap-3">
                {g.names.map((n) => (
                  <Swatch key={n} name={n} hex={tokens[n]} />
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Caption>Radius: --radius is 0.5rem (the 8px of the mock-ups); the smaller and larger radii scale from it.</Caption>
      </Section>

      <Section id="contrast" title="Contrast">
        <Caption>
          Text needs 4.5:1; input borders, focus rings and icons need 3:1. {failing === 0 ? "Every pair passes." : `${failing} pair(s) fail.`}
        </Caption>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-strong">
                <th className="py-2 pr-3 font-semibold">Pair</th>
                <th className="py-2 pr-3 font-semibold">Sample</th>
                <th className="py-2 pr-3 font-semibold">Ratio</th>
                <th className="py-2 font-semibold">Needs</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={p.label} className="border-b border-border">
                  <td className="py-2 pr-3">{p.label}</td>
                  <td className="py-2 pr-3">
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 font-semibold"
                      style={{ color: p.fgHex, background: p.bgHex, boxShadow: p.kind === "text" ? undefined : `inset 0 0 0 2px ${p.fgHex}` }}
                    >
                      {p.kind === "text" ? "Aa" : "Box"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      {p.pass ? <Check aria-hidden="true" className="size-4 text-status-success-fg" /> : <X aria-hidden="true" className="size-4 text-destructive" />}
                      {p.ratio.toFixed(2)}:1<span className="sr-only">{p.pass ? " passes" : " fails"}</span>
                    </span>
                  </td>
                  <td className="py-2 tabular-nums">{p.min}:1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="buttons" title="Button">
        <Caption>Variants at the default (40px) and small sizes. Hover on secondary and ghost is the neutral accent, never a brand colour.</Caption>
        {(["default", "sm"] as const).map((size) => (
          <Row key={size}>
            <Button size={size}>Primary</Button>
            <Button size={size} variant="secondary">Secondary</Button>
            <Button size={size} variant="ghost">Ghost</Button>
            <Button size={size} variant="destructive">Destructive</Button>
            <Button size={size} disabled>Disabled</Button>
          </Row>
        ))}
        <Subhead>States, held for display</Subhead>
        <Row>
          <Button className="bg-primary-hover">Primary hover</Button>
          <Button variant="secondary" className="bg-accent">Secondary hover</Button>
          <Button variant="ghost" className="bg-accent">Ghost hover</Button>
          <Button variant="destructive" className="bg-destructive-hover">Destructive hover</Button>
          <Button className="ring-2 ring-ring ring-offset-2 ring-offset-background">Focus</Button>
          <Button variant="destructive" className="ring-2 ring-destructive ring-offset-2 ring-offset-background">Destructive focus</Button>
        </Row>
      </Section>

      <Section id="inputs" title="Input">
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField id="sg-default" label="Event name" placeholder="Quarterly planning day" />
          <InputField id="sg-helper" label="Contact email" helper="We only use this to send updates about your event." defaultValue="organiser@example.com" />
          <InputField id="sg-focus" label="Focused" className="[&_input]:border-ring [&_input]:ring-2 [&_input]:ring-ring" defaultValue="Showing the focus ring" />
          <InputField id="sg-error" label="Expected attendance" error="Enter a whole number of 1 or more." defaultValue="-4" />
          <InputField id="sg-disabled" label="Disabled" disabled defaultValue="Cannot be edited" />
        </div>
      </Section>

      <Section id="status" title="StatusBadge">
        <Caption>Five tinted tones, each with an icon and a label. No status uses the primary button colour.</Caption>
        <Row>
          {TONES.map((t) => (
            <StatusBadge key={t} tone={t} label={t[0].toUpperCase() + t.slice(1)} />
          ))}
        </Row>
        {["Event", "Venue booking", "Equipment request"].map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <Subhead>{group}</Subhead>
            <Row>
              {ALL_STATUS_DISPLAYS.filter((s) => s.group === group).map((s) => (
                <StatusBadge key={s.key} {...s.display} />
              ))}
            </Row>
          </div>
        ))}
      </Section>

      <Section id="stepper" title="Status stepper">
        <Caption>SCRUM-127: the eight stages of an event. A returned, rejected or cancelled event shows a badge on the step where it happened.</Caption>
        {[
          ["Under review", "under_review", true, undefined],
          ["Returned", "returned", true, undefined],
          ["Cancelled during planning", "cancelled", true, "planning"],
          ["Completed", "completed", true, undefined],
        ].map(([label, status, coordinator, previous]) => (
          <div key={String(label)} className="flex min-w-0 flex-col gap-2">
            <Subhead>{String(label)}</Subhead>
            <StatusStepper status={String(status)} hasCoordinator={Boolean(coordinator)} previousStatus={previous as string | undefined} />
          </div>
        ))}
      </Section>

      <Section id="nav" title="Nav item">
        <Caption>Icon slot and count slot. Selected is the aqua fill with bold primary text; hover is the neutral accent.</Caption>
        <nav aria-label="Nav item examples" className="flex w-full max-w-60 flex-col gap-1">
          <NavItem href="#nav" label="Home" icon={<Home />} count={4} />
          <NavItem href="#nav" label="Venues" icon={<Building2 />} count={12} selected />
          <NavItem href="#nav" label="Inbox" icon={<Inbox />} />
          <NavItem href="#nav" label="Notifications" icon={<Bell />} count={0} />
          <NavItem href="#nav" label="Search (hover)" icon={<Search />} className="bg-accent" />
        </nav>
      </Section>
    </main>
  );
}

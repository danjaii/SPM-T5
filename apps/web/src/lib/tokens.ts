import { contrastRatio } from "@/lib/contrast";

// SCRUM-120/AC1: reads the colour tokens out of globals.css so the /styleguide page and the contrast test judge the same
// values the browser uses. Only plain #rrggbb tokens are read; the legacy palette (e.g. --steel) is not part of this set.

export function parseTokens(css: string): Record<string, string> {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root) throw new Error("globals.css has no :root block");
  const tokens: Record<string, string> = {};
  for (const m of root[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2].toLowerCase();
  return tokens;
}

export interface ContrastPair {
  label: string;
  fg: string;
  bg: string;
  /** 4.5 for text, 3 for input borders and icons (WCAG 1.4.3 and 1.4.11). */
  min: 4.5 | 3;
  kind: "text" | "border" | "icon";
}

const TONES = ["neutral", "info", "warning", "success", "danger"] as const;

const text = (label: string, fg: string, bg: string): ContrastPair => ({ label, fg, bg, min: 4.5, kind: "text" });

export const CONTRAST_PAIRS: ContrastPair[] = [
  text("Body text on page", "foreground", "background"),
  text("Body text on card", "foreground", "card"),
  text("Body text on popover", "popover-foreground", "popover"),
  text("Muted text on page", "muted-foreground", "background"),
  text("Muted text on card", "muted-foreground", "card"),
  text("Muted text on muted surface", "muted-foreground", "muted"),
  text("Text on neutral hover (accent)", "accent-foreground", "accent"),
  text("Text on secondary", "secondary-foreground", "secondary"),
  text("Primary button label", "primary-foreground", "primary"),
  text("Primary button label, hover", "primary-foreground", "primary-hover"),
  text("Destructive button label", "primary-foreground", "destructive"),
  text("Destructive button label, hover", "primary-foreground", "destructive-hover"),
  text("Ghost button label on page", "fg-primary", "background"),
  text("Ghost button label on hover", "fg-primary", "accent"),
  text("Selected nav item", "fg-primary", "highlight"),
  text("Nav item on hover", "foreground", "accent"),
  text("Error text on card", "destructive", "card"),
  text("Error text on page", "destructive", "background"),
  text("Sidebar text", "sidebar-foreground", "sidebar"),
  ...TONES.map((t) => text(`Status ${t} label`, `status-${t}-fg`, `status-${t}`)),
  { label: "Input border on card", fg: "input", bg: "card", min: 3, kind: "border" },
  { label: "Input border on page", fg: "input", bg: "background", min: 3, kind: "border" },
  { label: "Focus ring on page", fg: "ring", bg: "background", min: 3, kind: "border" },
  { label: "Focus ring on card", fg: "ring", bg: "card", min: 3, kind: "border" },
  { label: "Error icon on card", fg: "destructive", bg: "card", min: 3, kind: "icon" },
  ...TONES.map((t): ContrastPair => ({ label: `Status ${t} icon`, fg: `status-${t}-fg`, bg: `status-${t}`, min: 3, kind: "icon" })),
];

export interface MeasuredPair extends ContrastPair {
  fgHex: string;
  bgHex: string;
  ratio: number;
  pass: boolean;
}

export function measurePairs(tokens: Record<string, string>): MeasuredPair[] {
  return CONTRAST_PAIRS.map((p) => {
    const fgHex = tokens[p.fg];
    const bgHex = tokens[p.bg];
    if (!fgHex || !bgHex) throw new Error(`Token missing for "${p.label}": --${p.fg} or --${p.bg}`);
    const ratio = contrastRatio(fgHex, bgHex);
    return { ...p, fgHex, bgHex, ratio, pass: ratio >= p.min };
  });
}

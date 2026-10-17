import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { contrastRatio } from "@/lib/contrast";
import { measurePairs, parseTokens } from "@/lib/tokens";

const SRC = path.join(__dirname, "..", "..", "src");
const css = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
const tokens = parseTokens(css);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("SCRUM-120/AC1 contrast of the styleguide pairs", () => {
  it("computes the WCAG ratio (black on white is 21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  const pairs = measurePairs(tokens);

  it("checks text, border and icon pairs", () => {
    expect(pairs.some((p) => p.kind === "text")).toBe(true);
    expect(pairs.some((p) => p.kind === "border")).toBe(true);
    expect(pairs.some((p) => p.kind === "icon")).toBe(true);
  });

  for (const p of pairs) {
    it(`${p.label} is at least ${p.min}:1`, () => {
      expect(p.ratio, `${p.label}: ${p.fgHex} on ${p.bgHex}`).toBeGreaterThanOrEqual(p.min);
    });
  }
});

describe("SCRUM-120/AC3 hover uses the neutral accent token", () => {
  it("makes ghost, secondary and outline buttons hover to bg-accent", () => {
    for (const variant of ["ghost", "secondary", "outline"] as const) {
      expect(buttonVariants({ variant })).toContain("hover:bg-accent");
    }
  });

  it("keeps the accent neutral: it is the neutral status tint, not the primary or the selected-nav aqua", () => {
    expect(tokens.accent).toBe(tokens["status-neutral"]);
    expect(tokens.accent).not.toBe(tokens.primary);
    expect(tokens.accent).not.toBe(tokens.highlight);
  });

  it("makes ghost and outline badges hover to bg-accent", () => {
    expect(badgeVariants({ variant: "ghost" })).toContain("hover:bg-accent");
    expect(badgeVariants({ variant: "outline" })).toContain("hover:bg-accent");
  });
});

describe("SCRUM-120/AC4 no hard-coded colours outside the token file", () => {
  it("has no hex, rgb(), hsl() or oklch() colour in any .ts/.tsx source", () => {
    const hits = sourceFiles(SRC).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/g)].map((m) => `${path.relative(SRC, file)}: ${m[0]}`);
    });
    expect(hits).toEqual([]);
  });
});

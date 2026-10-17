import { readFileSync } from "node:fs";
import path from "node:path";

import { Styleguide } from "@/components/styleguide/Styleguide";
import { measurePairs, parseTokens } from "@/lib/tokens";

export const metadata = { title: "Styleguide · ConnectSphere" };

// SCRUM-120: every design token and core component state on one page. The contrast table is measured from globals.css.
export default function StyleguidePage() {
  const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const tokens = parseTokens(css);
  return <Styleguide tokens={tokens} pairs={measurePairs(tokens)} />;
}

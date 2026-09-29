// PreToolUse hook: remind Claude to be test-first when it edits production code.
// Never blocks — it only adds context. See CLAUDE.md → Development workflow.
import { readFileSync } from "node:fs";

const PRODUCTION_SRC = /(^|\/)(apps\/web|services\/[^/]+|packages\/shared)\/src\//;

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const filePath = String(input?.tool_input?.file_path ?? "").replaceAll("\\", "/");
if (!PRODUCTION_SRC.test(filePath)) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        "Editing production code. Confirm a failing test for this change was written and run red first " +
        "(CLAUDE.md → Development workflow). If there isn't one, stop and write the test before this edit.",
    },
  }),
);

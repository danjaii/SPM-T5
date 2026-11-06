// SCRUM-195/AC5: a vitest reporter that saves the beforeAll/afterAll errors vitest's JSON report leaves out, so
// generate.mjs can say why tests were skipped. It runs alongside the JSON reporter; the rule is collectHookErrors in lib.mjs.
import { writeFileSync } from "node:fs";
import { collectHookErrors } from "./lib.mjs";

export default class HookErrorsReporter {
  onTestRunEnd(testModules, unhandledErrors) {
    const out = process.env.TRACEABILITY_HOOK_ERRORS;
    if (out) writeFileSync(out, JSON.stringify(collectHookErrors(testModules, unhandledErrors)));
  }
}

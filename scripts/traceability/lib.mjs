// SCRUM-175: the traceability matrix's rules, kept free of file and process access so lib.test.mjs can check them.
// generate.mjs feeds them the test list (vitest list --json) and the specs (docs/specs/*.md).

/**
 * Which stories and ACs a test checks, read from its full name (describe > it). CLAUDE.md asks test names to cite
 * `SCRUM-<story>/AC<n>` or a spec scenario ID (`36-S4`, which `scenarios` maps to ACs). A story named without an AC counts
 * with ac null, unless the same name also gives it an AC; a scenario the specs do not map still counts, with ac null.
 */
export function refsOf(name, scenarios) {
  const found = [];
  const pattern = /SCRUM-(\d+)(?:\/(AC\d+(?:\s*,\s*AC\d+)*))?|(?<![\w-])(\d+)-S(\d+)(?!\d)/g;
  for (const m of name.matchAll(pattern)) {
    if (m[1]) {
      const story = Number(m[1]);
      if (m[2]) for (const ac of m[2].matchAll(/AC(\d+)/g)) found.push({ story, ac: Number(ac[1]) });
      else found.push({ story, ac: null, bare: true });
    } else {
      const story = Number(m[3]);
      const acs = scenarios[`${m[3]}-S${m[4]}`] ?? [];
      if (acs.length === 0) found.push({ story, ac: null });
      for (const ac of acs) found.push({ story, ac });
    }
  }
  const named = new Set(found.filter((r) => !r.bare).map((r) => r.story));
  const seen = new Set();
  return found
    .filter((r) => !(r.bare && named.has(r.story)))
    .filter((r) => !seen.has(`${r.story}:${r.ac}`) && seen.add(`${r.story}:${r.ac}`))
    .map(({ story, ac }) => ({ story, ac }));
}

/**
 * A spec's stories (title and every AC with its text) and its scenario table (scenario ID -> AC numbers). The specs write
 * ACs four ways: `*AC1.* …`, `**AC1** …` (optionally numbered), and `| AC1 | … |` table rows. A story's section starts at
 * `## SCRUM-<n> <title>`; a spec with no such heading takes its story from its key table (`| SCRUM-<n> | <title> |`) or its
 * file name. An AC the spec wraps onto following lines keeps them, up to a blank line. Only stories with at least one AC
 * are returned.
 */
export function parseSpec(text, fileName) {
  const all = {};
  const scenarios = {};
  const story = (n) => (all[n] ??= { title: null, acs: {}, file: fileName });
  let current = /SCRUM-(\d+)/.exec(fileName)?.[1] ?? null;
  let sawHeading = false;
  let wrapping = null; // the AC whose text may continue on the next line

  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+SCRUM-(\d+)\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sawHeading = true;
      wrapping = null;
      story(current).title = heading[2];
      continue;
    }
    const key = /^\|\s*SCRUM-(\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (key) {
      wrapping = null;
      story(key[1]).title ??= key[2];
      if (!sawHeading) current = key[1];
      continue;
    }
    const scenario = /^\|\s*(\d+-S\d+)\s*\|([^|]*)\|/.exec(line);
    if (scenario) {
      wrapping = null;
      scenarios[scenario[1]] = [...scenario[2].matchAll(/AC(\d+)/g)].map((m) => Number(m[1]));
      continue;
    }
    const prose = /^\*AC(\d+)\.\*\s*(.*)$/.exec(line) ?? /^(?:\d+\.\s+)?\*\*AC(\d+)\*\*\s*(.*)$/.exec(line);
    const row = /^\|\s*AC(\d+)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if ((prose || row) && current) {
      const [, n, words] = prose ?? row;
      story(current).acs[Number(n)] = words.trim();
      wrapping = prose ? { story: current, n: Number(n) } : null; // a table row ends at its line
      continue;
    }
    // a wrapped AC goes on until a blank line, a table row or a heading
    if (wrapping && line.trim() !== "" && !/^\s*[|#]/.test(line)) {
      const acs = all[wrapping.story].acs;
      acs[wrapping.n] = `${acs[wrapping.n]} ${line.trim()}`.trim();
    } else wrapping = null;
  }

  const stories = {};
  for (const [n, s] of Object.entries(all)) if (Object.keys(s.acs).length > 0) stories[n] = s;
  return { stories, scenarios };
}

/** A string literal from the source as a pattern for the names it can produce: it.each fills in %s, %j…; templates fill ${…}. */
function literalPattern(literal) {
  const text = literal.replace(/\\(.)/g, "$1");
  const parts = text.split(/(%[sdifjoO#%]|\$\{[^}]*\})/);
  const body = parts.map((p, i) => (i % 2 === 1 ? "[\\s\\S]*?" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp(`^${body}$`);
}

/** The 1-based line of the test whose full name (describe > … > test) is `fullName`, or null when it cannot be found. */
export function lineOf(source, fullName) {
  const title = fullName.split(" > ").at(-1);
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      if (literalPattern(m[2]).test(title)) return i + 1;
    }
  }
  return null;
}

/** Adds a test to a list, counting it.each cases (same file and line) as one entry. */
function addTest(list, test) {
  const same = list.find((t) => t.file === test.file && (test.line === null ? t.name === test.name : t.line === test.line));
  if (same) same.cases += 1;
  else list.push({ file: test.file, line: test.line, name: test.name, cases: 1 });
}

/**
 * The matrix: every story a test or a spec names, in number order, each with its ACs (the spec's, plus any a test names),
 * the tests for each AC, and the tests that name the story without an AC. `tests` are { name, file (relative to the repo),
 * line }; `specs` is parseSpec()'s output merged over all specs.
 */
export function buildMatrix(tests, specs) {
  const byStory = new Map();
  const entry = (n) => {
    if (!byStory.has(n)) {
      const spec = specs.stories[n];
      byStory.set(n, { story: n, title: spec?.title ?? null, fromSpec: Boolean(spec), specFile: spec?.file ?? null, acTests: new Map(), storyLevel: [] });
    }
    return byStory.get(n);
  };
  for (const n of Object.keys(specs.stories)) entry(Number(n));

  let untraced = 0;
  for (const test of tests) {
    const refs = refsOf(test.name, specs.scenarios);
    if (refs.length === 0) untraced += 1;
    // a story with no spec takes its title from its tests' group name, e.g. "SCRUM-6 — View event status as event coordinator"
    for (const part of test.name.split(" > ")) {
      const named = /^SCRUM-(\d+)(?!\/)\s*[—–:-]?\s+(.+)$/.exec(part);
      if (named && !/^AC\d/.test(named[2])) entry(Number(named[1])).title ??= named[2].trim();
    }
    for (const { story, ac } of refs) {
      const s = entry(story);
      if (ac === null) addTest(s.storyLevel, test);
      else {
        if (!s.acTests.has(ac)) s.acTests.set(ac, []);
        addTest(s.acTests.get(ac), test);
      }
    }
  }

  const stories = [...byStory.values()]
    .sort((a, b) => a.story - b.story)
    .map(({ acTests, ...s }) => {
      const specAcs = s.fromSpec ? Object.keys(specs.stories[s.story].acs).map(Number) : [];
      const numbers = [...new Set([...specAcs, ...acTests.keys()])].sort((a, b) => a - b);
      const acs = numbers.map((ac) => {
        const list = acTests.get(ac) ?? [];
        const text = specs.stories[s.story]?.acs[ac] ?? null;
        // an AC the spec itself drops (e.g. SCRUM-102 AC3) is not a gap in the tests
        const dropped = /^[*(\s]*Dropped\b/i.test(text ?? "");
        return { ac, text, tests: list, covered: list.length > 0, dropped };
      });
      return { ...s, acs };
    });
  return { stories, total: tests.length, untraced };
}

const cell = (text) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const link = (t) => {
  const label = `${t.file.split("/").at(-1)}${t.line ? `:${t.line}` : ""}`;
  return `[${label}](../${t.file}${t.line ? `#L${t.line}` : ""})${t.cases > 1 ? ` ×${t.cases}` : ""}`;
};

const caseCount = (list) => list.reduce((n, t) => n + t.cases, 0);

/** The matrix as docs/traceability.md. `meta`: the date, the commit and how many tests passed on it. */
export function renderMarkdown(matrix, meta) {
  const out = [
    "# Traceability matrix: user stories to tests",
    "",
    `Generated ${meta.date} from commit \`${meta.commit}\`: all ${meta.passed} tests passed on that commit (\`pnpm vitest run\`, database tests against local Supabase).`,
    "",
    "- **Regenerate** after a green full test run: `pnpm run traceability`. Do not edit this file by hand.",
    '- **Run one story\'s tests**: `pnpm vitest run -t "SCRUM-68|68-S[0-9]"` (put the story number in both places).',
    "- **How a test is matched**: its name cites `SCRUM-<story>/AC<n>`, or a spec scenario ID (`174-S3`) that the spec's scenario table maps to ACs (CLAUDE.md, \"Keep tests traceable\"). ×N is an `it.each` test with N cases.",
    "- **Not covered** can only be shown for stories with a spec in `docs/specs/`, which lists every AC. For the other stories the full AC list is in Jira, so only the ACs that have tests appear, marked \"no spec\".",
    `- ${matrix.untraced} of ${matrix.total} tests name no story (health checks and shared plumbing).`,
    "",
    "## Summary",
    "",
    "| Story | Title | ACs with tests | Tests |",
    "| --- | --- | --- | --- |",
  ];
  for (const s of matrix.stories) {
    const covered = s.acs.filter((a) => a.covered).length;
    const acs = s.fromSpec ? `${covered} of ${s.acs.filter((a) => !a.dropped).length}` : `${covered} (no spec)`;
    const tests = s.acs.reduce((n, a) => n + caseCount(a.tests), 0) + caseCount(s.storyLevel);
    out.push(`| [SCRUM-${s.story}](#scrum-${s.story}) | ${cell(s.title ?? "")} | ${acs} | ${tests} |`);
  }

  for (const s of matrix.stories) {
    out.push("", `## SCRUM-${s.story}`, "");
    if (s.title) out.push(`**${cell(s.title)}**${s.specFile ? ` · spec: [${s.specFile}](specs/${s.specFile})` : ""}`, "");
    if (s.acs.length > 0) {
      out.push("| AC | What it checks | Tests |", "| --- | --- | --- |");
      for (const a of s.acs) {
        const tests = a.covered ? a.tests.map(link).join("<br>") : a.dropped ? "Dropped (see the spec)" : "**Not covered**";
        out.push(`| AC${a.ac} | ${cell(a.text ?? "")} | ${tests} |`);
      }
    }
    if (s.storyLevel.length > 0) out.push("", `Tests that name the story but no AC: ${s.storyLevel.map(link).join(", ")}`);
  }
  return `${out.join("\n")}\n`;
}

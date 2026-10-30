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
 * file name. Only stories with at least one AC are returned.
 */
export function parseSpec(text, fileName) {
  const all = {};
  const scenarios = {};
  const story = (n) => (all[n] ??= { title: null, acs: {}, file: fileName });
  let current = /SCRUM-(\d+)/.exec(fileName)?.[1] ?? null;
  let sawHeading = false;

  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+SCRUM-(\d+)\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      sawHeading = true;
      story(current).title = heading[2];
      continue;
    }
    const key = /^\|\s*SCRUM-(\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (key) {
      story(key[1]).title ??= key[2];
      if (!sawHeading) current = key[1];
      continue;
    }
    const scenario = /^\|\s*(\d+-S\d+)\s*\|([^|]*)\|/.exec(line);
    if (scenario) {
      scenarios[scenario[1]] = [...scenario[2].matchAll(/AC(\d+)/g)].map((m) => Number(m[1]));
      continue;
    }
    const ac =
      /^\*AC(\d+)\.\*\s*(.*)$/.exec(line) ??
      /^(?:\d+\.\s+)?\*\*AC(\d+)\*\*\s*(.*)$/.exec(line) ??
      /^\|\s*AC(\d+)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (ac && current) story(current).acs[Number(ac[1])] = ac[2].trim();
  }

  const stories = {};
  for (const [n, s] of Object.entries(all)) if (Object.keys(s.acs).length > 0) stories[n] = s;
  return { stories, scenarios };
}

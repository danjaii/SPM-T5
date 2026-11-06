import { areaOf, getCase, storyOf } from "../catalogue";

/**
 * The title and annotations of one catalogue case, e.g.
 *
 *   const t = tc("E2E-CONF-02");
 *   test(t.title, { annotation: t.annotation }, async ({ as, data }) => { ... });
 *
 * The title is "E2E-CONF-02 <phrase> @SCRUM-103 @C1 @P0": Playwright reads the @words as tags, so
 * `playwright test --grep @P0` runs one priority. The annotations carry the story and AC references the generated
 * traceability matrix reads from results.json.
 */
export function tc(id: string) {
  const def = getCase(id);
  const stories = [...new Set(def.refs.map(storyOf))];
  const tags = [...stories, ...def.changes, def.priority].map((t) => `@${t}`);
  return {
    def,
    area: areaOf(id),
    title: `${id} ${def.title} ${tags.join(" ")}`,
    annotation: [
      ...stories.map((s) => ({ type: "story", description: s })),
      ...def.refs.map((r) => ({ type: "ac", description: r })),
      { type: "priority", description: def.priority },
      { type: "kind", description: def.type },
    ],
  };
}

<!-- Title: SCRUM-<story>/AC<n> - <Imperative summary>  (or <type> - <summary> for chore/ci/docs/refactor/test)
     PRs are squash-merged: this title becomes the commit on main. -->

## Summary
<!-- 1–3 sentences: what this PR does and why -->

## Ticket
SCRUM-<story> — ACs covered: AC<x>, AC<y>
<!-- Non-story work: write N/A and the type (chore/ci/docs/refactor/test) -->

## Changes
- <!-- one bullet per notable change; name affected workspaces (apps/web, services/<name>, packages/shared) -->

## How to test
1. <!-- steps a reviewer can follow, e.g. `pnpm --filter @spm-t5/event-service run test:unit`, or UI steps -->

## Screenshots
<!-- UI changes in apps/web; otherwise N/A -->

## Checklist
- [ ] `pnpm vitest run` passes; tests added/updated and reference the story/AC
- [ ] Typecheck and lint pass for touched workspaces
- [ ] No console errors / leftover debug code
- [ ] Acceptance criteria above verified
- [ ] New migration is a new numbered file (none edited) — or N/A
- [ ] Architecture change reflected in `docs/architecture/c4/*.puml` or an ADR — or N/A

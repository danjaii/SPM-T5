<!-- Title: SCRUM-<story>/AC<n> - <Imperative summary>  (or <type> - <summary> for chore/ci/docs/refactor/test)
     PRs are squash-merged: this title becomes the commit on main. -->

## Why
<!-- The reason this PR exists, in 2-4 sentences: whose problem it solves, what goes wrong without it, and what changes for them.
     Do not describe the code here, the "What changed" section is for that. A description that only says what was added is incomplete. -->

## Ticket
SCRUM-<story> — ACs covered: AC<x>, AC<y>
<!-- Non-story work: write N/A and the type (chore/ci/docs/refactor/test) -->

## Why it is built this way
<!-- The choices a reviewer might question, each with its reason and its cost, and any alternative you rejected and why.
     If there were no real choices, write "Straightforward: no design choices". -->

## What changed
- <!-- keep it short, the diff shows the detail: one bullet per notable change; name affected workspaces (apps/web, services/<name>, packages/shared) -->

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

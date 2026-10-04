# Handover: venue-booking PR stack after #20 was squash-merged

Written 2026-10-04 for the teammate (and their coding agent) taking over the remaining merge steps.
It records what was done, why, and exactly what is left. Nothing here is a spec; the specs are in
`docs/specs/`.

## 1. TL;DR

- #20 (SCRUM-32) was squash-merged to `main` as `4c9e3da`. The branches stacked on it still carried
  its original commits, so they were rebased onto `main` so each PR contains only its own commits.
- That rebase is **done and pushed**. There were no merge conflicts.
- The remaining work is merge-order bookkeeping (section 6), one migration renumber for SCRUM-49,
  and one unrelated dashboard bug.
- Do not push to the branches in section 3 until the owner says so, and never force-push without an
  explicit lease (`--force-with-lease=<branch>:<expected-sha>`).

## 2. What happened, in order

1. #20 was squash-merged (`4c9e3da`). #21, #22, #23 and #24 were still based on
   `SCRUM-32/venue-booking-requests`, whose history is not in `main` (squash discards it).
2. After that, #27 (SCRUM-64, `233bbfa`) merged and added `supabase/migrations/08_event_review_tables.sql`.
   This is why the migration in #23 had to be renumbered (section 4).
3. All four open PRs were rebased onto `origin/main` with `git rebase --onto origin/main 69ac4db`
   (`69ac4db` is the old SCRUM-32 tip). The three venue branches were rebased together with
   `--update-refs`, so the stack stays linear.
4. #21 and #24 were retargeted to `main`. #22 and #23 keep their stacked bases (see section 3).
5. `SCRUM-32/venue-booking-requests` was deleted from origin and locally after nothing used it.

This differs from the earlier instructions pasted in chat, which rebased only #21 and #24 and left #22
and #23 for later. We rebased the whole stack now so #22 and #23 do not show #20's commits in their diffs.
Those instructions also used cut points (`864d02a`, `c6d6364`) that are **no longer correct**, because
those SHAs were the pre-rebase tips. Use the new ones in section 6.

## 3. Current state of the PRs

| PR | Ticket | Branch | Base | Tip (new) | Old tip (backup) |
|---|---|---|---|---|---|
| #24 | docs | `docs/restructure-readme` | `main` | `aabd425` (before this doc commit) | `a62f54b` (`backup/24`) |
| #21 | SCRUM-37 | `SCRUM-37/pending-request-queue` | `main` | `c7c7cca` | `864d02a` (`backup/37`) |
| #22 | SCRUM-38 | `SCRUM-38/approve-booking-request` | `SCRUM-37/pending-request-queue` | `339bad2` | `c6d6364` (`backup/38`) |
| #23 | SCRUM-39 | `SCRUM-39/reject-booking-request` | `SCRUM-38/approve-booking-request` | `c35f7f1` | `d89c7b3` (`backup/39`) |

- #21 holds 6 commits, #22 adds 4 on top, #23 adds 4 on top of that (3 feature commits plus the
  migration renumber commit).
- The `backup/*` branches are local only. They point at the pre-rebase tips and can be deleted once
  everything has merged.
- Squash merge: each PR becomes one commit on `main`, so each PR title must follow the commit-title
  format (`SCRUM-<story>/AC<n> - <Imperative summary>`).

## 4. Migration 09 (`09_venue_bookings_hide_from_organiser.sql`)

Belongs to #23 (SCRUM-39, reject a booking request with a reason). It was originally numbered `08_`.

**What it does.** It drops and recreates the `venue_bookings_select` RLS policy so that only these roles
can read booking rows:
- `venue_staff`: every row.
- The assigned Event Coordinator: rows for their own events (`public.is_assigned_coordinator(event_id)`).
- Nobody else. The event's organiser can no longer read booking rows.

**Why.** Venue Staff record a rejection reason in `review_notes`. Spec scenario 39-S7 says that reason is
for Venue Staff and the assigned Coordinator only, never the Organiser. RLS cannot hide a single column,
so the organiser clause (added in `07_venue_bookings_rls.sql`) is removed from the SELECT policy instead.

**Scope and risk.**
- Only the SELECT policy changes. INSERT, UPDATE and DELETE policies from 07 are untouched.
- 07 is not edited (migrations are append-only). `public.is_event_organiser()` stays because other
  tables may use it.
- No code reads `venue_bookings` as an organiser today (the organiser dashboard queries events only), so
  no feature is lost. It does affect venue-service and the auth-service dashboards in principle, so flag
  it when merging.

**Why renumbered.** `main` already contains `08_event_review_tables.sql` (from #27), and two files must
not share a number. The renumber is a rename commit on SCRUM-39 (`c35f7f1`); the SQL is unchanged. It
had not been applied to the online Supabase, so the rename does not break the append-only rule. A
`git grep` found no other references to the old filename.

**Still to do.** SCRUM-49 (no PR yet) has its own `08_create_event_request.sql`. That one must become
`10_create_event_request.sql` (or the next free number when it is opened). After #23 merges, apply 09 to
the online Supabase.

## 5. Database state

- Online Supabase already has migrations 03, 05, 06 and 07 applied (07 was needed to test #20 because
  `venue_slot_is_held` comes from it). Whether 08 (event review tables) is applied online is not known
  from this repo; check before relying on it.
- Migrations on the stack, in order: 01 to 07 (already on `main`), 08 event review tables (`main`), 09
  hide-from-organiser (#23 only).
- Local check done: `supabase db reset` applied 01 to 09 in order from the SCRUM-39 checkout and ran the
  seed, with no errors.

## 6. Remaining steps, in order

Always `git fetch origin` first.

**After #21 is squash-merged:** rebase the rest of the stack onto `main`, cutting at the SCRUM-37 tip
that existed in the PR (`c7c7cca`), not the branch name (it will not move, but the squash commit is not
an ancestor).

```bash
git rebase --onto origin/main c7c7cca --update-refs SCRUM-39/reject-booking-request
git push --force-with-lease=SCRUM-38/approve-booking-request:339bad2 origin SCRUM-38/approve-booking-request
git push --force-with-lease=SCRUM-39/reject-booking-request:c35f7f1  origin SCRUM-39/reject-booking-request
gh pr edit 22 --base main
```
Retarget #22 **before** deleting the `SCRUM-37/pending-request-queue` branch, otherwise GitHub may
close #22.

**After #22 is squash-merged:**

```bash
git rebase --onto origin/main 339bad2 SCRUM-39/reject-booking-request
git push --force-with-lease=SCRUM-39/reject-booking-request:<tip-after-previous-step> origin SCRUM-39/reject-booking-request
gh pr edit 23 --base main
```
If a step's SHAs differ from this document (someone pushed in between), stop and re-derive the cut point
with `git log --oneline origin/main..<branch>`; the commits that belong to the PR are the ones to keep.

**Before merging #23:** its PR body still refers to `08_venue_bookings_hide_from_organiser.sql`. Update to
`09_...` (this handover's author is doing that), and confirm the body's "How to test" still matches.

**Then:** apply migration 09 online, rename SCRUM-49's migration, delete the `backup/*` branches.

## 7. Verification already done (on the rebased stack, tip `c35f7f1`)

- `pnpm vitest run`: 501 passed, 74 skipped (the 74 are DB-backed integration tests that skip without
  `SUPABASE_SECRET_KEY`).
- Integration tests against a freshly reset local Supabase:
  `pnpm vitest run --project @spm-t5/venue-service --project @spm-t5/event-service tests/integration --coverage.enabled=false`
  gave 6 files and 74 tests passed, 0 skipped. This is the same command as the CI `integration` job.
- Typecheck passed for `@spm-t5/venue-service` and `@spm-t5/web`.

**Not verified:** Playwright e2e (`pnpm --filter @spm-t5/web run test:e2e`), lint across all workspaces, and
manual browser click-through. #23's PR checklist leaves "acceptance criteria verified" unticked for that reason.

## 8. Known issue, not fixed here

The coordinator dashboard shows booking times in UTC. A booking at 17:00 SGT shows as 09:00.
`date()` in `services/auth-service/src/routes/dashboard.ts` slices the raw ISO string instead of using
`utcToSgt`. This changes user-visible behaviour, so under the repo's git conventions it needs a
SCRUM story and AC before a branch is made. It is not part of any PR above.

## 9. Repo conventions that apply (from `CLAUDE.md`)

- Jira key `SCRUM`. Write `SCRUM-<story>/AC<n>`; story numbers are not the 1 to 20 feature numbers. Never
  guess a ticket or AC; ask.
- Branches: `SCRUM-<story>/<kebab-description>` or `<type>/<kebab-description>`. Never commit or push to
  `main` directly. Never force-push someone else's branch.
- Commits: `SCRUM-<story>/AC<n> - <Imperative summary>` or `<type> - <Imperative summary>`. Mention in the
  body when a commit adds a migration or touches `packages/shared`.
- Migrations are append-only and numbered; add a new file, never edit an applied one.
- PRs target `main`, are squash-merged, and use `.github/pull_request_template.md`. Run `pnpm vitest run`
  and typecheck/lint for touched workspaces first.

## 10. Local environment notes

- Worktrees in `.claude/worktrees/`: `scrum-38` currently has `SCRUM-39/reject-booking-request` checked
  out; `agent-a55cfed9ef97f40b5` and `agent-ac9bdfcf2bf9180be` belong to other work. `.claude/` is untracked.
- `.claude/worktrees/scrum-37` is a half-deleted leftover (removal failed with "Permission denied", likely
  OneDrive or a locked file). Git no longer lists it. Delete the folder by hand; it is safe to remove.
- A local Supabase stack (Docker) may still be running from the integration test run. `supabase stop`
  frees it. The repo sits under OneDrive, which is what causes the file-lock errors above.
- `--update-refs` moves any branch pointing inside the rebased range, including local backup branches.
  Create backups under refs outside the range (or as tags) if you repeat this.

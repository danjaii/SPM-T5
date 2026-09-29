# SCRUM-<story> — <Short story title>

<!-- Copy to docs/specs/SCRUM-<story>-<slug>.md. Write this BEFORE any test or code.
     Take ACs from Jira; if you don't know them, ask — never invent them. -->

**Jira:** <link to SCRUM-<story>>
**Branch:** `SCRUM-<story>/<short-kebab-description>`

## Story

As a `<role>`, I want <capability> so that <benefit>.
<!-- role = a value of `Role` in packages/shared/src/roles.ts -->

## Acceptance criteria

### AC1 — <name>
- **Given** <starting state>
- **When** <action>
- **Then** <observable outcome>

<!-- One scenario per behaviour. Add edge cases and error cases as extra scenarios under the AC. -->

### AC2 — <name>
- **Given** …
- **When** …
- **Then** …

## AC → test mapping

<!-- Fill in as tests are written (red step). Every AC needs at least one row. -->

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `services/<name>/tests/unit/<file>.test.ts` | `SCRUM-<story>/AC1 …` |

## Affected workspaces

<!-- apps/web, services/<name>, packages/shared. Flag migrations under supabase/migrations/ and
     any C4 diagram or ADR that needs updating. -->

## Out of scope

-

## Open questions

-

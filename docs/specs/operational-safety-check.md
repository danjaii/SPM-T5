# Operational Safety Check: Final User Story

User story for **Operational Safety Check** (ConnectSphere, IS212), compiled 2026-10-16.

- `AC<n>` is the story's acceptance criterion `n`; tests are labelled `SCRUM-99/AC<n>`.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-99 | Operational Safety Check | SCRUM-116 (Safety Officer role and sign-in), SCRUM-98 (venue bookings), SCRUM-86/87 (equipment requests) |

## Implementation decisions (2026-10-16)

These override the text below where they conflict.

- **No new event status.** "Preparation" is `confirmed`. An event is **ready for a safety check** when its status is
  `awaiting_arrangements`, it has at least one active venue booking and every active one is `approved`/`confirmed`, every
  equipment request still needed is Arranged (`approved`/`reserved`; Released ones don't count, Cannot Fulfil blocks), and
  no safety decision has been recorded yet. `is_ready_for_safety_check()` in migration 37 is the one definition. **[DECIDED]**
- **The gate is in the database.** The `events_safety_gate` trigger refuses any change of `events.status` to `confirmed`
  unless the event's latest safety decision is `approved` (`SC001`). Unlike `events_assignment_guard` it applies to every
  caller, the service role included. `PATCH /events/:id/status` answers 409 for it. `canProceedToPreparation()` in
  `packages/shared/src/safetyCheck.ts` states the same rule. **[DECIDED]**
- **Decisions.** `approved`, `rejected`, `changes_requested` (`SAFETY_DECISIONS`, the `safety_decision` enum). Shown as
  Safety Approved, Safety Rejected, Changes Requested. Reject needs a reason (AC6); **Request Changes needs a comment**
  (otherwise nobody knows what to change); Approve comments are optional. `safetyDecisionProblem()` is checked by the web
  form and event-service, and the `safety_checks` table's check constraint enforces it again. **[PROPOSED]**
- **One decision per readiness.** After any decision the event leaves the queue and a second decision is refused
  (`SC002`). After Reject or Request Changes the event cannot be confirmed. **[PROPOSED]**
- **Request Changes sends the event back (SCRUM-100, migration 43).** `record_safety_decision()` moves the event
  `awaiting_arrangements → planning` in the same step, recorded in `event_status_history` with the requested changes as
  the reason (`events_status_change_guard` lets a Safety Officer make only that one status change). The coordinator makes
  the changes (a changed venue booking goes back to Pending and its equipment to Submitted, SCRUM-102) and moves the event
  back to `awaiting_arrangements`; once its arrangements are complete it is ready again (`is_ready_for_safety_check()` now
  treats a latest `changes_requested` like no decision) and needs another check before it can be confirmed. The event's
  coordinator and organiser see every safety decision (who, when, what, and the reason or comments; AC7, AC8) in the
  event page's "Safety check" section, from `GET /events/:id/safety-decisions` and `event_safety_decisions()`, which
  refuses anyone else (42501, 403). **AC9:** an important change (`EVENT_IMPORTANT_FIELDS`) to an approved event stamps
  the approval `revoked_at` (the `trg_events_revoke_safety_approval` trigger); `latest_safety_decision()` skips revoked
  decisions, so the event needs another check, and a confirmed event goes back to `awaiting_arrangements`. An ordinary
  change keeps the approval. Tests:
  `services/event-service/tests/integration/safetyRequestChangesDb.test.ts`. **[DECIDED]**
- **AC3 data.** Migration 37 adds `venues.emergency_access` and `venues.restrictions`. Equipment placement is the
  equipment request's `notes`. Known venue restrictions also list the venue's unavailability during the booking. An empty
  value is shown as "Not recorded". Venue Staff editing the two new columns is a later story. **[DECIDED]**
- **Who.** Only a Safety Officer (`canMakeSafetyDecision`) reaches the routes (`requireSafetyOfficer`) and the database
  functions (42501). `decided_by` comes from `auth.uid()`. `safety_checks` has RLS on and no policies: it is read and
  written only through the security definer functions. **[DECIDED]**

## Acceptance criteria

| AC | Given / When / Then | Where it is enforced |
| --- | --- | --- |
| AC1 | An event whose venue and technical arrangements are complete must complete a safety check before preparation | `is_ready_for_safety_check()`, `events_safety_gate` |
| AC2 | A Safety Officer sees every event ready for review | `safety_check_queue()`, `GET /safety-checks`, `/safety-checks` page, dashboard link |
| AC3 | Opening an event shows expected attendance, venue capacity and layout, emergency access, accessibility requirements, equipment placement, known venue restrictions | `safety_check_details()`, `GET /safety-checks/:id`, `SafetyCheckInfo` |
| AC4 | The Safety Officer can choose Approve, Reject or Request Changes | `SafetyCheckActions`, `POST /safety-checks/:id/decision`, `record_safety_decision()` |
| AC5 | Approve marks the event Safety Approved, and it can proceed to preparation | `SAFETY_DECISION_LABELS`, `events_safety_gate` |
| AC6 | Reject needs a reason, and the event cannot proceed | `safetyDecisionProblem()`, `safety_checks` check constraint, `events_safety_gate` |
| AC7 | An event that is not Safety Approved cannot be moved to preparation by anyone | `events_safety_gate` (`SC001`), 409 from `PATCH /events/:id/status` |
| AC8 | The decision records the Safety Officer, decision, date and time, and reason or comments | `safety_checks` row, shown after saving and on the review page |

## Database refusals

| SQLSTATE | Raised by | Meaning | event-service answer |
| --- | --- | --- | --- |
| `42501` | queue, details, decision | caller is not a Safety Officer | 403 (the route middleware refuses first) |
| `SC001` | `events_safety_gate` | moving to confirmed without a Safety Approved check | 409 |
| `SC002` | `record_safety_decision()` | event not ready, or already decided | 409 |
| `P0002` | `record_safety_decision()` | no such event | 404 |
| `23514` | `safety_checks` check | reason missing for Reject or Request Changes | 400 (the route checks first) |

## Tests

- `packages/shared/tests/safetyCheck.test.ts`: decision and reason rules, `canProceedToPreparation`.
- `services/event-service/tests/unit/safety-check.test.ts`: the routes; `event-status.test.ts`: the 409 for `SC001`.
- `services/event-service/tests/integration/safetyCheckDb.test.ts`: migration 37 against Postgres (gate, readiness,
  queue, decisions, details, who may call what).
- `apps/web/tests/unit/safety-check-*.test.tsx`, `dashboard-view.test.tsx`: the pages and form.

## Open questions

1. When a rejected event's arrangements change, should it return to the queue? (A change-requested event returns once
   the coordinator sends it back, SCRUM-100.)
2. ~~Does an approved event need a new safety check after an important change?~~ Yes, SCRUM-100/AC9.
3. Who maintains `venues.emergency_access` and `venues.restrictions` (Venue Staff, on the venue detail page)?
4. ~~Should the event's organiser and coordinator see the safety decision?~~ Yes, SCRUM-100/AC8.

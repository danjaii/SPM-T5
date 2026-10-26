# SCRUM-51 — Attach Supporting Documents to an Event Request

**Jira:** SCRUM-51 (Event Request Creation)
**Branch:** `SCRUM-51/event-request-attachments` (stacked on `SCRUM-54/resume-draft-event-request`)

## Story

As an `event_organiser`, I want to attach supporting documents to my event request so that Event Coordinators have all the
information they need to assess my request.

## Acceptance criteria

### AC1 — Upload attachment
- **Given** I am creating or editing an event request
- **When** I upload a supporting document
- **Then** the file is attached to the request and listed alongside it

Scenarios:
- A request being created or edited is the organiser's own **draft** (Week 9: organisers cannot edit a submitted request).
  The organiser asks for an upload URL (`POST /events/drafts/:id/attachments/upload-url`), the browser sends the file to
  storage, then registers it (`POST /events/drafts/:id/attachments`). The answer is 201 with the stored row.
- `GET /events/:id/request-attachments` lists the request's attachments, oldest first, for the organiser who owns it and for
  coordinators (read policy, `user_can_access_event`). Another organiser sees nothing.
- Only an organiser, only on their own draft (404 for someone else's, 409 `NOT_A_DRAFT` once submitted, 403 for other roles).
- A registered path must sit in the request's own folder in the `event-attachments` bucket (`<event id>/...`).
- A file attached to a draft is still there, and still listed, after the draft is submitted.

### AC2 — File type restriction
- **Given** the system only accepts specific file types (SCRUM-28's list, a team assumption: Week 2 Q31 left it to the team)
- **When** I attempt to upload a file of an unsupported type
- **Then** the upload is rejected and I am shown the accepted file types

Scenarios:
- The upload-URL request answers 400 `FILE_TYPE_NOT_ACCEPTED` with `acceptedTypes` (readable text) and nothing is stored. The
  form checks the same shared rule before it asks, and shows the accepted types.

### AC3 — File size restriction
- **Given** the system enforces a maximum file size (10 MB, as SCRUM-28)
- **When** I attempt to upload a file exceeding this limit
- **Then** the upload is rejected and I am shown the maximum allowed size

Scenarios:
- 400 `FILE_TOO_LARGE` with `maxBytes` and a message naming 10 MB. Exactly 10 MB is accepted.

### AC4 — Remove attachment
- **Given** I have attached a document to a request that has not yet been submitted
- **When** I choose to remove it
- **Then** the attachment is deleted from the request

Scenarios:
- `DELETE /events/drafts/:id/attachments/:attachmentId` deletes the row and the stored file. 404 for another organiser's
  or an unknown attachment, 409 `NOT_A_DRAFT` once the request is submitted (the attachment stays).

## Decisions
- Same type list and 10 MB limit as SCRUM-28 (`packages/shared/src/attachments.ts`, bucket `event-attachments`).
- New table `event_request_attachments` (migration 59). `authenticated` has no write privilege on it: rows are written only by
  `add_event_attachment()` and `remove_event_attachment()` (security definer, organiser's own draft only, as `update_event_draft`).
  The functions also re-check size and type, so the rule holds for every caller.
- Storage: the bucket and its insert/select policies exist (migration 08). Migration 59 adds a delete policy so an organiser can
  remove files of their own draft only.
- The upload is "request URL, send file, register"; a file sent but never registered is an orphan in the bucket (not listed, not
  readable by anyone but the organiser). Cleaning orphans is out of scope.
- The reusable upload panel is not yet placed in the New request form: that form has no draft yet (SCRUM-124 wires drafts).

## AC → test mapping

| AC | Test file | `describe` |
| ----- | ----- | ----- |
| AC1 | `services/event-service/tests/unit/event-request-attachments.test.ts` | `SCRUM-51/AC1 ...` |
| AC2, AC3 | same, and `packages/shared/tests/unit/attachments.test.ts` | `SCRUM-51/AC2`, `SCRUM-51/AC3` |
| AC4 | same | `SCRUM-51/AC4 ...` |
| AC1-4 (database) | `services/event-service/tests/integration/eventRequestAttachmentsDb.test.ts` | not run by the author |
| AC1-4 (form) | `apps/web/tests/unit/request-attachments.test.tsx` | `SCRUM-51/AC1` ... |

## Affected workspaces
`services/event-service`, `packages/shared` (flag: new refusal helper), `apps/web`; migration 59.

## Out of scope
- Attachments on a submitted request (Week 9: organisers cannot edit it), change requests, coordinators' own uploads (SCRUM-28 comments).
- Orphan clean-up; virus scanning; placing the panel in the New request form (SCRUM-124).

## Open questions
- Types and size are a team assumption; confirm with the customer if they object.

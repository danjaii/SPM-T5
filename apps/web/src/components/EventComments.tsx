"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Paperclip } from "lucide-react";
import { ATTACHMENT_TYPES, attachmentProblem } from "@spm-t5/shared";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { InlineMessage } from "@/components/event/InlineMessage";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  addEventComment,
  fetchAttachmentUrl,
  fetchEventComments,
  fetchMentionableUsers,
  requestUploadUrl,
  uploadFile,
  type Attachment,
  type CoordinatorOption,
  type EventComment,
  type EventComments as Comments,
} from "@/lib/events";

// SCRUM-25/AC4, SCRUM-26/AC4: shown instead of submitting an empty comment or reply.
export const COMMENT_REQUIRED = "Enter a comment before posting.";
export const REPLY_REQUIRED = "Enter a reply before posting.";

export const NO_COMMENTS = "No comments yet.";
export const NO_MATCHES = "No matching users.";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-159/AC4: the new design's pieces. The class names "comments", "comment", "comment__body" and "mention" are kept
// as labels only (tests find posts by them); the look comes from the theme classes beside them.
const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-sm font-semibold text-foreground";
const HINT = "text-sm text-muted-foreground";

/** A field's problem: an icon and the words, tied to the field by its id. */
function FieldError({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </p>
  );
}

interface Thread {
  comment: EventComment;
  replies: EventComment[];
}

/**
 * SCRUM-26/AC2, AC3: each top-level comment with its replies. Replies sit one level deep, under the comment that
 * started the thread (a reply to a reply joins its thread), and keep event-service's oldest-first order.
 */
export function toThreads(comments: EventComment[]): Thread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: EventComment) => {
    while (c.parent_comment_id && byId.has(c.parent_comment_id)) c = byId.get(c.parent_comment_id)!;
    return c;
  };
  const threads = new Map<string, Thread>();
  for (const c of comments) {
    const root = rootOf(c);
    if (root === c) threads.set(c.id, { comment: c, replies: [] });
  }
  for (const c of comments) {
    const root = rootOf(c);
    if (root !== c) threads.get(root.id)!.replies.push(c);
  }
  return [...threads.values()];
}

/** SCRUM-27/AC1: the name being typed after an "@" that ends at the cursor, or undefined when there isn't one. */
export function mentionQuery(beforeCursor: string): string | undefined {
  return /(?:^|\s)@([^@\n]{0,30})$/.exec(beforeCursor)?.[1];
}

/** Someone who can be mentioned: only people with a name are offered. */
type Named = CoordinatorOption & { full_name: string };

/**
 * SCRUM-27/AC2: the box shows "@Full Name"; event-service stores "@[userId]". Longer names go first so
 * "@Ann Lee" isn't half-replaced by a mention of "Ann".
 */
export function encodeMentions(text: string, picked: Named[]): string {
  return [...picked]
    .sort((a, b) => b.full_name.length - a.full_name.length)
    .reduce((out, u) => out.split(`@${u.full_name}`).join(`@[${u.id}]`), text);
}

// SCRUM-27/AC3: "@[userId]" markers shown as the person's name, set apart from the text around them.
function CommentBody({ comment }: { comment: EventComment }) {
  const names = new Map(comment.mentions.map((m) => [m.user_id, m.full_name]));
  const parts = comment.body.split(/@\[([^\]]+)\]/);
  return (
    <p className="comment__body mt-1 text-sm whitespace-pre-wrap break-words text-foreground">
      {parts.map((part, i) =>
        i % 2 === 0 ? part : (
          <span key={i} className="mention rounded-sm bg-highlight px-1 font-semibold text-fg-primary">@{names.get(part) ?? "Unknown user"}</span>
        ),
      )}
    </p>
  );
}

// SCRUM-28/AC2: a comment's files by name. AC3: selecting one opens it through a short-lived signed link.
function Attachments({ eventId, files }: { eventId: string; files: Attachment[] }) {
  const [error, setError] = useState<string>();

  async function open(file: Attachment) {
    setError(undefined);
    const { ok, data } = await fetchAttachmentUrl(eventId, file.storage_path);
    if (ok) window.open(data.signed_url, "_blank", "noopener");
    else setError(`We couldn't open ${file.file_name}. Please try again.`);
  }

  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
        {files.map((f) => (
          <li key={f.storage_path} className="max-w-full">
            <Button type="button" variant="outline" size="sm" className="max-w-full" onClick={() => open(f)}>
              <Paperclip aria-hidden="true" />
              <span className="truncate">{f.file_name}</span>
            </Button>
          </li>
        ))}
      </ul>
      {error && <FieldError>{error}</FieldError>}
    </>
  );
}

function CommentView({ eventId, comment }: { eventId: string; comment: EventComment }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-foreground">{comment.author_name ?? "Unknown user"}</span>
        <time dateTime={comment.created_at} className="text-sm text-muted-foreground">{formatDateTime(comment.created_at)}</time>
        {comment.is_clarification_request && <StatusBadge tone="warning" label="Clarification requested" />}
      </p>
      <CommentBody comment={comment} />
      {comment.attachments.length > 0 && <Attachments eventId={eventId} files={comment.attachments} />}
    </>
  );
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

interface FormProps {
  id: string;
  eventId: string;
  label: string;
  submitLabel: string;
  required: string;
  /**
   * Posts the trimmed text, the uploaded files and whether it asks for clarification; resolves to an error message, or
   * undefined once it is saved.
   */
  onPost: (text: string, attachments: Attachment[], clarificationRequest: boolean) => Promise<string | undefined>;
  onCancel?: () => void;
  /** SCRUM-47/AC2: offer the "ask the organiser for clarification" box (the event's coordinator, new comments only). */
  offerClarification?: boolean;
}

// SCRUM-25/AC1, AC4, SCRUM-26/AC1, AC4: a comment or reply box that won't post empty text.
// SCRUM-27/AC1, AC2: typing "@" and a name offers the people who can see the event; picking one mentions them.
// SCRUM-28/AC1, AC4-AC6: files are checked as they're chosen, staged, and uploaded when the comment is posted.
function CommentForm({ id, eventId, label, submitLabel, required, onPost, onCancel, offerClarification }: FormProps) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [clarification, setClarification] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<CoordinatorOption[]>();
  const [query, setQuery] = useState<string>();
  const [queryEnd, setQueryEnd] = useState(0); // where the "@name" being typed ends
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Named[]>([]);

  const matches =
    query === undefined || !people
      ? []
      : people.filter((p): p is Named => !!p.full_name?.toLowerCase().includes(query.toLowerCase()));
  const listId = `${id}-mentions`;
  const open = query !== undefined && people !== undefined;

  function edit(value: string, cursor: number) {
    setText(value);
    const q = mentionQuery(value.slice(0, cursor));
    setQuery(q);
    setQueryEnd(cursor);
    setActive(0);
    if (q !== undefined && people === undefined) {
      fetchMentionableUsers(eventId).then(({ ok, data }) => setPeople(ok ? data : []));
    }
  }

  function pick(person: Named) {
    const el = box.current!;
    const start = queryEnd - query!.length - 1; // back to the "@"
    const inserted = `@${person.full_name} `;
    const value = text.slice(0, start) + inserted + text.slice(queryEnd);
    setText(value);
    setQuery(undefined);
    setPicked((p) => (p.some((x) => x.id === person.id) ? p : [...p, person]));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  }

  function keyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery(undefined);
    } else if (matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
    } else if (matches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      pick(matches[active]);
    }
  }

  // SCRUM-28/AC1: stage the chosen files; AC5, AC6: turn away any that can't be attached, saying why
  function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = [...e.target.files!];
    e.target.value = ""; // so choosing the same file again still fires
    const refused = chosen.flatMap((f) => {
      const problem = attachmentProblem(f);
      return problem ? [`${f.name}: ${problem}`] : [];
    });
    setFileErrors(refused);
    setFiles((staged) => [...staged, ...chosen.filter((f) => !attachmentProblem(f))]);
  }

  async function upload(): Promise<Attachment[] | string> {
    const uploaded: Attachment[] = [];
    for (const file of files) {
      const { ok, data } = await requestUploadUrl(eventId, file);
      if (!ok || !(await uploadFile(data.upload_url, file))) {
        return `We couldn't upload ${file.name}. ${(!ok && data.error) || "Please try again."}`;
      }
      uploaded.push({ file_name: file.name, storage_path: data.storage_path });
    }
    return uploaded;
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!text.trim()) {
      setTextError(required);
      return;
    }
    setTextError(undefined);
    setBusy(true);
    const uploaded = await upload();
    const failure =
      typeof uploaded === "string" ? uploaded : await onPost(encodeMentions(text.trim(), picked), uploaded, clarification);
    if (failure) setError(failure);
    else {
      setText("");
      setClarification(false);
      setPicked([]);
      setFiles([]);
      setFileErrors([]);
    }
    setBusy(false);
  }

  const describedBy = [textError && `${id}-error`, `${id}-hint`].filter(Boolean).join(" ");

  return (
    <form className="flex flex-col gap-4" onSubmit={post} noValidate>
      {error && <InlineMessage kind="error">{error}</InlineMessage>}
      <div className={`relative ${FIELD}`}>
        <label htmlFor={id} className={LABEL}>{label}</label>
        <Textarea
          ref={box}
          id={id}
          rows={3}
          value={text}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && matches.length > 0 ? `${listId}-${active}` : undefined}
          aria-invalid={textError ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => edit(e.target.value, e.target.selectionStart)}
          onKeyDown={keyDown}
          onBlur={() => setQuery(undefined)}
        />
        <p id={`${id}-hint`} className={HINT}>Type @ to mention someone.</p>
        {open && (
          <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card shadow-md">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground" role="status">{NO_MATCHES}</p>
            ) : (
              <ul id={listId} role="listbox" aria-label="People you can mention" className="py-1">
                {matches.map((p, i) => (
                  <li
                    key={p.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="cursor-pointer px-3 py-2 text-sm hover:bg-accent aria-selected:bg-highlight aria-selected:font-semibold aria-selected:text-fg-primary"
                    // mousedown, not click: the box would lose focus (and close the menu) first
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(p);
                    }}
                  >
                    {p.full_name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {textError && <FieldError id={`${id}-error`}>{textError}</FieldError>}
      </div>
      {offerClarification && (
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            checked={clarification}
            onChange={(e) => setClarification(e.target.checked)}
          />
          Ask the organiser for clarification
        </label>
      )}
      <div className={FIELD}>
        <label htmlFor={`${id}-files`} className={LABEL}>Attach files</label>
        <input
          id={`${id}-files`}
          type="file"
          multiple
          accept={ATTACHMENT_TYPES.join(",")}
          aria-describedby={`${id}-files-hint`}
          onChange={choose}
          className="text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border-strong file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground hover:file:bg-accent"
        />
        <p id={`${id}-files-hint`} className={HINT}>Images, videos or documents, up to 10 MB each.</p>
        {fileErrors.map((msg) => <FieldError key={msg}>{msg}</FieldError>)}
        {files.length > 0 && (
          <ul className="mt-1 flex flex-col divide-y divide-border border-y border-border" aria-label="Files to attach">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                <span className="break-all text-foreground">{f.name}</span>
                <span className="text-xs text-muted-foreground">{formatSize(f.size)}</span>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0"
                  aria-label={`Remove ${f.name}`}
                  disabled={busy}
                  onClick={() => setFiles((staged) => staged.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Posting…" : submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </form>
  );
}

// SCRUM-25: the conversation on an event request between its organiser and the coordinators. event-service
// returns the comments oldest first and decides who may post (can_comment); RLS decides who may read them.
// SCRUM-26: replies, nested under the comment they answer. SCRUM-27: @mentions. SCRUM-28: file attachments.
export function EventComments({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Comments | null>();
  const [replyingTo, setReplyingTo] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    fetchEventComments(eventId).then(({ ok, data }) => {
      if (live) setData(ok ? data : null);
    });
    return () => {
      live = false;
    };
  }, [eventId, reload]);

  const post = (parentId?: string) => async (text: string, attachments: Attachment[], clarificationRequest: boolean) => {
    const { ok, data } = await addEventComment(eventId, text, parentId, attachments, clarificationRequest);
    if (!ok) return data.error ?? `We couldn't post your ${parentId ? "reply" : "comment"}. Please try again.`;
    setReplyingTo(undefined);
    setReload((n) => n + 1);
  };

  // SCRUM-26/AC1: a Reply under every comment, replies included. SCRUM-47/AC7: replying to a reply answers that reply
  // (it is still shown in the same thread), so its author is the one notified.
  const replyTo = (c: EventComment) =>
    data?.can_comment &&
    (replyingTo === c.id ? (
      <div className="mt-3 border-l-2 border-border pl-4">
        <CommentForm
          id={`reply-${c.id}`}
          eventId={eventId}
          label={`Reply to ${c.author_name ?? "this comment"}`}
          submitLabel="Post reply"
          required={REPLY_REQUIRED}
          onPost={post(c.id)}
          onCancel={() => setReplyingTo(undefined)}
        />
      </div>
    ) : (
      <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => setReplyingTo(c.id)}>
        Reply
      </Button>
    ));

  // Someone the service won't show the comments to: leave the section out.
  if (data === null) return null;

  return (
    <EventSection id="comments-heading" title="Comments">
      {data === undefined ? (
        <EmptyNote role="status">Loading comments…</EmptyNote>
      ) : (
        <div className="flex flex-col gap-4">
          {data.comments.length === 0 ? (
            <EmptyNote>{NO_COMMENTS}</EmptyNote>
          ) : (
            <ol className="comments flex flex-col divide-y divide-border">
              {toThreads(data.comments).map(({ comment, replies }) => (
                <li key={comment.id} className="comment py-4 first:pt-0 last:pb-0">
                  <CommentView eventId={eventId} comment={comment} />
                  {replyTo(comment)}

                  {replies.length > 0 && (
                    <ol
                      className="comments mt-3 flex flex-col gap-3 border-l-2 border-border pl-4"
                      aria-label={`Replies to ${comment.author_name ?? "this comment"}`}
                    >
                      {replies.map((r) => (
                        <li key={r.id} className="comment">
                          <CommentView eventId={eventId} comment={r} />
                          {replyTo(r)}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          )}

          {/* SCRUM-25/AC5: viewers who may read but not take part don't get the form */}
          {data.can_comment && (
            <div className="border-t border-border pt-4">
              <CommentForm
                id="new-comment"
                eventId={eventId}
                label="Add a comment"
                submitLabel="Post comment"
                required={COMMENT_REQUIRED}
                onPost={post()}
                offerClarification={data.can_request_clarification}
              />
            </div>
          )}
        </div>
      )}
    </EventSection>
  );
}

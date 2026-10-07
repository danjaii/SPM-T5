"use client";

import { useEffect, useRef, useState } from "react";
import {
  addEventComment,
  fetchEventComments,
  fetchMentionableUsers,
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

/**
 * SCRUM-27/AC2: the box shows "@Full Name"; event-service stores "@[userId]". Longer names go first so
 * "@Ann Lee" isn't half-replaced by a mention of "Ann".
 */
/** Someone who can be mentioned: only people with a name are offered. */
type Named = CoordinatorOption & { full_name: string };

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
    <p className="comment__body">
      {parts.map((part, i) =>
        i % 2 === 0 ? part : (
          <span key={i} className="mention">@{names.get(part) ?? "Unknown user"}</span>
        ),
      )}
    </p>
  );
}

function CommentView({ comment }: { comment: EventComment }) {
  return (
    <>
      <p className="comment__meta">
        <span className="comment__author">{comment.author_name ?? "Unknown user"}</span>
        <time dateTime={comment.created_at}>{formatDateTime(comment.created_at)}</time>
      </p>
      <CommentBody comment={comment} />
    </>
  );
}

interface FormProps {
  id: string;
  eventId: string;
  label: string;
  submitLabel: string;
  required: string;
  /** Posts the trimmed text; resolves to an error message, or undefined once it is saved. */
  onPost: (text: string) => Promise<string | undefined>;
  onCancel?: () => void;
}

// SCRUM-25/AC1, AC4, SCRUM-26/AC1, AC4: a comment or reply box that won't post empty text.
// SCRUM-27/AC1, AC2: typing "@" and a name offers the people who can see the event; picking one mentions them.
function CommentForm({ id, eventId, label, submitLabel, required, onPost, onCancel }: FormProps) {
  const box = useRef<HTMLTextAreaElement>(null);
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

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!text.trim()) {
      setTextError(required);
      return;
    }
    setTextError(undefined);
    setBusy(true);
    const failure = await onPost(encodeMentions(text.trim(), picked));
    if (failure) setError(failure);
    else {
      setText("");
      setPicked([]);
    }
    setBusy(false);
  }

  const describedBy = [textError && `${id}-error`, `${id}-hint`].filter(Boolean).join(" ");

  return (
    <form className="comment-form" onSubmit={post} noValidate>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <div className="field mention-field">
        <label htmlFor={id}>{label}</label>
        <textarea
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
        <p id={`${id}-hint`} className="field__hint">Type @ to mention someone.</p>
        {open && (
          <div className="mention-menu">
            {matches.length === 0 ? (
              <p className="mention-menu__empty" role="status">{NO_MATCHES}</p>
            ) : (
              <ul id={listId} role="listbox" aria-label="People you can mention">
                {matches.map((p, i) => (
                  <li
                    key={p.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
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
        {textError && <p id={`${id}-error`} className="field__error" role="alert">{textError}</p>}
      </div>
      <div className="event-buttons">
        <button className="btn" type="submit" disabled={busy}>{busy ? "Posting…" : submitLabel}</button>
        {onCancel && (
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  );
}

// SCRUM-25: the conversation on an event request between its organiser and the coordinators. event-service
// returns the comments oldest first and decides who may post (can_comment); RLS decides who may read them.
// SCRUM-26: replies, nested under the comment they answer. SCRUM-27: @mentions in comments and replies.
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

  const post = (parentId?: string) => async (text: string) => {
    const { ok, data } = await addEventComment(eventId, text, parentId);
    if (!ok) return data.error ?? `We couldn't post your ${parentId ? "reply" : "comment"}. Please try again.`;
    setReplyingTo(undefined);
    setReload((n) => n + 1);
  };

  // Someone the service won't show the comments to: leave the section out.
  if (data === null) return null;

  return (
    <section className="event-section" aria-labelledby="comments-heading">
      <h2 id="comments-heading">Comments</h2>

      {data === undefined ? (
        <p className="event-detail-card event-detail-card--quiet" role="status">Loading comments…</p>
      ) : (
        <div className="event-detail-card">
          {data.comments.length === 0 ? (
            <p className="event-detail-card--quiet">{NO_COMMENTS}</p>
          ) : (
            <ol className="comments">
              {toThreads(data.comments).map(({ comment, replies }) => (
                <li key={comment.id} className="comment">
                  <CommentView comment={comment} />

                  {replies.length > 0 && (
                    <ol className="comments comments--replies" aria-label={`Replies to ${comment.author_name ?? "this comment"}`}>
                      {replies.map((r) => (
                        <li key={r.id} className="comment">
                          <CommentView comment={r} />
                        </li>
                      ))}
                    </ol>
                  )}

                  {data.can_comment && (replyingTo === comment.id ? (
                    <div className="comments--replies">
                      <CommentForm
                        id={`reply-${comment.id}`}
                        eventId={eventId}
                        label={`Reply to ${comment.author_name ?? "this comment"}`}
                        submitLabel="Post reply"
                        required={REPLY_REQUIRED}
                        onPost={post(comment.id)}
                        onCancel={() => setReplyingTo(undefined)}
                      />
                    </div>
                  ) : (
                    <button className="comment__reply" type="button" onClick={() => setReplyingTo(comment.id)}>
                      Reply
                    </button>
                  ))}
                </li>
              ))}
            </ol>
          )}

          {/* SCRUM-25/AC5: viewers who may read but not take part don't get the form */}
          {data.can_comment && (
            <div className="event-detail-card__step">
              <CommentForm
                id="new-comment"
                eventId={eventId}
                label="Add a comment"
                submitLabel="Post comment"
                required={COMMENT_REQUIRED}
                onPost={post()}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

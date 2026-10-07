"use client";

import { useEffect, useState } from "react";
import {
  addEventComment,
  fetchEventComments,
  type EventComment,
  type EventComments as Comments,
} from "@/lib/events";

// SCRUM-25/AC4, SCRUM-26/AC4: shown instead of submitting an empty comment or reply.
export const COMMENT_REQUIRED = "Enter a comment before posting.";
export const REPLY_REQUIRED = "Enter a reply before posting.";

export const NO_COMMENTS = "No comments yet.";

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

function CommentView({ comment }: { comment: EventComment }) {
  return (
    <>
      <p className="comment__meta">
        <span className="comment__author">{comment.author_name ?? "Unknown user"}</span>
        <time dateTime={comment.created_at}>{formatDateTime(comment.created_at)}</time>
      </p>
      <p className="comment__body">{comment.body}</p>
    </>
  );
}

interface FormProps {
  id: string;
  label: string;
  submitLabel: string;
  required: string;
  /** Posts the trimmed text; resolves to an error message, or undefined once it is saved. */
  onPost: (text: string) => Promise<string | undefined>;
  onCancel?: () => void;
}

// SCRUM-25/AC1, AC4, SCRUM-26/AC1, AC4: a comment or reply box that won't post empty text.
function CommentForm({ id, label, submitLabel, required, onPost, onCancel }: FormProps) {
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!text.trim()) {
      setTextError(required);
      return;
    }
    setTextError(undefined);
    setBusy(true);
    const failure = await onPost(text.trim());
    if (failure) setError(failure);
    else setText("");
    setBusy(false);
  }

  return (
    <form className="comment-form" onSubmit={post} noValidate>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <textarea
          id={id}
          rows={3}
          value={text}
          aria-invalid={textError ? true : undefined}
          aria-describedby={textError ? `${id}-error` : undefined}
          onChange={(e) => setText(e.target.value)}
        />
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
// SCRUM-26: replies, nested under the comment they answer.
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

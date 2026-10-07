"use client";

import { useEffect, useState } from "react";
import { addEventComment, fetchEventComments, type EventComments as Comments } from "@/lib/events";

// SCRUM-25/AC4: shown instead of submitting an empty comment.
export const COMMENT_REQUIRED = "Enter a comment before posting.";

export const NO_COMMENTS = "No comments yet.";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-25: the conversation on an event request between its organiser and the coordinators. event-service
// returns the comments oldest first and decides who may post (can_comment); RLS decides who may read them.
export function EventComments({ eventId }: { eventId: string }) {
  const [thread, setThread] = useState<Comments | null>();
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    fetchEventComments(eventId).then(({ ok, data }) => {
      if (live) setThread(ok ? data : null);
    });
    return () => {
      live = false;
    };
  }, [eventId, reload]);

  // SCRUM-25/AC1, AC4
  async function post(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (!text.trim()) {
      setTextError(COMMENT_REQUIRED);
      return;
    }
    setTextError(undefined);
    setBusy(true);
    const { ok, data } = await addEventComment(eventId, text.trim());
    if (ok) {
      setText("");
      setReload((n) => n + 1);
    } else {
      setError(data.error ?? "We couldn't post your comment. Please try again.");
    }
    setBusy(false);
  }

  // Someone the service won't show the comments to: leave the section out.
  if (thread === null) return null;

  return (
    <section className="event-section" aria-labelledby="comments-heading">
      <h2 id="comments-heading">Comments</h2>
      {error && <div className="alert alert--error" role="alert">{error}</div>}

      {thread === undefined ? (
        <p className="event-detail-card event-detail-card--quiet" role="status">Loading comments…</p>
      ) : (
        <div className="event-detail-card">
          {thread.comments.length === 0 ? (
            <p className="event-detail-card--quiet">{NO_COMMENTS}</p>
          ) : (
            <ol className="comments">
              {thread.comments.map((c) => (
                <li key={c.id} className="comment">
                  <p className="comment__meta">
                    <span className="comment__author">{c.author_name ?? "Unknown user"}</span>
                    <time dateTime={c.created_at}>{formatDateTime(c.created_at)}</time>
                  </p>
                  <p className="comment__body">{c.body}</p>
                </li>
              ))}
            </ol>
          )}

          {/* SCRUM-25/AC5: viewers who may read but not take part don't get the form */}
          {thread.can_comment && (
            <form className="event-detail-card__step" onSubmit={post} noValidate>
              <div className="field">
                <label htmlFor="new-comment">Add a comment</label>
                <textarea
                  id="new-comment"
                  rows={3}
                  value={text}
                  aria-invalid={textError ? true : undefined}
                  aria-describedby={textError ? "new-comment-error" : undefined}
                  onChange={(e) => setText(e.target.value)}
                />
                {textError && <p id="new-comment-error" className="field__error" role="alert">{textError}</p>}
              </div>
              <div className="event-buttons">
                <button className="btn" type="submit" disabled={busy}>{busy ? "Posting…" : "Post comment"}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

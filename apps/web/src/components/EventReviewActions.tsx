"use client";

import { useState } from "react";

type Action = "approve" | "reject" | null;

interface Props {
  onApprove: () => void;
  onReject: () => void;
  canReview?: boolean;
}

export default function EventReviewActions({ onApprove, onReject, canReview = true }: Props) {
  const [pending, setPending] = useState<Action>(null);

  const confirm = () => {
    if (pending === "approve") onApprove();
    if (pending === "reject") onReject();
    setPending(null);
  };

  const cancel = () => setPending(null);

  return (
    <>
      {canReview && <button onClick={() => setPending("approve")}>Approve</button>}
      {canReview && <button onClick={() => setPending("reject")}>Reject</button>}

      {pending !== null && (
        <div role="dialog" aria-modal="true">
          <p>
            {pending === "approve"
              ? "Are you sure you want to approve this request?"
              : "Are you sure you want to reject this request?"}
          </p>
          <button onClick={confirm}>Confirm</button>
          <button onClick={cancel}>Cancel</button>
        </div>
      )}
    </>
  );
}

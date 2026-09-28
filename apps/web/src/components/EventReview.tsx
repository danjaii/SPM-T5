"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BfcacheGuard } from "./BfcacheGuard";

const serviceUrl = process.env.NEXT_PUBLIC_EVENT_REVIEW_SERVICE_URL ?? "http://localhost:4006";
type Access = "checking" | "allowed" | "denied" | "signed-out" | "unavailable";

export function EventReview({ requestId }: { requestId?: string }) {
  // Remount when navigating to another request: never reuse the previous decision.
  return <RequestAccess key={requestId ?? ""} requestId={requestId} />;
}

function RequestAccess({ requestId }: { requestId?: string }) {
  const [access, setAccess] = useState<Access>("checking");
  useEffect(() => {
    const controller = new AbortController();
    async function checkAccess() {
      try {
        const path = requestId ? `/review/requests/${encodeURIComponent(requestId)}` : "/review/requests";
        const response = await fetch(`${serviceUrl}${path}`, {
          credentials: "include", cache: "no-store", signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) setAccess("signed-out");
        else if ([400, 403, 404].includes(response.status)) setAccess("denied");
        else setAccess(response.ok ? "allowed" : "unavailable");
      } catch {
        if (!controller.signal.aborted) setAccess("unavailable");
      }
    }
    void checkAccess();
    return () => controller.abort();
  }, [requestId]);

  return (
    <><BfcacheGuard /><main className="dash__main">
      <h1>Event request</h1>
      {access === "checking" ? <p role="status">Checking access…</p> : null}
      {access === "allowed" ? <p>You have access to this request.</p> : null}
      {access === "denied" ? <div role="alert">Request not found or access denied.</div> : null}
      {access === "signed-out" ? <div role="alert">Please sign in to view this request. <Link href="/login">Sign in</Link></div> : null}
      {access === "unavailable" ? <div role="alert">Could not verify access. Please try again later.</div> : null}
    </main></>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SubmittedEventRequest } from "@spm-t5/shared";
import { BfcacheGuard } from "./BfcacheGuard";

const serviceUrl = process.env.NEXT_PUBLIC_EVENT_REVIEW_SERVICE_URL ?? "http://localhost:4006";
type Access = "checking" | "allowed" | "denied" | "signed-out" | "unavailable";
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function RequestDate({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{dateFormat.format(new Date(value))} SGT</time> : "Not provided";
}

export function EventReview({ requestId }: { requestId?: string }) {
  // Remount when navigating to another request: never reuse the previous decision.
  return <RequestAccess key={requestId ?? ""} requestId={requestId} />;
}

function RequestAccess({ requestId }: { requestId?: string }) {
  const [access, setAccess] = useState<Access>("checking");
  const [detail, setDetail] = useState<SubmittedEventRequest | null>(null);
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
        else if (response.ok) {
          const request = await response.json() as SubmittedEventRequest;
          if (controller.signal.aborted) return;
          setDetail(request);
          setAccess("allowed");
        } else setAccess("unavailable");
      } catch {
        if (!controller.signal.aborted) setAccess("unavailable");
      }
    }
    void checkAccess();
    return () => controller.abort();
  }, [requestId]);

  return (
    <><BfcacheGuard /><main className="dash__main">
      <h1>{access === "allowed" && detail ? detail.name : "Event request"}</h1>
      {access === "checking" ? <p role="status">Checking access…</p> : null}
      {access === "allowed" && detail ? <dl>
        <dt>Event organiser</dt><dd>{detail.organiser_name}</dd>
        <dt>Event purpose</dt><dd>{detail.purpose?.trim() || "Not provided"}</dd>
        <dt>Preferred start</dt><dd><RequestDate value={detail.preferred_start_datetime} /></dd>
        <dt>Preferred end</dt><dd><RequestDate value={detail.preferred_end_datetime} /></dd>
        <dt>Expected attendees</dt><dd>{detail.expected_attendance ?? "Not provided"}</dd>
        <dt>Layout preferences</dt><dd>{detail.layout_preferences?.trim() || "Not provided"}</dd>
        <dt>Accessibility needs</dt><dd>{detail.accessibility_requirements?.trim() || "Not provided"}</dd>
        <dt>Equipment needs</dt><dd>{detail.equipment_requirements_notes?.trim() || "Not provided"}</dd>
        <dt>Submission date</dt><dd><RequestDate value={detail.submitted_at} /></dd>
        <dt>Current status</dt><dd>{detail.status === "submitted" ? "Submitted" : detail.status}</dd>
      </dl> : null}
      {access === "denied" ? <div role="alert">Request not found or access denied.</div> : null}
      {access === "signed-out" ? <div role="alert">Please sign in to view this request. <Link href="/login">Sign in</Link></div> : null}
      {access === "unavailable" ? <div role="alert">Could not verify access. Please try again later.</div> : null}
    </main></>
  );
}

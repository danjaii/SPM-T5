"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { canReviewEvents, EVENT_STATUSES, isRole } from "@spm-t5/shared";
import { fetchReviewQueue, type ReviewQueueItem } from "@/lib/eventsApi";
import { ForbiddenError, UnauthorizedError } from "@/lib/http";
import { fetchCurrentUser } from "@/lib/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statusLabel } from "./EventStatusBadge";
import { ReviewQueueSkeleton, ReviewQueueTable } from "./ReviewQueueTable";

const ALL = "all";
const STATUS_ITEMS = [
  { value: ALL, label: "All statuses" },
  ...EVENT_STATUSES.map((status) => ({ value: status, label: statusLabel(status) })),
];

type Access = "checking" | "allowed" | "denied";
type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; events: ReviewQueueItem[] };

const SEARCH_DEBOUNCE_MS = 300;

export function ReviewQueue() {
  const router = useRouter();
  const [access, setAccess] = useState<Access>("checking");
  const [status, setStatus] = useState<string>("submitted");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [retry, setRetry] = useState(0);

  const invalidRange = from !== "" && to !== "" && from > to;

  // Who is this? Only coordinators get past here; the server enforces the same rule on GET /events.
  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then((user) => setAccess(isRole(user.role) && canReviewEvents(user.role) ? "allowed" : "denied"))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof UnauthorizedError) router.replace("/login");
        else setAccess("denied");
      });
    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (access !== "allowed" || invalidRange) return;
    const controller = new AbortController();
    setLoad({ state: "loading" });
    fetchReviewQueue(
      { statuses: status === ALL ? [...EVENT_STATUSES] : [status], search: debouncedSearch, from, to },
      controller.signal,
    )
      .then((events) => setLoad({ state: "ready", events }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof UnauthorizedError) router.replace("/login");
        else if (error instanceof ForbiddenError) setAccess("denied");
        else setLoad({ state: "error", message: error instanceof Error ? error.message : "Something went wrong." });
      });
    return () => controller.abort();
  }, [access, status, debouncedSearch, from, to, invalidRange, retry, router]);

  if (access === "checking") return <ReviewQueueSkeleton />;

  if (access === "denied") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re not allowed to view this page</CardTitle>
          <CardDescription>Only event coordinators can review submitted event requests.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event requests</CardTitle>
        <CardDescription>Requests assigned to you or not yet assigned to anyone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm">
            Status
            <Select items={STATUS_ITEMS} value={status} onValueChange={(value) => value && setStatus(value)}>
              <SelectTrigger className="w-full" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            Search
            <Input
              type="search"
              placeholder="Event or organiser name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Submitted from
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Submitted to
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {invalidRange ? (
          <p role="alert" className="text-sm text-destructive">
            The &quot;from&quot; date must be on or before the &quot;to&quot; date.
          </p>
        ) : load.state === "loading" ? (
          <ReviewQueueSkeleton />
        ) : load.state === "error" ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">{load.message}</p>
            <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : load.events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No event requests match these filters.</p>
        ) : (
          <ReviewQueueTable events={load.events} />
        )}
      </CardContent>
    </Card>
  );
}

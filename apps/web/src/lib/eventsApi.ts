import { getJson } from "./http";

// event-service, called directly from the browser (no gateway).
export const EVENT_URL = process.env.NEXT_PUBLIC_EVENT_SERVICE_URL ?? "http://localhost:4002";

/** One row of GET /events, as event-service returns it. */
export interface ReviewQueueItem {
  id: string;
  name: string;
  status: string;
  submitted_at: string | null;
  organiser_name: string | null;
}

export interface ReviewQueueFilters {
  /** One or more statuses. event-service defaults to "submitted" only when none are sent. */
  statuses: string[];
  search?: string;
  /** Submission date range, YYYY-MM-DD. */
  from?: string;
  to?: string;
}

export function buildReviewQueueQuery({ statuses, search, from, to }: ReviewQueueFilters): string {
  const params = new URLSearchParams();
  for (const status of statuses) params.append("status", status);
  if (search?.trim()) params.set("search", search.trim());
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** SCRUM-22: the coordinator's queue of event requests. Throws UnauthorizedError / ForbiddenError / ApiError. */
export function fetchReviewQueue(filters: ReviewQueueFilters, signal?: AbortSignal): Promise<ReviewQueueItem[]> {
  return getJson<ReviewQueueItem[]>(`${EVENT_URL}/events${buildReviewQueueQuery(filters)}`, signal);
}

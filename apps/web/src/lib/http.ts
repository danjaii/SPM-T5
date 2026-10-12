/** A non-2xx answer from a service. `status` lets callers react to 401 / 403 without string matching. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** 401: not signed in, or the session expired. The UI sends the user to the login page. */
export class UnauthorizedError extends ApiError {
  constructor(message = "Not signed in.") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

/** 403: signed in, but this role may not do it. */
export class ForbiddenError extends ApiError {
  constructor(message = "You are not allowed to do this.") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

/** GET JSON from a service, sending the session cookie. Throws a typed error for any failure. */
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("We couldn't reach the server. Please try again.", 0);
  }

  if (res.ok) return (await res.json()) as T;

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) throw new UnauthorizedError(body.error);
  if (res.status === 403) throw new ForbiddenError(body.error);
  throw new ApiError(body.error ?? "Something went wrong. Please try again.", res.status);
}

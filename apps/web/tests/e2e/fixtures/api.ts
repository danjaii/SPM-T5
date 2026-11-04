import type { APIRequestContext, Page } from "@playwright/test";

export interface ApiResult {
  status: number;
  body: unknown;
}

/**
 * A call to a service as the person a page is signed in as (the page's context carries their session cookie), the way the
 * web app itself calls it. For checking what the UI hides: what a wrong-role caller is told, and that nothing changed.
 */
export async function callAs(page: Page | APIRequestContext, method: "GET" | "POST", url: string, body?: unknown): Promise<ApiResult> {
  const request = "request" in page ? page.request : page;
  const res = await request.fetch(url, { method, data: body, maxRedirects: 0 });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status(), body: parsed };
}

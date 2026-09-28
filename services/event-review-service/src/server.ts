import { createApp } from "./app";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set.");
}
const port = Number(process.env.PORT ?? 4006);
createApp({ url, publishableKey, webOrigin: process.env.WEB_ORIGIN }).listen(port, () => {
  console.log(`event-review-service listening on http://localhost:${port}`);
});

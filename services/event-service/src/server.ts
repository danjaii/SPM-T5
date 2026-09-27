import { createApp } from "./app";
import { createSupabaseDeps } from "./supabase";

const port = Number(process.env.PORT ?? 4002);
createApp(createSupabaseDeps()).listen(port, () => {
  console.log(`event-service listening on http://localhost:${port}`);
});

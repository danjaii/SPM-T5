import { createApp } from "./app";
import { createSupabaseDeps } from "./supabase";

const port = Number(process.env.PORT ?? 4005);
createApp(createSupabaseDeps()).listen(port, () => {
  console.log(`notification-service listening on http://localhost:${port}`);
});

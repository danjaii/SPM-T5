import { createApp } from "./app";
import { createSupabaseDeps } from "./supabase";

const port = Number(process.env.PORT ?? 4003);
createApp(createSupabaseDeps()).listen(port, () => {
  console.log(`venue-service listening on http://localhost:${port}`);
});

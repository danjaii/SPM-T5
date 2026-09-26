import { createApp } from "./app";
import { createSupabaseDeps } from "./supabase";

const port = Number(process.env.PORT ?? 4001);
createApp(createSupabaseDeps()).listen(port, () => {
  console.log(`auth-service listening on http://localhost:${port}`);
});

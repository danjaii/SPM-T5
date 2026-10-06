import { createApp } from "./app";
import { createSupabaseDeps } from "./supabase";

const port = Number(process.env.PORT ?? 4004);
createApp(createSupabaseDeps()).listen(port, () => {
  console.log(`equipment-service listening on http://localhost:${port}`);
});

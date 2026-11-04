import { createApp } from "./app";
import { startHoldExpiryCheck } from "./services/holdExpiryCheck";
import { createHoldExpiryDb, createSupabaseDeps } from "./supabase";

const port = Number(process.env.PORT ?? 4005);
createApp(createSupabaseDeps()).listen(port, () => {
  console.log(`notification-service listening on http://localhost:${port}`);
});

// SCRUM-108: every minute, write the "hold expires soon" and "hold expired" notifications that have become due
const holdDb = createHoldExpiryDb();
if (holdDb) startHoldExpiryCheck({ db: holdDb });
else console.warn("SUPABASE_SECRET_KEY is not set: hold expiry notifications will not be written.");

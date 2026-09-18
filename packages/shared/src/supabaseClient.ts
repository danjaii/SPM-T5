import { createClient } from "@supabase/supabase-js";

export function getSupabaseClient(url: string, key: string) {
  return createClient(url, key);
}

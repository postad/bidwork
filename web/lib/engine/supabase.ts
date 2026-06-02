import { createClient } from "@supabase/supabase-js";

// Service-role client for the engine (Trigger.dev tasks). Bypasses RLS — used to
// read configs/documents and write extractions/bids across workspaces during dispatch.
// NEVER import this into client components or the browser bundle.
export function engineDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

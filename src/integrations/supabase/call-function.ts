import { supabase } from "@/integrations/supabase/client";

// User-facing writes go through Edge Functions (M2): the browser can no longer
// write flight.subscriptions or flight.notification_history itself.
export async function callFunction(slug: string, body: unknown): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return fetch(`${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
    },
    body: JSON.stringify(body),
  });
}

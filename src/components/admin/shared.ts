import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Route_ = Tables<"routes">;
export type Subscription = Tables<"subscriptions">;
export type Notification = Tables<"notification_history">;

export const STATUSES = ["pending_payment", "active", "cancelled", "expired"] as const;
export const PAGE_SIZE = 20;

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-TW") : "";

// Shared by the overview (routes table) and the subscriptions page (manual-send
// check), so both hit the same cache entry.
export function useAdminRoutes() {
  return useQuery({
    queryKey: ["admin", "routes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("routes").select("*");
      if (error) throw error;
      return data as Route_[];
    },
  });
}

export type BoolSetting = { enabled: boolean; updatedAt: string | null };

export const settingQueryKey = (key: string) => ["admin", "settings", key];

// An admin switch in flight.settings, read through RLS (admins read every key).
// A missing row reads as defaultEnabled, matching the Edge Functions that read it:
// most switches default on, testing aids such as force_expire_enabled default off.
export function useBoolSetting(key: string, defaultEnabled = true) {
  return useQuery({
    queryKey: settingQueryKey(key),
    queryFn: async (): Promise<BoolSetting> => {
      const { data, error } = await supabase
        .from("settings")
        .select("value, updated_at")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return {
        enabled: data ? data.value !== false : defaultEnabled,
        updatedAt: data?.updated_at ?? null,
      };
    },
  });
}

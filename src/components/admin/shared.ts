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

export type ParserRun = Tables<"parser_runs">;

// One entry of parser_runs.issues (written by flight-parser).
export type ParserIssue = {
  route?: string;
  source?: "v3" | "v1";
  currency?: string;
  kind: "rate_limited" | "http" | "error" | "no_fare" | "db";
  status?: number;
  message: string;
};

export const ISSUE_LABELS: Record<ParserIssue["kind"], string> = {
  rate_limited: "被限流 429",
  http: "HTTP 錯誤",
  error: "連線錯誤",
  no_fare: "查無票價",
  db: "資料庫錯誤",
};

// pg_cron runs the parser every 30 min; a run finishes in seconds. Past these
// the run log itself is the anomaly (cron stopped, or a run died mid-way).
const CRON_STALE_MS = 65 * 60_000;
const RUN_STUCK_MS = 10 * 60_000;

export type ParserHealth =
  | { level: "ok" | "warning" | "error"; message: string; run: ParserRun | null }
  | { level: "unknown"; message: string; run: null };

// The overall state an admin should see first, from the two newest runs (the
// newest may still be in progress).
export function parserHealth(runs: ParserRun[], now = Date.now()): ParserHealth {
  const [latest, previous] = runs;
  if (!latest) return { level: "unknown", message: "尚無查價紀錄", run: null };
  const age = now - new Date(latest.started_at).getTime();
  if (age > CRON_STALE_MS) {
    return {
      level: "error",
      message: `超過 ${Math.round(age / 60_000)} 分鐘沒有查價：排程（pg_cron）或它用的 service-role 金鑰可能失效`,
      run: latest,
    };
  }
  if (latest.status === "running" && age > RUN_STUCK_MS) {
    return {
      level: "error",
      message: "上一次查價沒有跑完：可能中途出錯或超過 Edge Function 執行時間上限",
      run: latest,
    };
  }
  const run = latest.status === "running" ? (previous ?? null) : latest;
  if (!run) return { level: "unknown", message: "第一次查價進行中", run: null };
  const issues = (run.issues ?? []) as ParserIssue[];
  const rateLimited = issues.filter((i) => i.kind === "rate_limited").length;
  if (run.status === "error") {
    return {
      level: "error",
      message:
        rateLimited > 0
          ? `最近一次查價被 Travelpayouts 限流（429）${rateLimited} 次`
          : `最近一次查價有 ${issues.length} 個錯誤`,
      run,
    };
  }
  if (run.status === "warning") {
    return {
      level: "warning",
      message: issues.length
        ? `最近一次查價有 ${issues.length} 個警告`
        : `最近一次查價耗時 ${((run.duration_ms ?? 0) / 1000).toFixed(1)} 秒，接近執行時間上限`,
      run,
    };
  }
  return { level: "ok", message: "最近一次查價正常", run };
}

export const parserRunsQueryKey = ["admin", "parser-runs"];

// The newest runs, for the overview banner.
export function useLatestParserRuns() {
  return useQuery({
    queryKey: [...parserRunsQueryKey, "latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parser_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(2);
      if (error) throw error;
      return data as ParserRun[];
    },
  });
}

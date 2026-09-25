import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/integrations/supabase/call-function";
import { Switch } from "@/components/ui/switch";
import {
  STATUSES,
  type BoolSetting,
  fmtDateTime,
  settingQueryKey,
  useAdminRoutes,
  useBoolSetting,
} from "@/components/admin/shared";
import { ParserHealthBanner, StatCard } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminOverviewPage,
});

const MONTHLY_PRICE_TWD = 300;

// Page 1: stats, settings and the latest price per route. The subscription and
// notification tables have their own paginated pages.
function AdminOverviewPage() {
  const routesQuery = useAdminRoutes();

  // Only the columns the stat cards count.
  const statsQuery = useQuery({
    queryKey: ["admin", "subscription-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("subscription_status, payment_method, payment_failed_at");
      if (error) throw error;
      return data;
    },
  });

  const subscriptions = useMemo(() => statsQuery.data ?? [], [statsQuery.data]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of subscriptions)
      counts[s.subscription_status] = (counts[s.subscription_status] ?? 0) + 1;
    return counts;
  }, [subscriptions]);

  const activeCount = statusCounts["active"] ?? 0;
  // Free rows (payment_required was off) bring in no money.
  const paidActiveCount = subscriptions.filter(
    (s) => s.subscription_status === "active" && s.payment_method !== "free",
  ).length;
  const paymentFailedCount = subscriptions.filter((s) => s.payment_failed_at != null).length;

  const loading = routesQuery.isLoading || statsQuery.isLoading;
  const erroredOut = routesQuery.isError || statsQuery.isError;

  return (
    <>
      {erroredOut && (
        <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          資料載入失敗，請重新整理。 / Couldn't load admin data — please refresh.
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <ParserHealthBanner linkToRuns />

          {/* Stat cards */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="有效訂閱 Active" value={activeCount} />
            <StatCard
              label="預估月營收 MRR"
              value={`NT$${(paidActiveCount * MONTHLY_PRICE_TWD).toLocaleString()}`}
            />
            <StatCard label="總訂閱數 Total" value={subscriptions.length} />
            <StatCard
              label="付款失敗 Payment failed"
              value={paymentFailedCount}
              tone={paymentFailedCount > 0 ? "destructive" : undefined}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATUSES.map((status) => (
              <StatCard key={status} label={status} value={statusCounts[status] ?? 0} />
            ))}
          </div>

          <SettingsSection />

          {/* Routes / last price */}
          <section className="mt-10">
            <h2 className="text-lg font-bold">航線最新價格 Routes</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Route</th>
                    <th className="px-4 py-2">Last price</th>
                    <th className="px-4 py-2">Last checked</th>
                  </tr>
                </thead>
                <tbody>
                  {(routesQuery.data ?? []).map((r) => (
                    <tr key={r.plan_name} className="border-t border-border/60">
                      <td className="px-4 py-2">{r.display_name}</td>
                      <td className="px-4 py-2">
                        {r.last_price != null
                          ? `${r.last_price_currency === "TWD" ? "NT$" : `${r.last_price_currency} `}${Number(r.last_price).toLocaleString()}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {fmtDateTime(r.last_checked_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

// Admin switches (flight.settings). Read through RLS (admins read every key);
// written through flight-admin-settings. A missing row means on unless the
// switch passes defaultEnabled={false}, matching the Edge Functions that read it.
function SettingsSection() {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold">設定 Settings</h2>
      <BooleanSetting
        settingKey="payment_required"
        label="使用綠界付款 / Require ECPay payment"
        description={
          <>
            開啟：訂閱需經綠界信用卡定期定額付款（NT$300/月）。
            關閉：不需付款，訂閱立即生效一個月，到期自動結束（可再免費重新訂閱），取消立即生效。
            切回開啟時，現有的免費訂閱保留到各自的到期日。立即套用於之後的新訂閱。
          </>
        }
      />
      <BooleanSetting
        settingKey="v1_compare_enabled"
        label="v1 價格對照 / v1 price comparison"
        description={
          <>
            開啟：每次查價同時查 Travelpayouts v1，通知信列出 v1
            對照（無資料時顯示「目前無資料」）。 關閉：不查 v1，通知信不顯示 v1
            區塊。此設定不影響通知的觸發；自動查價於下次排程（最多 30 分鐘）套用，手動發送立即套用。
          </>
        }
      />
      <BooleanSetting
        settingKey="force_expire_enabled"
        defaultEnabled={false}
        label="測試：強制到期 / Testing: force expire"
        description={
          <>
            開啟：「所有訂閱」頁中狀態為 cancelled 的訂閱會出現「強制到期」按鈕，admin
            可逐筆立即改為 expired（寄出到期通知信），不必等到 period end。
            關閉（預設）：不顯示按鈕，cancelled 照常保留到 period end 才由排程到期。僅供測試。
          </>
        }
      />
    </section>
  );
}

function BooleanSetting({
  settingKey,
  label,
  description,
  defaultEnabled = true,
}: {
  settingKey: string;
  label: string;
  description: ReactNode;
  defaultEnabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const queryKey = settingQueryKey(settingKey);
  const settingQuery = useBoolSetting(settingKey, defaultEnabled);

  // Optimistic: the switch flips on click and the save (1-3 s through the Edge
  // Function) runs behind it; a failed save puts the previous value back.
  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await callFunction("flight-admin-settings", {
        key: settingKey,
        value: enabled,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      return data as { value: unknown; updated_at: string };
    },
    onMutate: async (enabled) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BoolSetting>(queryKey);
      queryClient.setQueryData<BoolSetting>(queryKey, {
        enabled,
        updatedAt: previous?.updatedAt ?? null,
      });
      return { previous };
    },
    onSuccess: (data) =>
      queryClient.setQueryData<BoolSetting>(queryKey, {
        enabled: data.value !== false,
        updatedAt: data.updated_at,
      }),
    onError: (e, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setError(e instanceof Error ? e.message : "儲存失敗 Save failed");
    },
  });

  const enabled = settingQuery.data?.enabled ?? defaultEnabled;
  const id = `setting-${settingKey}`;

  return (
    <div className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-border p-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {settingQuery.data?.updatedAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            最後更新：{fmtDateTime(settingQuery.data.updatedAt)}
          </p>
        )}
        {settingQuery.isError && (
          <p className="mt-1 text-xs text-destructive">讀取設定失敗 Couldn't load setting</p>
        )}
        {mutation.isPending && (
          <p className="mt-1 text-xs text-muted-foreground">儲存中… Saving…</p>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={settingQuery.isLoading}
        // Ignore clicks while a save is in flight rather than greying the switch
        // out; two overlapping saves could land out of order.
        onCheckedChange={(checked) => {
          if (!mutation.isPending) mutation.mutate(checked);
        }}
      />
    </div>
  );
}

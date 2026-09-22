import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/integrations/supabase/call-function";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminPage,
});

type Route_ = Tables<"routes">;
type Subscription = Tables<"subscriptions">;
type Notification = Tables<"notification_history">;

const STATUSES = ["pending_payment", "active", "cancelled", "expired"] as const;
const MONTHLY_PRICE_TWD = 300;

const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW") : "");

function AdminPage() {
  const routesQuery = useQuery({
    queryKey: ["admin", "routes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("routes").select("*");
      if (error) throw error;
      return data as Route_[];
    },
  });

  const subscriptionsQuery = useQuery({
    queryKey: ["admin", "subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Subscription[];
    },
  });

  const notificationsQuery = useQuery({
    queryKey: ["admin", "notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_history")
        .select("*")
        .order("sent_at", { ascending: false });
      if (error) throw error;
      return data as Notification[];
    },
  });

  const subscriptions = useMemo(() => subscriptionsQuery.data ?? [], [subscriptionsQuery.data]);
  const routesByPlan = useMemo(() => {
    const map = new Map<string, Route_>();
    for (const r of routesQuery.data ?? []) map.set(r.plan_name, r);
    return map;
  }, [routesQuery.data]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of subscriptions)
      counts[s.subscription_status] = (counts[s.subscription_status] ?? 0) + 1;
    return counts;
  }, [subscriptions]);

  const activeCount = statusCounts["active"] ?? 0;
  const paymentFailedCount = subscriptions.filter((s) => s.payment_failed_at != null).length;

  // notification_history has user_id but no email column and no FK PostgREST can
  // auto-embed, so resolve it client-side from the subscriptions we already have.
  // TODO: a user_id with notification history but no surviving subscription row
  // (e.g. subscribed, got notified, subscription row later removed) won't resolve
  // and falls back to the raw UUID below. Fine for this MVP pass; if it becomes
  // common, replace with an admin-only view joining auth.users directly.
  const emailByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subscriptions) map.set(s.user_id, s.email);
    return map;
  }, [subscriptions]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredSubscriptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return subscriptions.filter((s) => {
      if (statusFilter !== "all" && s.subscription_status !== statusFilter) return false;
      if (!term) return true;
      return s.email.toLowerCase().includes(term) || s.route.toLowerCase().includes(term);
    });
  }, [subscriptions, search, statusFilter]);

  const loading =
    routesQuery.isLoading || subscriptionsQuery.isLoading || notificationsQuery.isLoading;
  const erroredOut =
    routesQuery.isError || subscriptionsQuery.isError || notificationsQuery.isError;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              ✈️
            </span>
            <span className="text-sm font-bold tracking-tight sm:text-base">
              Flight Price Notifier — Admin
            </span>
          </Link>
          <Link
            to="/dashboard"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            回到 Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>

        {erroredOut && (
          <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            資料載入失敗，請重新整理。 / Couldn't load admin data — please refresh.
          </p>
        )}

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/* Stat cards */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="有效訂閱 Active" value={activeCount} />
              <StatCard
                label="預估月營收 MRR"
                value={`NT$${(activeCount * MONTHLY_PRICE_TWD).toLocaleString()}`}
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

            {/* Subscriptions */}
            <section className="mt-10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">
                  所有訂閱 Subscriptions ({filteredSubscriptions.length}/{subscriptions.length})
                </h2>
                <div className="flex gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜尋 email 或 route"
                    className="h-9 w-56 rounded-lg border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="all">All statuses</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Route</th>
                      <th className="px-4 py-2">Target price</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Period end</th>
                      <th className="px-4 py-2">Payment failed</th>
                      <th className="px-4 py-2">Renewals</th>
                      <th className="px-4 py-2">Created</th>
                      <th className="px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubscriptions.map((s) => (
                      <SubscriptionRow
                        key={s.id}
                        subscription={s}
                        route={routesByPlan.get(s.plan_name)}
                      />
                    ))}
                    {filteredSubscriptions.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                          No matching subscriptions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Notification history */}
            <section className="mt-10">
              <h2 className="text-lg font-bold">通知紀錄 Notification history</h2>
              <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Route</th>
                      <th className="px-4 py-2">Price</th>
                      <th className="px-4 py-2">Sent at</th>
                      <th className="px-4 py-2">Triggered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(notificationsQuery.data ?? []).map((n) => (
                      <tr key={n.id} className="border-t border-border/60">
                        <td className="px-4 py-2">{emailByUserId.get(n.user_id) ?? n.user_id}</td>
                        <td className="px-4 py-2">{n.route}</td>
                        <td className="px-4 py-2">
                          {n.currency} {Number(n.price).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {fmtDateTime(n.sent_at)}
                        </td>
                        <td className="px-4 py-2">
                          {n.triggered_by ? (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                              手動 Manual
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">自動 Auto</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(notificationsQuery.data ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                          No notifications sent yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function subscriptionIsPaying(s: Subscription): boolean {
  return (
    s.subscription_status === "active" ||
    (s.subscription_status === "cancelled" &&
      s.current_period_end != null &&
      new Date(s.current_period_end) >= new Date())
  );
}

function SubscriptionRow({
  subscription: s,
  route,
}: {
  subscription: Subscription;
  route: Route_ | undefined;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const matchesNow =
    subscriptionIsPaying(s) &&
    route?.last_price != null &&
    Number(s.target_price) >= Number(route.last_price);

  const notifyMutation = useMutation({
    mutationFn: async () => {
      const res = await callFunction("flight-admin-notify", { subscription_id: s.id });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "send failed");
      return data as { sent: number; skipped: number };
    },
    onSuccess: (data) => {
      setConfirming(false);
      setResult(
        data.sent > 0
          ? "已發送（標記為 admin 手動觸發，見下方通知紀錄）Sent — marked as admin-triggered, see notification history below"
          : "略過（Resend 拒絕或已存在同筆紀錄）",
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "notifications"] });
    },
    onError: (e) => {
      setResult(e instanceof Error ? e.message : "發送失敗 Send failed");
    },
  });

  return (
    <tr className="border-t border-border/60">
      <td className="px-4 py-2">{s.email}</td>
      <td className="px-4 py-2">{s.route}</td>
      <td className="px-4 py-2">
        {s.currency} {Number(s.target_price).toLocaleString()}
      </td>
      <td className="px-4 py-2">
        <span
          className={
            s.payment_failed_at
              ? "rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive"
              : s.subscription_status === "active"
                ? "rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary"
                : "rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
          }
        >
          {s.subscription_status}
        </span>
      </td>
      <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(s.current_period_end)}</td>
      <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(s.payment_failed_at)}</td>
      <td className="px-4 py-2 text-muted-foreground">{s.total_success_times ?? 0}</td>
      <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(s.created_at)}</td>
      <td className="px-4 py-2">
        {matchesNow &&
          (confirming ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">確定發送？</span>
              <button
                onClick={() => notifyMutation.mutate()}
                disabled={notifyMutation.isPending}
                className="rounded-md border border-primary px-2 py-1 font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              >
                {notifyMutation.isPending ? "發送中…" : "確定"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={notifyMutation.isPending}
                className="rounded-md border border-border px-2 py-1 text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setResult(null);
                setConfirming(true);
              }}
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              手動發送
            </button>
          ))}
        {result && <p className="mt-1 text-xs text-muted-foreground">{result}</p>}
      </td>
    </tr>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "destructive" | undefined;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${tone === "destructive" ? "text-destructive" : "text-card-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

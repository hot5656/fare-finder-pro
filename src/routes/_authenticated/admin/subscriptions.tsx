import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/integrations/supabase/call-function";
import {
  PAGE_SIZE,
  STATUSES,
  fmtDateTime,
  type Route_,
  type Subscription,
  useAdminRoutes,
  useBoolSetting,
} from "@/components/admin/shared";
import { Pager } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/subscriptions")({
  component: AdminSubscriptionsPage,
});

// Characters that would break the PostgREST or() filter string; the search is a
// plain substring match, so dropping them loses nothing useful.
const sanitizeTerm = (term: string) => term.replace(/[%*,()"\\]/g, "").trim();

function AdminSubscriptionsPage() {
  const routesQuery = useAdminRoutes();

  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Debounce the search box so each keystroke doesn't hit the database.
  useEffect(() => {
    const t = setTimeout(() => setTerm(sanitizeTerm(search)), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [term, statusFilter]);

  // Filtered and paged in the database so the page stays small however many rows
  // there are.
  const forceExpireQuery = useBoolSetting("force_expire_enabled", false);
  const canForceExpire = forceExpireQuery.data?.enabled === true;

  const routeCodes = useMemo(
    () =>
      term
        ? (routesQuery.data ?? [])
            .filter((r) => r.route && r.display_name.includes(term))
            .map((r) => r.route as string)
        : [],
    [routesQuery.data, term],
  );

  const subscriptionsQuery = useQuery({
    // The search also matches the Chinese route name (e.g. 東京), which lives only
    // in flight.routes, so translate it to route codes first.
    queryKey: ["admin", "subscriptions", { term, statusFilter, page, routeCodes }],
    queryFn: async () => {
      let query = supabase
        .from("subscriptions")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (statusFilter !== "all") query = query.eq("subscription_status", statusFilter);
      if (term) {
        const byName = routeCodes.length > 0 ? `,route.in.(${routeCodes.join(",")})` : "";
        query = query.or(`email.ilike.%${term}%,route.ilike.%${term}%${byName}`);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data as Subscription[], total: count ?? 0 };
    },
    placeholderData: keepPreviousData,
    enabled: routesQuery.isSuccess,
  });

  const routesByPlan = useMemo(() => {
    const map = new Map<string, Route_>();
    for (const r of routesQuery.data ?? []) map.set(r.plan_name, r);
    return map;
  }, [routesQuery.data]);

  const rows = subscriptionsQuery.data?.rows ?? [];
  const total = subscriptionsQuery.data?.total ?? 0;

  // A page past the end (e.g. rows disappeared since the last load): go to the last one.
  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (subscriptionsQuery.isSuccess && page > pageCount) setPage(pageCount);
  }, [subscriptionsQuery.isSuccess, total, page]);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">所有訂閱 Subscriptions</h2>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋 email 或航線"
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

      {subscriptionsQuery.isError || routesQuery.isError ? (
        <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          資料載入失敗，請重新整理。 / Couldn't load admin data — please refresh.
        </p>
      ) : subscriptionsQuery.isLoading || routesQuery.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div
            className={`mt-4 overflow-x-auto rounded-2xl border border-border transition-opacity ${subscriptionsQuery.isPlaceholderData ? "opacity-60" : ""}`}
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Route</th>
                  <th className="px-4 py-2">Target price</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Period end</th>
                  <th className="px-4 py-2">Payment failed</th>
                  <th className="px-4 py-2">Renewals</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <SubscriptionRow
                    key={s.id}
                    subscription={s}
                    route={routesByPlan.get(s.plan_name)}
                    canForceExpire={canForceExpire}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                      No matching subscriptions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            total={total}
            onChange={setPage}
            disabled={subscriptionsQuery.isFetching}
          />
        </>
      )}
    </section>
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
  canForceExpire,
}: {
  subscription: Subscription;
  route: Route_ | undefined;
  canForceExpire: boolean;
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
          ? "已發送（標記為 admin 手動觸發，見「通知紀錄」頁）Sent — marked as admin-triggered, see the Notification history page"
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
      <td className="px-4 py-2">{route?.display_name ?? s.route}</td>
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
      <td className="px-4 py-2 text-muted-foreground">
        {s.payment_method === "free" ? "免費 Free" : "綠界 ECPay"}
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
        {canForceExpire && s.subscription_status === "cancelled" && (
          <ForceExpireButton subscriptionId={s.id} />
        )}
      </td>
    </tr>
  );
}

// Testing aid, shown only while the force_expire_enabled switch is on (and
// flight-admin-expire re-checks the switch). cancelled -> expired right away.
function ForceExpireButton({ subscriptionId }: { subscriptionId: string }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await callFunction("flight-admin-expire", { subscription_id: subscriptionId });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "force expire failed");
      return data;
    },
    onSuccess: () => {
      setConfirming(false);
      // The row turns expired on refetch, which also removes this button.
      queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "subscription-stats"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "強制到期失敗 Force expire failed"),
  });

  return (
    <div className="mt-1">
      {confirming ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">確定立即到期？</span>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-md border border-destructive px-2 py-1 font-semibold text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
          >
            {mutation.isPending ? "處理中…" : "確定"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={mutation.isPending}
            className="rounded-md border border-border px-2 py-1 text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            取消
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="rounded-md border border-destructive/60 px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          強制到期
        </button>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

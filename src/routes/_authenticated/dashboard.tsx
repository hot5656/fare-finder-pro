import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/dashboard")({
  // ECPay's browser redirect lands here as /dashboard?purchase=success|failed
  validateSearch: (
    search: Record<string, unknown>,
  ): { purchase?: "success" | "failed" | undefined } => {
    const purchase = search["purchase"];
    return { purchase: purchase === "success" || purchase === "failed" ? purchase : undefined };
  },
  component: DashboardPage,
});

// Subscribe / cancel go through Edge Functions (M2): the browser can no longer
// write flight.subscriptions itself.
async function callFunction(slug: string, body: unknown): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return fetch(`${import.meta.env['VITE_SUPABASE_URL']}/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      apikey: import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'],
    },
    body: JSON.stringify(body),
  });
}

type Route_ = Tables<"routes">;
type Subscription = Tables<"subscriptions">;

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { purchase } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const routesQuery = useQuery({
    queryKey: ["flight", "routes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("routes").select("*");
      if (error) throw error;
      return data as Route_[];
    },
  });

  const subscriptionsQuery = useQuery({
    queryKey: ["flight", "subscriptions", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id);
      if (error) throw error;
      return data as Subscription[];
    },
    // Right after paying, the ECPay callback may land a few seconds after the
    // browser does: keep refreshing until nothing is pending_payment.
    refetchInterval: (query) =>
      purchase === "success" &&
      query.state.data?.some((s) => s.subscription_status === "pending_payment")
        ? 3000
        : false,
  });

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }

  function invalidateSubscriptions() {
    queryClient.invalidateQueries({ queryKey: ["flight", "subscriptions", user.id] });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              ✈️
            </span>
            <span className="text-sm font-bold tracking-tight sm:text-base">
              Flight Price Notifier
            </span>
          </Link>
          <button
            onClick={handleSignOut}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign out / 登出
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as <span className="text-foreground">{user.email}</span>
        </p>

        {purchase === "success" && (
          <p className="mt-6 rounded-lg bg-primary/10 px-4 py-3 text-sm text-primary">
            付款完成，訂閱正在生效中… / Payment received — activating your subscription.
          </p>
        )}
        {purchase === "failed" && (
          <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            付款未完成，你可以在下方點「完成付款」重試。 / Payment didn't go through — use “完成付款” to retry.
          </p>
        )}

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {routesQuery.data?.map((route) => (
            <PlanCard
              key={route.plan_name}
              route={route}
              subscription={subscriptionsQuery.data?.find((s) => s.plan_name === route.plan_name)}
              onSubscribed={invalidateSubscriptions}
            />
          ))}
        </div>

        {routesQuery.isError && (
          <p className="mt-6 text-sm text-destructive">
            Couldn't load plans. Please refresh and try again.
          </p>
        )}
      </main>
    </div>
  );
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("zh-TW") : "";

function PlanCard({
  route,
  subscription,
  onSubscribed,
}: {
  route: Route_;
  subscription: Subscription | undefined;
  onSubscribed: () => void;
}) {
  const [targetPrice, setTargetPrice] = useState(
    subscription ? String(subscription.target_price) : "",
  );
  // The subscription can arrive after first render (fresh load, post-payment
  // redirect); pick up its saved target when it does.
  useEffect(() => {
    if (subscription) setTargetPrice(String(subscription.target_price));
  }, [subscription?.target_price]);
  const [saving, setSaving] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = subscription?.subscription_status;

  async function handleSubscribe() {
    const parsed = Number(targetPrice);
    if (!targetPrice || Number.isNaN(parsed) || parsed <= 0) {
      setError("請輸入有效的目標價 / Enter a valid target price");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await callFunction("flight-subscribe", {
        plan_name: route.plan_name,
        target_price: parsed,
      });
      // text/html -> a checkout form: hand the whole page to ECPay's cashier.
      // application/json -> an in-place update (already paid): just refresh.
      if ((res.headers.get("content-type") ?? "").includes("text/html")) {
        const html = await res.text();
        document.open();
        document.write(html);
        document.close();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "subscribe failed");
      onSubscribed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "訂閱失敗，請再試一次 / Subscribe failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    setError(null);
    setSaving(true);
    setCancelling(true);
    try {
      const res = await callFunction("flight-cancel-subscription", { plan_name: route.plan_name });
      const data = await res.json();
      // Show ECPay's own reason when the function gives one, not just a generic line.
      if (!res.ok) throw new Error(data.detail ? `${data.error}（${data.detail}）` : (data.error ?? "cancel failed"));
      setConfirmingCancel(false);
      onSubscribed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失敗，請再試一次 / Cancel failed");
    } finally {
      setSaving(false);
      setCancelling(false);
    }
  }

  const badge =
    status === "active"
      ? "已訂閱（有效）"
      : status === "pending_payment"
        ? "未完成付款"
        : status === "cancelled"
          ? `已取消 · 有效至 ${fmtDate(subscription!.current_period_end)}`
          : status === "expired"
            ? "已結束"
            : null;
  const actionLabel =
    status === "pending_payment"
      ? "完成付款"
      : status === "expired"
        ? "重新訂閱"
        : status === "active" || status === "cancelled"
          ? "更新目標價"
          : "開始追蹤";

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-bold text-card-foreground">{route.display_name}</h2>
        {badge && (
          <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            {badge}
          </span>
        )}
      </div>

      {/* The three cards share this label text, so the id carries the plan to stay unique. */}
      <label
        htmlFor={`target-price-${route.plan_name}`}
        className="mt-4 block text-sm font-medium text-muted-foreground"
      >
        目標價 TWD / Target price
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id={`target-price-${route.plan_name}`}
          name="target_price"
          type="number"
          min={1}
          value={targetPrice}
          onChange={(e) => setTargetPrice(e.target.value)}
          placeholder="10000"
          className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          onClick={handleSubscribe}
          disabled={saving}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "..." : actionLabel}
        </button>
      </div>

      {subscription && (
        <p className="mt-2 text-xs text-muted-foreground">
          目前目標：NT${Number(subscription.target_price).toLocaleString()}
        </p>
      )}
      {status === "active" && (
        <div className="mt-2">
          {confirmingCancel ? (
            <div className="text-xs text-muted-foreground">
              <p>確定要取消訂閱？已付款的期間內仍會收到通知。</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  aria-busy={cancelling}
                  className="rounded-md border border-destructive px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cancelling ? "取消中…" : "確定取消"}
                </button>
                <button
                  onClick={() => setConfirmingCancel(false)}
                  disabled={saving}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  保留
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingCancel(true)}
              className="text-xs text-muted-foreground underline transition-colors hover:text-foreground"
            >
              取消訂閱
            </button>
          )}
        </div>
      )}
      {route.last_price != null && (
        <p className="mt-2 text-xs text-muted-foreground">
          最後查詢：{route.last_price_currency === "TWD" ? "NT$" : `${route.last_price_currency} `}
          {Number(route.last_price).toLocaleString()}
          {route.last_checked_at && (
            <> ‧ {new Date(route.last_checked_at).toLocaleString("zh-TW")}</>
          )}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

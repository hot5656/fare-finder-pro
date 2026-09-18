import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Route_ = Tables<"routes">;
type Subscription = Tables<"subscriptions">;

function DashboardPage() {
  const { user } = Route.useRouteContext();
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

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {routesQuery.data?.map((route) => (
            <PlanCard
              key={route.plan_name}
              route={route}
              userId={user.id}
              email={user.email ?? ""}
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

function PlanCard({
  route,
  userId,
  email,
  subscription,
  onSubscribed,
}: {
  route: Route_;
  userId: string;
  email: string;
  subscription: Subscription | undefined;
  onSubscribed: () => void;
}) {
  const [targetPrice, setTargetPrice] = useState(
    subscription ? String(subscription.target_price) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe() {
    const parsed = Number(targetPrice);
    if (!targetPrice || Number.isNaN(parsed) || parsed <= 0) {
      setError("請輸入有效的目標價 / Enter a valid target price");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { error: upsertError } = await supabase.from("subscriptions").upsert(
        {
          user_id: userId,
          email,
          plan_name: route.plan_name,
          route: route.route ?? `${route.origin}-${route.destination}`,
          target_price: parsed,
          currency: "TWD",
        },
        { onConflict: "user_id,route" },
      );
      if (upsertError) throw upsertError;
      onSubscribed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "訂閱失敗，請再試一次 / Subscribe failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-bold text-card-foreground">{route.display_name}</h2>
        {subscription && (
          <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            已訂閱
          </span>
        )}
      </div>

      <label className="mt-4 block text-sm font-medium text-muted-foreground">
        目標價 TWD / Target price
      </label>
      <div className="mt-2 flex gap-2">
        <input
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
          {saving ? "..." : subscription ? "更新目標價" : "開始追蹤"}
        </button>
      </div>

      {subscription && (
        <p className="mt-2 text-xs text-muted-foreground">
          目前目標：NT${Number(subscription.target_price).toLocaleString()}
        </p>
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

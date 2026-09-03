import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
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

        <div className="mt-10 rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <div className="text-4xl" aria-hidden>
            🛫
          </div>
          <h2 className="mt-4 text-lg font-semibold text-card-foreground">
            你的票價追蹤即將上線
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Route subscriptions and target-price alerts are coming in the next
            milestone. Stay tuned — your fare alerts will live here.
          </p>
        </div>
      </main>
    </div>
  );
}

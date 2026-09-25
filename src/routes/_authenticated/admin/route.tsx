import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// This check is a UX shortcut only (fast redirect for non-admins), same category
// as hasAppAccess() in app-scope.ts -- the real authorization boundary is RLS,
// enforced by flight.is_admin() inside the subscriptions/notification_history
// policies. Even if this beforeLoad were skipped, the child route's queries would
// still return only what RLS allows for the signed-in user.
export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async ({ cause }) => {
    // Switching between admin tabs: the check already passed on entry.
    if (cause === "stay") return;
    const { data, error } = await supabase.rpc("is_admin");
    if (error || !data) throw redirect({ to: "/dashboard" });
  },
  component: AdminLayout,
});

const TABS = [
  { to: "/admin", label: "總覽 Overview", exact: true },
  { to: "/admin/routes", label: "航線 Routes", exact: false },
  { to: "/admin/users", label: "註冊用戶 Users", exact: false },
  { to: "/admin/subscriptions", label: "所有訂閱 Subscriptions", exact: false },
  { to: "/admin/notifications", label: "通知紀錄 Notification history", exact: false },
  { to: "/admin/runs", label: "查價紀錄 Price checks", exact: false },
] as const;

function AdminLayout() {
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

        <nav className="mt-6 flex flex-wrap gap-1 border-b border-border">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: tab.exact }}
              className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "border-primary! text-foreground!" }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <Outlet />
      </main>
    </div>
  );
}

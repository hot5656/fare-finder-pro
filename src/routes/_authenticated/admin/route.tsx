import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// This check is a UX shortcut only (fast redirect for non-admins), same category
// as hasAppAccess() in app-scope.ts -- the real authorization boundary is RLS,
// enforced by flight.is_admin() inside the subscriptions/notification_history
// policies. Even if this beforeLoad were skipped, the child route's queries would
// still return only what RLS allows for the signed-in user.
export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.rpc("is_admin");
    if (error || !data) throw redirect({ to: "/dashboard" });
  },
  component: () => <Outlet />,
});

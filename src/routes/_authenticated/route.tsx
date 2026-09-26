import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { hasAppAccess } from "@/integrations/supabase/app-scope";

// The user that last passed the full check below. `cause` is also "stay" on the
// first client load after SSR (a direct visit or a reload), so "stay" alone does
// not prove the check already ran in this tab.
let verifiedUserId: string | null = null;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ cause }) => {
    // Already inside the guard (e.g. dashboard -> admin, or between admin tabs):
    // the server check ran on entry, so reuse the local session instead of
    // another round trip to the auth server on every navigation.
    if (cause === "stay" && verifiedUserId) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id === verifiedUserId) return { user: data.session.user };
    }
    verifiedUserId = null;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    if (!hasAppAccess(data.user.app_metadata)) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    verifiedUserId = data.user.id;
    return { user: data.user };
  },
  component: () => <Outlet />,
});

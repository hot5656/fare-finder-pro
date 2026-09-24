import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { hasAppAccess } from "@/integrations/supabase/app-scope";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ cause }) => {
    // Already inside the guard (e.g. dashboard -> admin, or between admin tabs):
    // the server check ran on entry, so reuse the local session instead of
    // another round trip to the auth server on every navigation.
    if (cause === "stay") {
      const { data } = await supabase.auth.getSession();
      if (data.session) return { user: data.session.user };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    if (!hasAppAccess(data.user.app_metadata)) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});

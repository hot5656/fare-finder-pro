import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  PAGE_SIZE,
  fmtDateTime,
  type Notification,
  useAdminRoutes,
} from "@/components/admin/shared";
import { Pager } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/notifications")({
  component: AdminNotificationsPage,
});

function AdminNotificationsPage() {
  const [page, setPage] = useState(1);
  const routesQuery = useAdminRoutes();

  // notification_history stores the route code (TPE-TYO); show the Chinese name.
  const routeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of routesQuery.data ?? []) if (r.route) map.set(r.route, r.display_name);
    return map;
  }, [routesQuery.data]);

  // Paged in the database: this table grows with every alert sent.
  const notificationsQuery = useQuery({
    queryKey: ["admin", "notifications", { page }],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("notification_history")
        .select("*", { count: "exact" })
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data as Notification[];

      // notification_history has user_id but no email column and no FK PostgREST
      // can auto-embed, so resolve this page's emails from their subscriptions.
      // TODO: a user_id with notification history but no surviving subscription
      // row won't resolve and falls back to the raw UUID below. If it becomes
      // common, replace with an admin-only view joining auth.users directly.
      const emailByUserId = new Map<string, string>();
      const userIds = [...new Set(rows.map((n) => n.user_id))];
      if (userIds.length > 0) {
        const { data: subs, error: subsError } = await supabase
          .from("subscriptions")
          .select("user_id, email")
          .in("user_id", userIds);
        if (subsError) throw subsError;
        for (const s of subs) emailByUserId.set(s.user_id, s.email);
      }

      return { rows, total: count ?? 0, emailByUserId };
    },
    placeholderData: keepPreviousData,
  });

  const rows = notificationsQuery.data?.rows ?? [];
  const total = notificationsQuery.data?.total ?? 0;
  const emailByUserId = notificationsQuery.data?.emailByUserId;

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (notificationsQuery.isSuccess && page > pageCount) setPage(pageCount);
  }, [notificationsQuery.isSuccess, total, page]);

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">通知紀錄 Notification history</h2>

      {notificationsQuery.isError ? (
        <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          資料載入失敗，請重新整理。 / Couldn't load admin data — please refresh.
        </p>
      ) : notificationsQuery.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div
            className={`mt-4 overflow-x-auto rounded-2xl border border-border transition-opacity ${notificationsQuery.isPlaceholderData ? "opacity-60" : ""}`}
          >
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
                {rows.map((n) => (
                  <tr key={n.id} className="border-t border-border/60">
                    <td className="px-4 py-2">{emailByUserId?.get(n.user_id) ?? n.user_id}</td>
                    <td className="px-4 py-2">{routeNames.get(n.route) ?? n.route}</td>
                    <td className="px-4 py-2">
                      {n.currency} {Number(n.price).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(n.sent_at)}</td>
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
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      No notifications sent yet.
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
            disabled={notificationsQuery.isFetching}
          />
        </>
      )}
    </section>
  );
}

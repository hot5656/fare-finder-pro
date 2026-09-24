import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PAGE_SIZE, fmtDateTime } from "@/components/admin/shared";
import { Pager } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

// Accounts tagged for this app in the shared auth.users. The browser cannot read
// auth.users, so this goes through flight.admin_list_app_users(), which checks
// flight.is_admin() and pages/searches in the database.
function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [term]);

  const usersQuery = useQuery({
    queryKey: ["admin", "users", { term, page }],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_app_users", {
        p_search: term,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return { rows: data, total: data[0]?.total_count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });

  const rows = usersQuery.data?.rows ?? [];
  const total = usersQuery.data?.total ?? 0;

  // An empty page past the end reports total 0, which lands back on page 1.
  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (usersQuery.isSuccess && page > pageCount) setPage(pageCount);
  }, [usersQuery.isSuccess, total, page]);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">註冊用戶 Users</h2>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋 email"
          className="h-9 w-56 rounded-lg border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {usersQuery.isError ? (
        <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          資料載入失敗，請重新整理。 / Couldn't load admin data — please refresh.
        </p>
      ) : usersQuery.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div
            className={`mt-4 overflow-x-auto rounded-2xl border border-border transition-opacity ${usersQuery.isPlaceholderData ? "opacity-60" : ""}`}
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Registered</th>
                  <th className="px-4 py-2">Email confirmed</th>
                  <th className="px-4 py-2">Last sign-in</th>
                  <th className="px-4 py-2">Subscriptions</th>
                  <th className="px-4 py-2">Paying</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-t border-border/60">
                    <td className="px-4 py-2">
                      {u.email}
                      {u.is_admin && (
                        <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(u.created_at)}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {u.email_confirmed_at ? fmtDateTime(u.email_confirmed_at) : "未驗證 No"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {fmtDateTime(u.last_sign_in_at) || "—"}
                    </td>
                    <td className="px-4 py-2">{u.subscription_count}</td>
                    <td className="px-4 py-2">{u.paying_count}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No matching users.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} onChange={setPage} disabled={usersQuery.isFetching} />
        </>
      )}
    </section>
  );
}

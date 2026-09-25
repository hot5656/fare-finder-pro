import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ISSUE_LABELS,
  PAGE_SIZE,
  type ParserIssue,
  type ParserRun,
  fmtDateTime,
  parserRunsQueryKey,
  useAdminRoutes,
} from "@/components/admin/shared";
import { Pager, ParserHealthBanner } from "@/components/admin/AdminUI";

export const Route = createFileRoute("/_authenticated/admin/runs")({
  component: AdminRunsPage,
});

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  error: "bg-destructive/15 text-destructive",
  running: "bg-muted text-muted-foreground",
};

// One row per flight-parser run (flight.parser_runs), newest first. The parser
// keeps 90 days; "只看異常" hides the ok runs.
function AdminRunsPage() {
  const [page, setPage] = useState(1);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const routesQuery = useAdminRoutes();

  const routeNames = new Map<string, string>();
  for (const r of routesQuery.data ?? []) if (r.route) routeNames.set(r.route, r.display_name);

  const runsQuery = useQuery({
    queryKey: [...parserRunsQueryKey, { page, problemsOnly }],
    queryFn: async () => {
      let q = supabase
        .from("parser_runs")
        .select("*", { count: "exact" })
        .order("started_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (problemsOnly) q = q.neq("status", "ok");
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data as ParserRun[], total: count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });

  const rows = runsQuery.data?.rows ?? [];
  const total = runsQuery.data?.total ?? 0;

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (runsQuery.isSuccess && page > pageCount) setPage(pageCount);
  }, [runsQuery.isSuccess, total, page]);

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">查價紀錄 Price checks</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        每 30 分鐘一次的自動查價（flight-parser），保留 90 天。429 = 被 Travelpayouts 限流；查無票價
        = 該航線這一輪不會發通知。
      </p>

      <ParserHealthBanner />

      <label className="mt-4 flex w-fit items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={problemsOnly}
          onChange={(e) => {
            setProblemsOnly(e.target.checked);
            setPage(1);
          }}
        />
        只看異常 Problems only
      </label>

      {runsQuery.isError ? (
        <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          資料載入失敗，請重新整理。 / Couldn't load admin data — please refresh.
        </p>
      ) : runsQuery.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div
            className={`mt-4 overflow-x-auto rounded-2xl border border-border transition-opacity ${runsQuery.isPlaceholderData ? "opacity-60" : ""}`}
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Started</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2">Routes</th>
                  <th className="px-4 py-2">API calls</th>
                  <th className="px-4 py-2">Matches</th>
                  <th className="px-4 py-2">Issues</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => {
                  const issues = (run.issues ?? []) as ParserIssue[];
                  return (
                    <tr key={run.id} className="border-t border-border/60 align-top">
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {fmtDateTime(run.started_at)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[run.status] ?? ""}`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)} s` : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {run.routes_checked ?? "—"} / {run.routes_total ?? "—"}
                      </td>
                      <td className="px-4 py-2">{run.api_calls ?? "—"}</td>
                      <td className="px-4 py-2">{run.matches ?? "—"}</td>
                      <td className="px-4 py-2">
                        {issues.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="space-y-1 text-xs">
                            {issues.map((i, n) => (
                              <li key={n}>
                                <span className="font-semibold">
                                  {ISSUE_LABELS[i.kind] ?? i.kind}
                                </span>{" "}
                                {i.route && <>{routeNames.get(i.route) ?? i.route} </>}
                                {i.source && (
                                  <span className="text-muted-foreground">
                                    {i.source} {i.currency}
                                  </span>
                                )}
                                <div className="text-muted-foreground">{i.message}</div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      {problemsOnly ? "沒有異常紀錄。" : "No runs recorded yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} onChange={setPage} disabled={runsQuery.isFetching} />
        </>
      )}
    </section>
  );
}

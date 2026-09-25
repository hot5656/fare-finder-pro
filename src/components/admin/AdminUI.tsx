import { Link } from "@tanstack/react-router";
import { PAGE_SIZE, fmtDateTime, parserHealth, useLatestParserRuns } from "./shared";

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "destructive" | undefined;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${tone === "destructive" ? "text-destructive" : "text-card-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

// Page numbers to show around the current page, with null for a gap ("…").
function pageWindow(page: number, pageCount: number): (number | null)[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (typeof prev === "number" && p - prev > 1) out.push(null);
    out.push(p);
  }
  return out;
}

const pagerButton =
  "h-8 min-w-8 rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-40";

export function Pager({
  page,
  total,
  onChange,
  disabled,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        第 {from}–{to} 筆，共 {total} 筆（每頁 {PAGE_SIZE} 筆）
      </span>
      {pageCount > 1 && (
        <nav aria-label="pagination" className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => onChange(page - 1)}
            disabled={disabled || page <= 1}
            className={`${pagerButton} border-border text-foreground hover:bg-accent`}
          >
            上一頁
          </button>
          {pageWindow(page, pageCount).map((p, i) =>
            p == null ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onChange(p)}
                disabled={disabled}
                aria-current={p === page ? "page" : undefined}
                className={
                  p === page
                    ? `${pagerButton} border-primary bg-primary text-primary-foreground`
                    : `${pagerButton} border-border text-foreground hover:bg-accent`
                }
              >
                {p}
              </button>
            ),
          )}
          <button
            onClick={() => onChange(page + 1)}
            disabled={disabled || page >= pageCount}
            className={`${pagerButton} border-border text-foreground hover:bg-accent`}
          >
            下一頁
          </button>
        </nav>
      )}
    </div>
  );
}

const HEALTH_STYLES = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted/40 text-muted-foreground",
} as const;

// State of the 30-min price check (flight.parser_runs), with a link to the
// run log unless we're already on it.
export function ParserHealthBanner({ linkToRuns = false }: { linkToRuns?: boolean }) {
  const runsQuery = useLatestParserRuns();
  if (runsQuery.isLoading) return null;
  if (runsQuery.isError) {
    return (
      <p className={`mt-4 rounded-lg border px-4 py-3 text-sm ${HEALTH_STYLES.error}`}>
        讀取查價紀錄失敗 Couldn't load price-check runs
      </p>
    );
  }
  const health = parserHealth(runsQuery.data ?? []);
  return (
    <div
      className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm ${HEALTH_STYLES[health.level]}`}
    >
      <span>
        <span className="font-semibold">查價狀態：</span>
        {health.message}
        {health.run && (
          <span className="ml-2 text-xs opacity-80">({fmtDateTime(health.run.started_at)})</span>
        )}
      </span>
      {linkToRuns && (
        <Link to="/admin/runs" className="text-xs font-medium underline underline-offset-2">
          查看查價紀錄 →
        </Link>
      )}
    </div>
  );
}

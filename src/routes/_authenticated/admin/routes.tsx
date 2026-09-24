import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { callFunction } from "@/integrations/supabase/call-function";
import { Switch } from "@/components/ui/switch";
import { type Route_, fmtDateTime, useAdminRoutes } from "@/components/admin/shared";

export const Route = createFileRoute("/_authenticated/admin/routes")({
  component: AdminRoutesPage,
});

const INVALID = "條件不正確，請重新輸入";

type Place = { code: string; name: string; country: string; type: "city" | "airport" };
type Offer = {
  price: number;
  currency: string;
  airline: string;
  depart_date: string;
  return_date: string;
  transfers?: number | null;
};
type Preview = {
  origin?: Place;
  destination?: Place;
  origin_candidates?: Place[];
  destination_candidates?: Place[];
  month?: string;
  offer?: Offer;
  error?: string;
};

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const primaryButton =
  "shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50";
const outlineButton =
  "shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50";

const fmtTwd = (n: number | null | undefined) =>
  n == null ? "—" : `NT$${Math.round(Number(n)).toLocaleString()}`;
const fmtDay = (iso: string) => (iso ? iso.slice(0, 10) : "");
const placeLabel = (p: Place) =>
  `${p.code} ${p.name}${p.country ? `（${p.country}）` : ""}${p.type === "airport" ? " · 機場" : ""}`;

async function postRoutes(body: unknown) {
  const res = await callFunction("flight-admin-routes", body);
  const data = await res.json();
  return { ok: res.ok, data };
}

// Routes are written only through flight-admin-routes (service role, admin
// check inside); reads go through RLS like the rest of /admin.
function AdminRoutesPage() {
  const routesQuery = useAdminRoutes();
  const routes = [...(routesQuery.data ?? [])].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );

  return (
    <>
      <AddRouteForm />

      <section className="mt-10">
        <h2 className="text-lg font-bold">所有航線 Routes</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          停用：不再開放新訂閱，dashboard
          只對仍持有訂閱的使用者顯示；付費中的訂閱照常收到通知直到到期。
          機場代碼建立後不可修改，代碼錯誤請停用後重新新增。
        </p>
        {routesQuery.isError ? (
          <p className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            航線載入失敗，請重新整理。 / Couldn't load routes — please refresh.
          </p>
        ) : routesQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">航線 Route</th>
                  <th className="px-4 py-2">代碼 Code</th>
                  <th className="px-4 py-2">最新價格 Last price</th>
                  <th className="px-4 py-2">檢查時間 Checked</th>
                  <th className="px-4 py-2">啟用 Active</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <RouteRow key={r.plan_name} route={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function AddRouteForm() {
  const queryClient = useQueryClient();
  const [originInput, setOriginInput] = useState("台北");
  const [destinationInput, setDestinationInput] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [originName, setOriginName] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);

  // Any edit to the query invalidates the last check: a route is only saved
  // right after a successful live search for exactly what is shown.
  function resetPreview() {
    setPreview(null);
    setError(null);
  }

  async function runPreview(originCode?: string, destinationCode?: string) {
    if (!originInput.trim() || !destinationInput.trim()) {
      setError("請輸入出發地與目的地");
      return;
    }
    setBusy("preview");
    setError(null);
    setCreated(null);
    try {
      const { ok, data } = await postRoutes({
        action: "preview",
        origin: originInput,
        destination: destinationInput,
        origin_code: originCode,
        destination_code: destinationCode,
      });
      const p = data as Preview;
      // Keep the matched places even on a failed check, so the admin can pick
      // another candidate (e.g. a specific airport) and search again.
      setPreview(p.origin && p.destination ? p : null);
      if (p.origin) setOriginName(p.origin.name);
      if (p.destination) setDestinationName(p.destination.name);
      setError(ok && p.offer ? null : (p.error ?? INVALID));
    } catch {
      setPreview(null);
      setError("查詢失敗，請再試一次 / Search failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    if (!preview?.origin || !preview.destination || !preview.offer) return;
    setBusy("create");
    setError(null);
    try {
      const { ok, data } = await postRoutes({
        action: "create",
        origin_code: preview.origin.code,
        destination_code: preview.destination.code,
        origin_name: originName,
        destination_name: destinationName,
      });
      if (!ok) {
        setError(data.error ?? INVALID);
        return;
      }
      const row = data as Route_;
      setCreated(`已新增 ${row.display_name}，目前最低 ${fmtTwd(row.last_price)}`);
      setDestinationInput("");
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "routes"] });
      queryClient.invalidateQueries({ queryKey: ["flight", "routes"] });
    } catch {
      setError("新增失敗，請再試一次 / Save failed");
    } finally {
      setBusy(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!busy) runPreview();
  }

  const ready = !!(preview?.origin && preview.destination && preview.offer && !error);

  return (
    <section className="mt-8 rounded-2xl border border-border p-4 sm:p-6">
      <h2 className="text-lg font-bold">新增航線 Add route</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        輸入中文城市名（例如「台北」「大阪」）或三碼機場／城市代碼（例如 OSA）。
        系統會即時查詢下個月的來回最低票價，查得到價格才可新增。
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <label className="text-sm">
          <span className="text-muted-foreground">出發地 From</span>
          <input
            value={originInput}
            onChange={(e) => {
              setOriginInput(e.target.value);
              resetPreview();
            }}
            placeholder="台北"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">目的地 To</span>
          <input
            value={destinationInput}
            onChange={(e) => {
              setDestinationInput(e.target.value);
              resetPreview();
            }}
            placeholder="大阪"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <button type="submit" disabled={!!busy} className={primaryButton}>
          {busy === "preview" ? "查詢中…" : "查詢價格"}
        </button>
      </form>

      {preview?.origin && preview.destination && (
        <div className="mt-4 rounded-xl bg-muted/40 p-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <CandidatePicker
              label="出發地"
              value={preview.origin}
              candidates={preview.origin_candidates ?? []}
              disabled={!!busy}
              onPick={(code) => runPreview(code, preview.destination!.code)}
            />
            <CandidatePicker
              label="目的地"
              value={preview.destination}
              candidates={preview.destination_candidates ?? []}
              disabled={!!busy}
              onPick={(code) => runPreview(preview.origin!.code, code)}
            />
          </div>

          {preview.offer && (
            <>
              <p className="mt-3">
                {preview.month} 來回最低：
                <span className="font-semibold">{fmtTwd(preview.offer.price)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {preview.offer.airline} · {fmtDay(preview.offer.depart_date)} 去 /{" "}
                  {fmtDay(preview.offer.return_date)} 回
                </span>
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="text-xs">
                  <span className="text-muted-foreground">出發地顯示名稱</span>
                  <input
                    value={originName}
                    onChange={(e) => setOriginName(e.target.value)}
                    maxLength={20}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className="text-xs">
                  <span className="text-muted-foreground">目的地顯示名稱</span>
                  <input
                    value={destinationName}
                    onChange={(e) => setDestinationName(e.target.value)}
                    maxLength={20}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <button
                  onClick={handleCreate}
                  disabled={!ready || !!busy || !originName.trim() || !destinationName.trim()}
                  className={primaryButton}
                >
                  {busy === "create" ? "新增中…" : "確認新增"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                將顯示為「{originName.trim()} ✈ {destinationName.trim()}」
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {created && (
        <p className="mt-3 rounded-lg bg-primary/10 px-4 py-2 text-sm text-primary">{created}</p>
      )}
    </section>
  );
}

function CandidatePicker({
  label,
  value,
  candidates,
  disabled,
  onPick,
}: {
  label: string;
  value: Place;
  candidates: Place[];
  disabled: boolean;
  onPick: (code: string) => void;
}) {
  return (
    <label className="text-xs">
      <span className="text-muted-foreground">{label}辨識結果</span>
      {candidates.length > 1 ? (
        <select
          value={value.code}
          disabled={disabled}
          onChange={(e) => onPick(e.target.value)}
          className={`mt-1 ${inputClass}`}
        >
          {candidates.map((c) => (
            <option key={c.code} value={c.code}>
              {placeLabel(c)}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-1 text-sm font-medium">{placeLabel(value)}</p>
      )}
    </label>
  );
}

function RouteRow({ route }: { route: Route_ }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [originName, setOriginName] = useState(route.origin_name);
  const [destinationName, setDestinationName] = useState(route.destination_name);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (patch: {
      is_active?: boolean;
      origin_name?: string;
      destination_name?: string;
    }) => {
      const { ok, data } = await postRoutes({
        action: "update",
        plan_name: route.plan_name,
        ...patch,
      });
      if (!ok) throw new Error(data.error ?? "update failed");
      return data as Route_;
    },
    onMutate: () => setError(null),
    onSuccess: (row) => {
      queryClient.setQueryData<Route_[]>(["admin", "routes"], (old) =>
        old?.map((r) => (r.plan_name === row.plan_name ? row : r)),
      );
      queryClient.invalidateQueries({ queryKey: ["flight", "routes"] });
      setEditing(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "儲存失敗 Save failed"),
  });

  return (
    <tr
      className={`border-t border-border/60 align-top ${route.is_active ? "" : "text-muted-foreground"}`}
    >
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={originName}
              onChange={(e) => setOriginName(e.target.value)}
              maxLength={20}
              aria-label="出發地顯示名稱"
              className={`${inputClass} w-24`}
            />
            <span>✈</span>
            <input
              value={destinationName}
              onChange={(e) => setDestinationName(e.target.value)}
              maxLength={20}
              aria-label="目的地顯示名稱"
              className={`${inputClass} w-24`}
            />
            <button
              onClick={() =>
                mutation.mutate({ origin_name: originName, destination_name: destinationName })
              }
              disabled={mutation.isPending || !originName.trim() || !destinationName.trim()}
              className={outlineButton}
            >
              {mutation.isPending ? "儲存中…" : "儲存"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setOriginName(route.origin_name);
                setDestinationName(route.destination_name);
              }}
              disabled={mutation.isPending}
              className={outlineButton}
            >
              取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{route.display_name}</span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              編輯名稱
            </button>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </td>
      <td className="px-4 py-2 font-mono text-xs">{route.route}</td>
      <td className="px-4 py-2">
        {route.last_price != null ? fmtTwd(route.last_price) : "尚無價格"}
      </td>
      <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(route.last_checked_at)}</td>
      <td className="px-4 py-2">
        <Switch
          checked={route.is_active}
          aria-label={`${route.display_name} 啟用`}
          onCheckedChange={(checked) => {
            if (!mutation.isPending) mutation.mutate({ is_active: checked });
          }}
        />
      </td>
    </tr>
  );
}

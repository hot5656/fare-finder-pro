// Travelpayouts helpers shared by flight-parser (the 30-min price check) and
// flight-admin-routes (the admin's live check before a route is saved), so a
// route is only ever added when the exact query the parser runs finds a fare.
//
// Needs TRAVELPAYOUTS_TOKEN (supabase secrets set). The places autocomplete
// used by resolvePlace() needs no token.

const TRAVELPAYOUTS_TOKEN = Deno.env.get("TRAVELPAYOUTS_TOKEN") as string;

export const UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"; // some hosts behind Cloudflare 403 the default UA

// One offer from either Travelpayouts endpoint, normalized. v3 fills every
// field; v1 has no airports, transfers or link (those stay undefined).
export type Cheapest = {
  source: "v3" | "v1";
  price: number;
  currency: string;
  airline: string;
  flight_number?: string;
  depart_date: string; // departure_at, with the origin's UTC offset
  return_date: string; // return_at, with the destination's UTC offset
  origin_airport?: string;
  destination_airport?: string;
  transfers?: number | null;
  return_transfers?: number | null;
  duration?: number | null; // minutes, both legs
  duration_to?: number | null; // minutes, outbound incl. layovers
  duration_back?: number | null;
  link?: string; // Aviasales path, e.g. "/search/TPE2910TYO02111?t=..."
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

// v3 prices_for_dates: the alert trigger. one_way=false so it prices a round
// trip like v1 does (v3 defaults to one-way).
export async function fetchCheapestV3(
  origin: string,
  destination: string,
  month: string,
  currency: string,
): Promise<Cheapest | null> {
  const q = new URLSearchParams({
    origin,
    destination,
    departure_at: month,
    one_way: "false",
    sorting: "price",
    limit: "5",
    currency,
    token: TRAVELPAYOUTS_TOKEN,
  });
  const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${q}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`travelpayouts v3 ${currency} ${origin}-${destination}: HTTP ${res.status}`);
    return null;
  }
  const body = await res.json();
  if (!body.success || !Array.isArray(body.data) || !body.data.length) return null;
  const best = (body.data as any[]).reduce((a, b) => (a.price < b.price ? a : b));
  return {
    source: "v3",
    price: best.price,
    currency: currency.toUpperCase(),
    airline: best.airline ?? "",
    flight_number: best.flight_number != null ? String(best.flight_number) : undefined,
    depart_date: best.departure_at ?? "",
    return_date: best.return_at ?? "",
    origin_airport: best.origin_airport,
    destination_airport: best.destination_airport,
    transfers: num(best.transfers),
    return_transfers: num(best.return_transfers),
    duration: num(best.duration),
    duration_to: num(best.duration_to),
    duration_back: num(best.duration_back),
    link: typeof best.link === "string" ? best.link : undefined,
  };
}

// v1 prices/cheap: the previous trigger, now fetched only to show alongside v3.
export async function fetchCheapestV1(
  origin: string,
  destination: string,
  month: string,
  currency: string,
): Promise<Cheapest | null> {
  const q = new URLSearchParams({
    origin,
    destination,
    depart_date: month,
    currency,
    token: TRAVELPAYOUTS_TOKEN,
  });
  const res = await fetch(`https://api.travelpayouts.com/v1/prices/cheap?${q}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`travelpayouts v1 ${currency} ${origin}-${destination}: HTTP ${res.status}`);
    return null;
  }
  const body = await res.json();
  if (!body.success || !body.data?.[destination]) return null;
  const offers = Object.values(body.data[destination]) as any[];
  if (!offers.length) return null;
  const best = offers.reduce((a, b) => (a.price < b.price ? a : b));
  // NOTE: the real keys are departure_at / return_at, not depart_date / return_date.
  return {
    source: "v1",
    price: best.price,
    currency: currency.toUpperCase(),
    airline: best.airline ?? "",
    flight_number: best.flight_number != null ? String(best.flight_number) : undefined,
    depart_date: best.departure_at ?? "",
    return_date: best.return_at ?? "",
    duration: num(best.duration),
    duration_to: num(best.duration_to),
    duration_back: num(best.duration_back),
  };
}

// A failed or thrown fetch is logged and treated as "no offer".
export function safe(label: string, p: Promise<Cheapest | null>): Promise<Cheapest | null> {
  return p.catch((e) => {
    console.error(`${label} fare fetch failed`, e);
    return null;
  });
}

export function nextMonth(): string {
  const now = new Date();
  // Date.UTC rolls month 12 over into January of the next year for us.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type Place = {
  code: string; // IATA city (or airport) code, e.g. "OSA"
  name: string; // Chinese name to store, e.g. "大阪"
  country: string;
  type: "city" | "airport";
};

// Names the autocomplete misses in Traditional Chinese (it knows 东京 and
// Tokyo, but returns nothing for 東京).
const ALIASES: Record<string, string> = {
  東京: "TYO",
};

const IATA = /^[A-Za-z]{3}$/;
const CJK = /[㐀-鿿]/;
const sameName = (a: string, b: string) => a.replace(/臺/g, "台") === b.replace(/臺/g, "台");

async function autocomplete(term: string, locale: string): Promise<Place[]> {
  const q = new URLSearchParams({ term, locale });
  q.append("types[]", "city");
  q.append("types[]", "airport");
  const res = await fetch(`https://autocomplete.travelpayouts.com/places2?${q}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`travelpayouts autocomplete ${locale} "${term}": HTTP ${res.status}`);
    return [];
  }
  const body = await res.json();
  if (!Array.isArray(body)) return [];
  return (body as any[])
    .filter((p) => typeof p.code === "string" && IATA.test(p.code))
    .map((p) => ({
      code: p.code.toUpperCase(),
      name: String(p.name ?? p.code),
      country: String(p.country_name ?? ""),
      type: p.type === "airport" ? "airport" : "city",
    }));
}

// Cities first (TYO covers NRT and HND, which is what the fare APIs expect),
// then airports; one entry per code.
function rank(places: Place[]): Place[] {
  const seen = new Set<string>();
  return [...places.filter((p) => p.type === "city"), ...places.filter((p) => p.type === "airport")]
    .filter((p) => !seen.has(p.code) && seen.add(p.code))
    .slice(0, 5);
}

// What the admin typed ("大阪", "臺北", "OSA") -> candidate places, best first.
// Empty = not a place Travelpayouts knows. The name is a suggestion the admin
// can still edit before saving.
export async function resolvePlace(input: string): Promise<Place[]> {
  const term = input.trim();
  if (!term || term.length > 30) return [];

  const alias = ALIASES[term];
  if (alias || IATA.test(term)) {
    const code = (alias ?? term).toUpperCase();
    const hit = (await autocomplete(code, "zh-TW")).find((p) => p.code === code);
    if (!hit) return [];
    return [{ ...hit, name: alias ? term : hit.name }];
  }

  let places = rank(await autocomplete(term, "zh-TW"));
  if (!places.length) places = rank(await autocomplete(term, "zh-CN"));
  return places.map((p) => ({
    ...p,
    // Keep the admin's own spelling (台北 vs 臺北, or a Simplified query) when
    // it names the same place; fall back to it when the API had no Chinese name.
    name: sameName(term, p.name) || !CJK.test(p.name) ? term : p.name,
  }));
}

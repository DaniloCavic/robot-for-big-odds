/**
 * API-Football (api-sports.io) – kvote drugih kladionica kao referenca za value betting.
 * Koristi se isti ključ i isti dnevni brojač kao za rezultate.
 * Format odgovora se proverava dugmetom „Proveri referentne kvote“ (2 zahteva) pre nego što se robot osloni na njega.
 */
import { APIFOOTBALL_BASE, ApiFootballError } from "@/lib/results/apifootball";

export type AfOddsValue = { value: string; odd: number };
export type AfOddsBet = { id: number; name: string; values: AfOddsValue[] };
export type AfOddsBookmaker = { id: number; name: string; bets: AfOddsBet[] };
export type AfOddsFixture = { fixtureId: number; date: string | null; league: string | null; bookmakers: AfOddsBookmaker[] };
export type AfPaging = { current: number; total: number };

type RawOdds = {
  fixture?: { id?: number; date?: string };
  league?: { name?: string; country?: string };
  bookmakers?: { id?: number; name?: string; bets?: { id?: number; name?: string; values?: { value?: string | number; odd?: string | number }[] }[] }[];
};

async function get<T>(apiKey: string, path: string, fetchImpl: typeof fetch): Promise<{ response: T; paging: AfPaging | null; results: number | null }> {
  const res = await fetchImpl(`${APIFOOTBALL_BASE}${path}`, { headers: { "x-apisports-key": apiKey }, cache: "no-store" });
  if (!res.ok) throw new ApiFootballError(`API-Football greška ${res.status}`);
  const body = (await res.json()) as { errors?: unknown; response?: T; paging?: AfPaging; results?: number };
  const errors = body.errors && typeof body.errors === "object" ? Object.values(body.errors as Record<string, string>) : [];
  if (Array.isArray(body.errors) ? body.errors.length : errors.length) {
    throw new ApiFootballError(`API-Football: ${(Array.isArray(body.errors) ? body.errors : errors).join("; ")}`);
  }
  return { response: (body.response ?? []) as T, paging: body.paging ?? null, results: body.results ?? null };
}

/** Spisak kladionica koje API-Football nudi (1 zahtev). */
export async function fetchBookmakers(apiKey: string, fetchImpl: typeof fetch = fetch) {
  const { response } = await get<{ id: number; name: string }[]>(apiKey, "/odds/bookmakers", fetchImpl);
  return response.map((b) => ({ id: Number(b.id), name: String(b.name) }));
}

export function parseOdds(raw: RawOdds[]): AfOddsFixture[] {
  return raw.map((r) => ({
    fixtureId: Number(r.fixture?.id),
    date: r.fixture?.date ?? null,
    league: r.league ? [r.league.country, r.league.name].filter(Boolean).join(" · ") : null,
    bookmakers: (r.bookmakers ?? []).map((b) => ({
      id: Number(b.id), name: String(b.name ?? "?"),
      bets: (b.bets ?? []).map((t) => ({
        id: Number(t.id), name: String(t.name ?? "?"),
        values: (t.values ?? []).map((v) => ({ value: String(v.value ?? ""), odd: Number(v.odd) })).filter((v) => Number.isFinite(v.odd)),
      })),
    })),
  }));
}

/** Jedna strana pre-match kvota za dan (1 zahtev). */
export async function fetchOddsPage(apiKey: string, q: { date: string; page?: number; bet?: number; bookmaker?: number }, fetchImpl: typeof fetch = fetch) {
  const p = new URLSearchParams({ date: q.date, timezone: "Europe/Belgrade", page: String(q.page ?? 1) });
  if (q.bet) p.set("bet", String(q.bet));
  if (q.bookmaker) p.set("bookmaker", String(q.bookmaker));
  const { response, paging, results } = await get<RawOdds[]>(apiKey, `/odds?${p}`, fetchImpl);
  return { fixtures: parseOdds(response), paging, results };
}

/** Kratak pregled za proveru: koje kladionice i tržišta se pojavljuju u odgovoru. */
export function summarizeOdds(fixtures: AfOddsFixture[]) {
  const books = new Map<string, number>();
  const bets = new Map<string, number>();
  for (const f of fixtures) for (const b of f.bookmakers) {
    books.set(`${b.id}: ${b.name}`, (books.get(`${b.id}: ${b.name}`) ?? 0) + 1);
    for (const t of b.bets) bets.set(`${t.id}: ${t.name}`, (bets.get(`${t.id}: ${t.name}`) ?? 0) + 1);
  }
  const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  return { fixtures: fixtures.length, bookmakers: sort(books), bets: sort(bets) };
}

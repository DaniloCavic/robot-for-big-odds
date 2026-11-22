/**
 * Pinnacle kvote za jedan dan iz API-Football-a:
 *  - 1 zahtev /fixtures?date= (imena timova i vreme – /odds ih ne vraća),
 *  - N zahteva /odds?date=&bookmaker=4&page= (10 utakmica po strani).
 * Svaki zahtev prolazi kroz `beforeRequest` (dnevni limit) i `onRequest` (brojač).
 */
import { fetchDay, type AfFixture } from "@/lib/results/apifootball";
import type { Candidate } from "@/lib/results/matching";
import { fetchOddsPage } from "./apifootball-odds";
import { refMarketsFromBets, type RefMarkets } from "./rules";

export const PINNACLE_ID = 4;
const MAX_PAGES = 40;

export type RefFixture = Candidate & { country: string | null; markets: RefMarkets };

export type ReferenceDeps = {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Baca grešku ako je dnevni limit potrošen. */
  beforeRequest: () => Promise<void>;
  onRequest: () => Promise<void>;
};

export async function loadPinnacleDay(date: string, deps: ReferenceDeps): Promise<{ fixtures: RefFixture[]; pages: number; withOdds: number }> {
  await deps.beforeRequest();
  const day: AfFixture[] = await fetchDay(deps.apiKey, date, deps.fetchImpl);
  await deps.onRequest();
  const byId = new Map(day.map((f) => [f.id, f]));
  const markets = new Map<number, RefMarkets>();
  let page = 1, total = 1;
  while (page <= total && page <= MAX_PAGES) {
    await deps.beforeRequest();
    const res = await fetchOddsPage(deps.apiKey, { date, bookmaker: PINNACLE_ID, page }, deps.fetchImpl);
    await deps.onRequest();
    total = res.paging?.total ?? 1;
    for (const f of res.fixtures) {
      const pin = f.bookmakers.find((b) => b.id === PINNACLE_ID);
      if (pin) markets.set(f.fixtureId, refMarketsFromBets(pin.bets));
    }
    page += 1;
  }
  const fixtures: RefFixture[] = [];
  for (const [id, m] of markets) {
    const f = byId.get(id);
    if (!f || f.status !== "NOT_STARTED") continue;
    fixtures.push({ id, home: f.home, away: f.away, kickoff: f.kickoff, league: f.league, country: f.country, markets: m });
  }
  return { fixtures, pages: page - 1, withOdds: markets.size };
}

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings-repo";
import { apiFootballKey } from "@/lib/results/apifootball";
import { dailyCount, incDaily } from "@/lib/results/job-state";
import { AF_COUNTER } from "@/lib/results/tracker";
import { fetchBookmakers, fetchOddsPage, summarizeOdds } from "@/lib/value/apifootball-odds";
import { zonedYmd, ymdToString } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Value betting – provera referentnih kvota: da li API-Football (isti ključ kao za rezultate)
 * nudi kvote drugih kladionica (Pinnacle?) i u kom obliku. Troši 2 API-Football zahteva.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Niste prijavljeni." }, { status: 401 });
  const key = apiFootballKey();
  if (!key) return Response.json({ error: "API-Football ključ nije podešen (APIFOOTBALL_API_KEY na Railway-u)." }, { status: 400 });
  const settings = await getSettings();
  if ((await dailyCount(prisma, AF_COUNTER)) + 2 > settings.apiFootballDailyCap) {
    return Response.json({ error: `Dnevni limit API-Football zahteva (${settings.apiFootballDailyCap}) je potrošen – povećaj ga u Podešavanjima ili probaj sutra.` }, { status: 429 });
  }
  const date = ymdToString(zonedYmd(new Date()));
  try {
    const bookmakers = await fetchBookmakers(key);
    await incDaily(prisma, AF_COUNTER);
    const page = await fetchOddsPage(key, { date });
    await incDaily(prisma, AF_COUNTER);
    const pinnacle = bookmakers.find((b) => /pinnacle/i.test(b.name)) ?? null;
    const summary = summarizeOdds(page.fixtures);
    // primer: prva utakmica sa najviše kladionica, samo 1X2 i više/manje
    const sample = [...page.fixtures].sort((a, b) => b.bookmakers.length - a.bookmakers.length)[0] ?? null;
    return Response.json({
      date,
      bookmakers,
      pinnacle,
      pinnacleInOdds: pinnacle ? summary.bookmakers.some((b) => b.name.startsWith(`${pinnacle.id}:`)) : false,
      paging: page.paging,
      results: page.results,
      summary,
      sample: sample && {
        fixtureId: sample.fixtureId, date: sample.date, league: sample.league,
        bookmakers: sample.bookmakers.map((b) => ({
          id: b.id, name: b.name,
          bets: b.bets.filter((t) => /match winner|goals over\/under/i.test(t.name)).slice(0, 2).map((t) => ({ id: t.id, name: t.name, values: t.values.slice(0, 8) })),
        })),
      },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

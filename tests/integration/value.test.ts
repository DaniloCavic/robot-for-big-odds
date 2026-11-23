import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runScans } from "@/lib/robot/runner";
import { demoValueFixtures } from "@/lib/robot/providers/demo";
import { buildReference, findValueTips } from "@/lib/value/rules";
import { isRealFootball } from "@/lib/robot/football";
import { addEntries, addEntry, createFilterSet } from "@/lib/filter/service";
import { runTracker } from "@/lib/results/tracker";
import type { AfFixture } from "@/lib/results/apifootball";

const db = new PrismaClient();
const FROM = new Date("2030-01-07T00:00:00Z");
const TO = new Date("2030-01-08T00:00:00Z");

async function wipe() {
  await db.$transaction([
    db.filterSetSelection.deleteMany(), db.filterSet.deleteMany(), db.trackedSelection.deleteMany(), db.resultUpdate.deleteMany(),
    db.comboCandidate.deleteMany(), db.marketSelection.deleteMany(), db.robotScan.deleteMany(), db.match.deleteMany(), db.auditLog.deleteMany(), db.jobState.deleteMany(),
  ]);
}
beforeAll(() => { process.env.DEMO_DELAY_MS = "0"; });
beforeEach(wipe);
afterAll(async () => { await wipe(); await db.$disconnect(); });

const valueScan = () => db.robotScan.create({ data: { provider: "demo", isDemo: true, periodLabel: "T", startDate: FROM, endDate: TO, maxOddsUsed: 5, strategy: "VALUE" } });

describe("Value skeniranje (demo izvor)", () => {
  it("čuva tačno one tipove koje pravila nađu, sa poštenom kvotom i vrednošću", async () => {
    const scan = await valueScan();
    await runScans([scan.id]);
    const s = await db.robotScan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(s.status).toBe("COMPLETED");
    const rows = await db.marketSelection.findMany({ where: { scanId: scan.id }, include: { match: true } });
    const got = rows.map((r) => `${r.match.externalId} ${r.marketType} ${r.odds.toNumber()} ${r.valuePct!.toNumber()}`).sort();
    const exp = demoValueFixtures(FROM, TO).filter((f) => isRealFootball(f)).flatMap((f) =>
      findValueTips(buildReference(f.demoReference!), Object.fromEntries(Object.entries(f.odds).map(([k, v]) => [k, v!.price]))).tips
        .map((t) => `${f.externalId} ${t.type} ${t.odds} ${t.valuePct}`)).sort();
    expect(got.length).toBeGreaterThan(0);
    expect(got).toEqual(exp);
    for (const r of rows) {
      expect(r.valuePct!.toNumber()).toBeGreaterThanOrEqual(4);
      expect(r.odds.toNumber()).toBeGreaterThanOrEqual(1.5);
      expect(r.odds.toNumber()).toBeLessThanOrEqual(5);
      expect(r.fairOdds!.toNumber()).toBeLessThan(r.odds.toNumber());
    }
    // virtuelni fudbal izbačen, dijagnostika popunjena
    expect(s.fixturesExcluded).toBeGreaterThan(0);
    const v = (s.diagnostics as { value: { matched: number; tips: number; reference: string } }).value;
    expect(v.reference).toBe("DEMO");
    expect(v.tips).toBe(rows.length);
    expect(v.matched).toBe(s.fixturesScanned - s.fixturesExcluded);
  });

  it("Value filter: prima value tipove po kvoti kladionice, ostale odbija; obračun daje tačan profit", async () => {
    const scan = await valueScan();
    await runScans([scan.id]);
    const tips = await db.marketSelection.findMany({ where: { scanId: scan.id }, include: { match: true } });
    const set = await createFilterSet(db, { name: "V", userId: null, stake: 1000, strategy: "VALUE" });
    const before = new Date(FROM.getTime() - 3600_000);
    const r = await addEntries(db, { filterSetId: set, marketSelectionIds: tips.map((t) => t.id), maxOdds: 1.3, now: before });
    expect(r.added).toBe(tips.length);
    // svaki tip ima ulog po kvoti, ne fiksnih 1.000
    const entries = await db.filterSetSelection.findMany({ where: { filterSetId: set } });
    for (const en of entries) expect(en.stake.toNumber()).toBe(Math.round((1000 / (en.oddsSnapshot.toNumber() - 1)) * 100) / 100);
    // tip bez vrednosti (npr. stari) ne ulazi u Value filter; value tip ne ulazi u drugi filter
    const plain = await db.marketSelection.create({ data: { matchId: tips[0].matchId, scanId: scan.id, marketType: "HOME_OVER_1_5", odds: 1.6, oddsTimestamp: new Date(), source: "T" } });
    await expect(addEntry(db, { filterSetId: set, marketSelectionId: plain.id, maxOdds: 1.3, now: before })).rejects.toThrow(/samo tipove koje je našao value robot/);
    const other = await createFilterSet(db, { name: "O", userId: null, stake: 1000 });
    await expect(addEntry(db, { filterSetId: other, marketSelectionId: tips[0].id, maxOdds: 1.3, now: before })).rejects.toThrow(/samo u Value filter/);

    // rezultat: sve utakmice 2:1 → tracker obračunava preko API-Football dnevnog odgovora
    const t = tips[0];
    const day: AfFixture[] = [{ id: 1, home: t.match.homeTeam, away: t.match.awayTeam, kickoff: t.match.kickoffTime, league: t.match.competition, country: "DEMO", status: "FINISHED", statusShort: "FT", score90: { home: 2, away: 1 } }];
    const apiFootball = vi.fn(async () => day);
    // DEMO utakmice tracker ne šalje API-ju – za test je označavamo kao pravu
    await db.match.update({ where: { id: t.matchId }, data: { isDemo: false } });
    await runTracker({ db, now: new Date(t.match.kickoffTime.getTime() + 130 * 60_000), apiFootball, oddsPapi: null, resultCheckMinutes: 15, oddsPapiChecksPerDay: 10 });
    const e = await db.filterSetSelection.findFirstOrThrow({ where: { filterSetId: set, marketSelectionId: t.id } });
    const won = ["HOME", "DC_1X", "DC_12", "OVER_1_5", "OVER_2_5", "UNDER_3_5"].includes(t.marketType);
    expect(e.settlementStatus).toBe(won ? "WON" : "LOST");
    // ulog „na dobitak“: ulog = 1.000 / (kvota − 1) → prolaz donosi 1.000 (± zaokruživanje), pad −ulog
    const stake = e.stake.toNumber();
    expect(stake).toBe(Math.round((1000 / (t.odds.toNumber() - 1)) * 100) / 100);
    expect(e.netProfit!.toNumber()).toBeCloseTo(won ? Math.round(stake * t.odds.toNumber() * 100) / 100 - stake : -stake, 2);
    if (won) expect(Math.abs(e.netProfit!.toNumber() - 1000)).toBeLessThanOrEqual(0.03);
  });
});

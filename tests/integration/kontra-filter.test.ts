import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addEntries, addEntry, createFilterSet, listFilterSets } from "@/lib/filter/service";
import type { AfFixture } from "@/lib/results/apifootball";
import { runTracker } from "@/lib/results/tracker";

const db = new PrismaClient();
const MIN = 60_000;
const KICK = new Date("2026-11-10T18:00:00Z");
const BEFORE = new Date(KICK.getTime() - 60 * MIN);

async function wipe() {
  await db.$transaction([
    db.filterSetSelection.deleteMany(), db.filterSet.deleteMany(), db.trackedSelection.deleteMany(), db.resultUpdate.deleteMany(),
    db.comboCandidate.deleteMany(), db.marketSelection.deleteMany(), db.robotScan.deleteMany(), db.match.deleteMany(), db.auditLog.deleteMany(), db.jobState.deleteMany(),
  ]);
}
beforeEach(wipe);
afterAll(async () => { await wipe(); await db.$disconnect(); });

type T = "HOME" | "AWAY" | "OVER_1_5" | "UNDER_3_5" | "UNDER_1_5" | "OVER_3_5";
async function match(home: string, away: string) {
  return db.match.create({ data: { provider: "oddspapi", externalId: `id${Math.random()}`, homeTeam: home, awayTeam: away, competition: "EFL Trophy", country: "England", kickoffTime: KICK } });
}
async function sel(matchId: string, type: T, odds: number, strategy: "OSNOVNI" | "KONTRA" = type === "UNDER_1_5" || type === "OVER_3_5" ? "KONTRA" : "OSNOVNI") {
  const scan = await db.robotScan.create({ data: { provider: "oddspapi:admiralbet.rs", strategy, periodLabel: "T", startDate: new Date(0), endDate: new Date(KICK.getTime() + 86400000), maxOddsUsed: 1.3, status: "COMPLETED" } });
  return db.marketSelection.create({
    data: { matchId, scanId: scan.id, marketType: type, odds, triggerOdds: strategy === "KONTRA" ? 1.2 : null, oddsTimestamp: new Date(), source: "AdmiralBet · OddsPapi" },
  });
}
const add = (filterSetId: string, marketSelectionId: string) => addEntry(db, { filterSetId, marketSelectionId, maxOdds: 1.3, now: BEFORE });

describe("Kontra filter", () => {
  it("filter pamti strategiju; stari/podrazumevani filter je Osnovni", async () => {
    const a = await createFilterSet(db, { name: "Stari", userId: null, stake: 1000 });
    const b = await createFilterSet(db, { name: "Kontra", userId: null, stake: 1000, strategy: "KONTRA" });
    const list = await listFilterSets(db);
    expect(list.find((s) => s.id === a)!.strategy).toBe("OSNOVNI");
    expect(list.find((s) => s.id === b)!.strategy).toBe("KONTRA");
    await expect(createFilterSet(db, { name: "X", userId: null, stake: 1000, strategy: "NESTO" })).rejects.toThrow(/strategija/);
  });

  it("Kontra filter prima 0–1 i 4+ bez gornje granice kvote, a odbija tipove osnovnog robota", async () => {
    const k = await createFilterSet(db, { name: "K", userId: null, stake: 1000, strategy: "KONTRA" });
    const m = await match("A", "B");
    await add(k, (await sel(m.id, "UNDER_1_5", 4.2)).id);
    for (const t of ["HOME", "AWAY", "OVER_1_5", "UNDER_3_5"] as const) {
      await expect(add(k, (await sel(m.id, t, 1.2)).id)).rejects.toThrow(/Kontra filter prima samo 0–1 i 4\+/);
    }
    // najviše jedan kontra tip po utakmici
    await expect(add(k, (await sel(m.id, "OVER_3_5", 3.6)).id)).rejects.toThrow(/drugi kontra tip/);
    // ispod 1.01 se ne prihvata
    const m2 = await match("C", "D");
    await expect(add(k, (await sel(m2.id, "OVER_3_5", 1.005)).id)).rejects.toThrow(/ispod najmanje/);
    const e = await db.filterSetSelection.findMany({ where: { filterSetId: k } });
    expect(e.map((x) => x.oddsSnapshot.toNumber())).toEqual([4.2]);
  });

  it("Osnovni filter odbija kontra tipove, a i dalje odbija pojedinačne tipove iznad 1.30", async () => {
    const o = await createFilterSet(db, { name: "O", userId: null, stake: 1000 });
    const m = await match("A", "B");
    await expect(add(o, (await sel(m.id, "UNDER_1_5", 4.2)).id)).rejects.toThrow(/samo u Kontra filter/);
    await expect(add(o, (await sel(m.id, "OVER_3_5", 3.1)).id)).rejects.toThrow(/samo u Kontra filter/);
    await expect(add(o, (await sel(m.id, "HOME", 1.31)).id)).rejects.toThrow(/iznad/);
    await add(o, (await sel(m.id, "OVER_1_5", 1.2)).id);
  });

  it("„Dodaj sve“ u Kontra filter: dodaje kontra tipove, ostale broji kao drugu strategiju", async () => {
    const k = await createFilterSet(db, { name: "K", userId: null, stake: 1000, strategy: "KONTRA" });
    const ms = [];
    for (let i = 0; i < 5; i++) ms.push((await sel((await match(`H${i}`, `G${i}`)).id, i % 2 ? "OVER_3_5" : "UNDER_1_5", 3 + i)).id);
    const base = (await sel((await match("X", "Y")).id, "OVER_1_5", 1.2)).id;
    const r = await addEntries(db, { filterSetId: k, marketSelectionIds: [...ms, base], maxOdds: 1.3, now: BEFORE });
    expect(r).toMatchObject({ added: 5, duplicate: 0, started: 0, invalid: 0, strategy: 1 });
  });
});

describe("Obračun kontra tipova kroz postojeći tracker", () => {
  const fx = (id: number, home: string, away: string, h: number, a: number): AfFixture => ({
    id, home, away, kickoff: KICK, league: "EFL Trophy", country: "England", status: "FINISHED", statusShort: "FT", score90: { home: h, away: a },
  });

  it("0–1 i 4+ dobijaju tačan profit, uz osnovni tip na istoj utakmici, jednim dnevnim zahtevom", async () => {
    const k = await createFilterSet(db, { name: "K", userId: null, stake: 1000, strategy: "KONTRA" });
    const o = await createFilterSet(db, { name: "O", userId: null, stake: 1000 });
    const m1 = await match("Leicester City", "Walsall FC"); // 1:0 → 0–1 prolazi, 2+ pada
    const m2 = await match("Arsenal", "Chelsea"); // 2:1 → 4+ pada
    const m3 = await match("Everton", "Fulham"); // 3:1 → 4+ prolazi
    await add(k, (await sel(m1.id, "UNDER_1_5", 4.2)).id);
    await add(o, (await sel(m1.id, "OVER_1_5", 1.2)).id);
    await add(k, (await sel(m2.id, "OVER_3_5", 3.6)).id);
    await add(k, (await sel(m3.id, "OVER_3_5", 2.85)).id);

    const apiFootball = vi.fn(async () => [fx(1, "Leicester", "Walsall", 1, 0), fx(2, "Arsenal", "Chelsea", 2, 1), fx(3, "Everton", "Fulham", 3, 1)]);
    const r = await runTracker({ db, now: new Date(KICK.getTime() + 130 * MIN), apiFootball, oddsPapi: null, resultCheckMinutes: 15, oddsPapiChecksPerDay: 10 });
    // utakmice istog dana su u istom dnevnom odgovoru – jedan API-Football zahtev
    expect(apiFootball).toHaveBeenCalledTimes(1);
    expect(r.apiFootballCalls).toBe(1);

    const rows = await db.filterSetSelection.findMany({ include: { trackedSelection: { include: { match: true } } } });
    const by = (home: string, type: string) => rows.find((x) => x.trackedSelection.match.homeTeam === home && x.trackedSelection.marketType === type)!;
    const money = (x: ReturnType<typeof by>) => [x.settlementStatus, x.grossReturn?.toNumber(), x.netProfit?.toNumber()];
    expect(money(by("Leicester City", "UNDER_1_5"))).toEqual(["WON", 4200, 3200]);
    expect(money(by("Leicester City", "OVER_1_5"))).toEqual(["LOST", 0, -1000]);
    expect(money(by("Arsenal", "OVER_3_5"))).toEqual(["LOST", 0, -1000]);
    expect(money(by("Everton", "OVER_3_5"))).toEqual(["WON", 2850, 1850]);
  });
});

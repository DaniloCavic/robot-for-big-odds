import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runScans } from "@/lib/robot/runner";
import { demoFixtures } from "@/lib/robot/providers/demo";
import { applyKontraRules } from "@/lib/robot/kontra-rules";
import { isRealFootball } from "@/lib/robot/football";

const db = new PrismaClient();
const DAY = 24 * 3600_000;
// fiksan dan u budućnosti (demo pravi utakmice 10–20h UTC; podaci zavise od datuma, pa je dan fiksan
// i izabran tako da ima i preskok „oba gola“ i utakmice sa favoritom 1/2)
const FROM = new Date("2030-01-07T00:00:00Z");
const TO = new Date(FROM.getTime() + DAY);

async function wipe() {
  await db.$transaction([
    db.filterSetSelection.deleteMany(), db.filterSet.deleteMany(), db.trackedSelection.deleteMany(), db.resultUpdate.deleteMany(),
    db.comboCandidate.deleteMany(), db.marketSelection.deleteMany(), db.robotScan.deleteMany(), db.match.deleteMany(), db.auditLog.deleteMany(), db.jobState.deleteMany(),
  ]);
}
beforeAll(() => { process.env.DEMO_DELAY_MS = "0"; });
beforeEach(wipe);
afterAll(async () => { await wipe(); await db.$disconnect(); });

async function newScan(strategy: "OSNOVNI" | "KONTRA", diagnostics: object = {}) {
  return db.robotScan.create({
    data: { provider: "demo", isDemo: true, periodLabel: "T", startDate: FROM, endDate: TO, maxOddsUsed: 1.3, strategy, diagnostics },
  });
}

async function selectionsOf(scanId: string) {
  const rows = await db.marketSelection.findMany({ where: { scanId }, include: { match: true } });
  return rows.map((r) => ({ ext: r.match.externalId, type: r.marketType, odds: r.odds.toNumber(), trigger: r.triggerOdds?.toNumber() ?? null })).sort((a, b) => `${a.ext}${a.type}`.localeCompare(`${b.ext}${b.type}`));
}

/** Šta Kontra treba da odigra na demo utakmicama (ista čista funkcija). */
function expectedKontra() {
  return demoFixtures(FROM, TO).filter((f) => f.kickoffTime >= FROM && f.kickoffTime < TO && isRealFootball(f))
    .map((f) => ({ f, d: applyKontraRules(f.odds) }));
}

describe("Kontra skeniranje (demo izvor)", () => {
  it("čuva samo 0–1 i 4+, nikad 1, 2, 2+ ni 0–3, i sa kvotom okidača", async () => {
    const scan = await newScan("KONTRA");
    await runScans([scan.id]);
    const s = await db.robotScan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(s.status).toBe("COMPLETED");
    const sel = await selectionsOf(scan.id);
    expect(sel.length).toBeGreaterThan(0);
    for (const x of sel) {
      expect(["UNDER_1_5", "OVER_3_5"]).toContain(x.type);
      expect(x.trigger).not.toBeNull();
      expect(x.trigger!).toBeLessThanOrEqual(1.3);
    }
    // tačno ono što pravila kažu – ni više ni manje
    const exp = expectedKontra().filter((x) => x.d.pick)
      .map(({ f, d }) => ({ ext: f.externalId, type: d.pick!, odds: d.odds!, trigger: d.triggerOdds! }))
      .sort((a, b) => `${a.ext}${a.type}`.localeCompare(`${b.ext}${b.type}`));
    expect(sel).toEqual(exp);
    expect(s.selectionsFound).toBe(exp.length);
  });

  it("nikad ne ubaci utakmicu gde su oba gola ≤ 1.30; 1 i 2 se ne gledaju; preskoci se broje", async () => {
    const scan = await newScan("KONTRA");
    await runScans([scan.id]);
    const byExt = new Map(demoFixtures(FROM, TO).map((f) => [f.externalId, f]));
    for (const x of await selectionsOf(scan.id)) {
      const o = byExt.get(x.ext)!.odds;
      expect((o.OVER_1_5?.price ?? 9) <= 1.3 && (o.UNDER_3_5?.price ?? 9) <= 1.3).toBe(false);
    }
    const s = await db.robotScan.findUniqueOrThrow({ where: { id: scan.id } });
    const k = (s.diagnostics as { kontra: { withTrigger: number; played: number; skips: Record<string, number> } }).kontra;
    const exp = expectedKontra();
    const count = (r: string) => exp.filter((x) => x.d.skipReason === r).length;
    expect(k.skips).toEqual({ OBA_GOLA: count("OBA_GOLA"), NEMA_KONTRA_KVOTE: count("NEMA_KONTRA_KVOTE") });
    expect(k.withTrigger).toBe(exp.filter((x) => x.d.pick || x.d.skipReason).length);
    expect(k.played).toBe(exp.filter((x) => x.d.pick).length);
    expect(k.skips.OBA_GOLA).toBeGreaterThan(0);
    // sada se igraju i utakmice sa jakim favoritom (1 ili 2 ≤ 1.30)
    const byExt2 = new Map(demoFixtures(FROM, TO).map((f) => [f.externalId, f]));
    const sel = await selectionsOf(scan.id);
    expect(sel.some((x) => { const o = byExt2.get(x.ext)!.odds; return (o.HOME?.price ?? 9) <= 1.3 || (o.AWAY?.price ?? 9) <= 1.3; })).toBe(true);
  });

  it("„Skeniraj oba“ daje iste rezultate kao dva odvojena skeniranja", async () => {
    const osn = await newScan("OSNOVNI");
    await runScans([osn.id]);
    const kon = await newScan("KONTRA");
    await runScans([kon.id]);
    const aloneOsn = await selectionsOf(osn.id);
    const aloneKon = await selectionsOf(kon.id);

    const a = await newScan("OSNOVNI");
    const b = await newScan("KONTRA", { sharedRequests: true, pairedWith: a.id });
    await runScans([a.id, b.id]);
    expect(await selectionsOf(a.id)).toEqual(aloneOsn);
    expect(await selectionsOf(b.id)).toEqual(aloneKon);
    // osnovni nikad ne sadrži kontra tipove
    expect(aloneOsn.some((x) => x.type === "UNDER_1_5" || x.type === "OVER_3_5")).toBe(false);
    const [sa, sb] = await Promise.all([db.robotScan.findUniqueOrThrow({ where: { id: a.id } }), db.robotScan.findUniqueOrThrow({ where: { id: b.id } })]);
    expect([sa.status, sb.status]).toEqual(["COMPLETED", "COMPLETED"]);
    expect(sa.fixturesScanned).toBe(sb.fixturesScanned);
    expect((sb.diagnostics as { pairedWith?: string }).pairedWith).toBe(a.id);
  });
});

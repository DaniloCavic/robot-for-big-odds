import { describe, expect, it } from "vitest";
import { computeKontraStats, computeStats, type StatRow } from "@/lib/stats/compute";
import { settingsSchema } from "@/lib/settings";

const row = (marketType: string, status: string, odds: number, triggerOdds: number | null, extra: Partial<StatRow> = {}): StatRow => {
  const gross = status === "WON" ? Math.round(1000 * odds * 100) / 100 : status === "LOST" ? 0 : status === "VOID" ? 1000 : null;
  return {
    status, marketType, odds, stake: 1000, gross, net: gross == null ? null : gross - 1000, kickoff: "2026-11-16T18:00:00Z",
    competition: "L", country: "C", filterSetId: "k", filterSetName: "Kontra", match: "A – B", home: null, away: null,
    strategy: "KONTRA", triggerOdds, ...extra,
  };
};

describe("Kontra statistika", () => {
  const rows = [
    row("UNDER_1_5", "WON", 4.2, 1.2), // +3200; osnovni 2+ @1.20 → −1000
    row("UNDER_1_5", "LOST", 4.0, 1.08), // −1000; osnovni 2+ @1.08 → +80
    row("UNDER_1_5", "LOST", 3.8, 1.28), // −1000; osnovni → +280
    row("OVER_3_5", "WON", 3.6, 1.25), // +2600; osnovni 0–3 @1.25 → −1000
    row("OVER_3_5", "LOST", 3.0, 1.15), // −1000; osnovni → +150
    row("OVER_3_5", "VOID", 3.2, 1.22), // 0; osnovni → 0
    row("OVER_3_5", "PENDING", 3.1, 1.3), // ne ulazi u obračun
  ];
  const k = computeKontraStats(rows);

  it("po tipu: broj, prolaznost, profit, ROI, prosečna kvota, break-even", () => {
    const u = k.byType.find((x) => x.key === "UNDER_1_5")!;
    expect([u.total, u.won, u.lost, u.net]).toEqual([3, 1, 2, 1200]);
    expect(u.passRate).toBeCloseTo(33.333, 2);
    expect(u.roi).toBeCloseTo(40, 6);
    expect(u.avgOdds).toBeCloseTo(4.0, 6);
    expect(u.breakEven).toBeCloseTo(25, 6); // 1 / 4.00
    const o = k.byType.find((x) => x.key === "OVER_3_5")!;
    expect([o.total, o.won, o.lost, o.void, o.open, o.net]).toEqual([4, 1, 1, 1, 1, 1600]);
    expect(o.passRate).toBe(50);
  });

  it("po opsegu kvote okidača 1.01–1.10 / 1.11–1.20 / 1.21–1.30", () => {
    const by = Object.fromEntries(k.byTrigger.map((b) => [b.key, b]));
    expect([by["1.01-1.10"].total, by["1.01-1.10"].net]).toEqual([1, -1000]);
    expect([by["1.11-1.20"].total, by["1.11-1.20"].won, by["1.11-1.20"].lost, by["1.11-1.20"].net]).toEqual([2, 1, 1, 2200]);
    expect([by["1.21-1.30"].total, by["1.21-1.30"].won, by["1.21-1.30"].lost, by["1.21-1.30"].net]).toEqual([4, 1, 1, 1600]);
    expect(by["1.11-1.20"].byType.find((t) => t.key === "UNDER_1_5")!.won).toBe(1);
  });

  it("po kvoti 0–1 / 4+", () => {
    const by = Object.fromEntries(k.byOdds.map((b) => [b.key, b]));
    expect([by["2.50-3.49"].total, by["2.50-3.49"].lost, by["2.50-3.49"].void]).toEqual([3, 1, 1]); // 3.0, 3.2, 3.1
    expect([by["3.50-4.49"].total, by["3.50-4.49"].won, by["3.50-4.49"].net]).toEqual([4, 2, 3800]); // 4.2, 4.0, 3.8, 3.6
    expect(by["6+"].total).toBe(0);
  });

  it("opšta statistika: kontra tipovi u tabeli po tipu, ali ne u matrici tip × kvota (1.01–1.30)", () => {
    const s = computeStats(rows);
    expect(s.byType.map((x) => x.key)).toEqual(expect.arrayContaining(["UNDER_1_5", "OVER_3_5"]));
    expect(s.byType.find((x) => x.key === "UNDER_1_5")!.label).toBe("0–1");
    expect(s.matrix.some((m) => m.key === "UNDER_1_5" || m.key === "OVER_3_5")).toBe(false);
    expect(s.byGroup.find((g) => g.key === "kontra")!.total).toBe(7);
    // osnovni podaci: nema kontra grupe ni tipova
    const base = computeStats([row("OVER_1_5", "WON", 1.2, null, { strategy: "OSNOVNI" })]);
    expect(base.byGroup.some((g) => g.key === "kontra")).toBe(false);
    expect(base.byType.some((x) => x.key === "UNDER_1_5")).toBe(false);
  });
});

describe("podešavanja – Kontra pragovi", () => {
  const base = { maxOdds: "1.30", stakePerSelection: "1000", maxRequestsPerScan: "60", resultCheckMinutes: "15", apiFootballDailyCap: "200", oddsPapiResultChecksPerDay: "10", excludeGoalsPair: true, combineResultGoals: true, comboFallback: "WINNER_ONLY" };
  const parse = (extra: Record<string, unknown>) => settingsSchema.safeParse({ ...base, ...extra });
  it("podrazumevano 1.30", () => {
    const p = parse({});
    expect(p.success && p.data.kontraTriggerMax).toBe(1.3);
  });
  it("prihvata 1.25, odbija 1.00, 1.51 i tri decimale", () => {
    expect(parse({ kontraTriggerMax: "1.25" }).success).toBe(true);
    expect(parse({ kontraTriggerMax: "1.00" }).success).toBe(false);
    expect(parse({ kontraTriggerMax: "1.51" }).success).toBe(false);
    expect(parse({ kontraTriggerMax: "1.255" }).success).toBe(false);
  });
});

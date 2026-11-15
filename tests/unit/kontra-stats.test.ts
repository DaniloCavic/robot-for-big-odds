import { describe, expect, it } from "vitest";
import { computeKontraStats, computeStats, mirrorRow, type StatRow } from "@/lib/stats/compute";
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

  it("poređenje: šta bi osnovni tip na istoj utakmici doneo", () => {
    const c = Object.fromEntries(k.comparison.map((x) => [x.key, x]));
    expect(c.kontra.net).toBe(2800);
    expect([c.osnovni.won, c.osnovni.lost, c.osnovni.void, c.osnovni.net]).toEqual([3, 2, 1, -1490]); // 80+280+150−1000−1000
    expect(c["osnovni-UNDER_1_5"].net).toBe(-640);
    expect(c["osnovni-OVER_3_5"].net).toBe(-850);
  });

  it("mirrorRow: suprotan ishod po kvoti okidača; bez okidača nema poređenja", () => {
    expect(mirrorRow(row("UNDER_1_5", "LOST", 4, 1.2))).toMatchObject({ marketType: "OVER_1_5", status: "WON", odds: 1.2, gross: 1200, net: 200 });
    expect(mirrorRow(row("OVER_3_5", "WON", 4, 1.1))).toMatchObject({ marketType: "UNDER_3_5", status: "LOST", net: -1000 });
    expect(mirrorRow(row("OVER_3_5", "VOID", 4, 1.1))).toMatchObject({ status: "VOID", net: 0 });
    expect(mirrorRow(row("UNDER_1_5", "WON", 4, null))).toBeNull();
    expect(mirrorRow(row("OVER_1_5", "WON", 1.2, null))).toBeNull();
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
  it("podrazumevano 1.30 / 1.30", () => {
    const p = parse({});
    expect(p.success && [p.data.kontraTriggerMax, p.data.kontraFavoriteMax]).toEqual([1.3, 1.3]);
  });
  it("prihvata 1.25 i 1.40, odbija 1.00, 1.51 (okidač), 2.01 (favorit) i tri decimale", () => {
    expect(parse({ kontraTriggerMax: "1.25", kontraFavoriteMax: "1.40" }).success).toBe(true);
    expect(parse({ kontraTriggerMax: "1.00" }).success).toBe(false);
    expect(parse({ kontraTriggerMax: "1.51" }).success).toBe(false);
    expect(parse({ kontraFavoriteMax: "2.01" }).success).toBe(false);
    expect(parse({ kontraTriggerMax: "1.255" }).success).toBe(false);
  });
});

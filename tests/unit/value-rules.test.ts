import { describe, expect, it } from "vitest";
import { buildReference, findValueTips, refMarketsFromBets } from "@/lib/value/rules";
import { outcomeFor } from "@/lib/results/settle-math";
import { demoValueFixtures } from "@/lib/robot/providers/demo";
import { computeValueStats, type StatRow } from "@/lib/stats/compute";

// Pinnacle iz primera sa ekrana (Brazil · Serie A)
const PIN = [
  { id: 1, name: "Match Winner", values: [{ value: "Home", odd: 1.65 }, { value: "Draw", odd: 3.96 }, { value: "Away", odd: 5.22 }] },
  { id: 5, name: "Goals Over/Under", values: [
    { value: "Over 1.5", odd: 1.27 }, { value: "Under 1.5", odd: 3.87 }, { value: "Over 2.0", odd: 1.4 }, { value: "Under 2.0", odd: 3.03 },
    { value: "Over 2.5", odd: 1.84 }, { value: "Under 2.5", odd: 2.02 },
  ] },
];

describe("Pinnacle tržišta iz API-Football-a", () => {
  it("1X2 i celobrojne granice 1.5 / 2.5 (2.0 se ignoriše)", () => {
    const m = refMarketsFromBets(PIN);
    expect(m.result).toEqual([1.65, 3.96, 5.22]);
    expect(m.totals).toEqual({ "1.5": [1.27, 3.87], "2.5": [1.84, 2.02] });
  });
  it("poštene kvote i dupla šansa iz 1X2", () => {
    const r = buildReference(refMarketsFromBets(PIN));
    const sumP = 1 / r.fair.HOME! + 1 / r.fair.DRAW! + 1 / r.fair.AWAY!;
    expect(sumP).toBeCloseTo(1, 10);
    expect(1 / r.fair.DC_1X!).toBeCloseTo(1 / r.fair.HOME! + 1 / r.fair.DRAW!, 10);
    expect(1 / r.fair.OVER_2_5! + 1 / r.fair.UNDER_2_5!).toBeCloseTo(1, 10);
    expect(r.raw.HOME).toBe(1.65);
    expect(r.raw.DC_1X).toBeUndefined(); // Pinnacle ovde nema duplu šansu – računa se
    expect(r.fair.OVER_3_5).toBeUndefined();
  });
});

describe("value tipovi", () => {
  const ref = buildReference(refMarketsFromBets(PIN)); // marža 1X2 ≈ 5% → fer: 1 ≈ 1.733; golovi 2.5: 0–2 ≈ 2.098
  it("AdmiralBet 1 @ 1.82 (≈ +5%) i 0–2 @ 2.25 (≈ +7.3%) → oba (različite grupe)", () => {
    expect(ref.fair.HOME!).toBeCloseTo(1.733, 3);
    const { tips } = findValueTips(ref, { HOME: 1.82, DRAW: 3.6, AWAY: 4.8, OVER_2_5: 1.75, UNDER_2_5: 2.25 });
    expect(tips.map((t) => t.type)).toEqual(["HOME", "UNDER_2_5"]);
    expect(tips[0].valuePct).toBeCloseTo(5.0, 0);
    expect(tips[1].valuePct).toBeCloseTo(7.3, 0);
    expect(tips[0].ref).toBe(1.65);
  });
  it("ispod praga (4%) nema tipa; prag iz podešavanja", () => {
    expect(findValueTips(ref, { HOME: 1.79 }).tips).toHaveLength(0); // ≈ +3.3%
    expect(findValueTips(ref, { HOME: 1.79 }, { minValuePct: 3, minOdds: 1.5, maxOdds: 5 }).tips).toHaveLength(1);
  });
  it("opseg kvote", () => {
    expect(findValueTips(ref, { AWAY: 6.0 }).tips).toHaveLength(0); // value, ali iznad 5.00
    expect(findValueTips(ref, { AWAY: 6.0 }, { minValuePct: 4, minOdds: 1.5, maxOdds: 8 }).tips).toHaveLength(1);
  });
  it("najviše jedan tip po grupi – onaj sa najvećom vrednošću", () => {
    const fair1X = ref.fair.DC_1X!;
    const { tips } = findValueTips(ref, { HOME: 1.82, DC_1X: Math.round(fair1X * 1.1 * 100) / 100 }, { minValuePct: 4, minOdds: 1.01, maxOdds: 5 });
    expect(tips.map((t) => t.type)).toEqual(["DC_1X"]);
  });
  it("tip koji Pinnacle nema (4+) se ne proverava", () => {
    const { checked, tips } = findValueTips(ref, { OVER_3_5: 4.5 });
    expect(checked).toHaveLength(0);
    expect(tips).toHaveLength(0);
  });
});

describe("obračun novih tipova", () => {
  it("3+ / 0–2", () => {
    expect([outcomeFor("OVER_2_5", 2, 1), outcomeFor("OVER_2_5", 1, 1), outcomeFor("UNDER_2_5", 1, 1), outcomeFor("UNDER_2_5", 2, 1)]).toEqual(["WON", "LOST", "WON", "LOST"]);
  });
  it("dupla šansa", () => {
    expect([outcomeFor("DC_1X", 1, 1), outcomeFor("DC_1X", 0, 1), outcomeFor("DC_X2", 0, 0), outcomeFor("DC_X2", 2, 1), outcomeFor("DC_12", 1, 0), outcomeFor("DC_12", 2, 2)])
      .toEqual(["WON", "LOST", "WON", "LOST", "WON", "LOST"]);
  });
});

describe("demo i statistika", () => {
  it("demo value utakmice imaju sve tipove i referencu; deo daje value", () => {
    const fx = demoValueFixtures(new Date("2030-01-07T00:00:00Z"), new Date("2030-01-08T00:00:00Z"));
    expect(fx.length).toBeGreaterThan(5);
    expect(Object.keys(fx[0].odds)).toHaveLength(12);
    const tips = fx.flatMap((f) => findValueTips(buildReference(f.demoReference!), Object.fromEntries(Object.entries(f.odds).map(([k, v]) => [k, v!.price]))).tips);
    expect(tips.length).toBeGreaterThan(0);
  });
  it("očekivani profit i očekivani prolazi", () => {
    const row = (status: string, odds: number, fair: number): StatRow => {
      const gross = status === "WON" ? odds * 1000 : status === "LOST" ? 0 : null;
      return { status, marketType: "HOME", odds, stake: 1000, gross, net: gross == null ? null : gross - 1000, kickoff: "2026-11-23T18:00:00Z", competition: "L", country: null,
        filterSetId: "f", filterSetName: "F", match: "A – B", home: null, away: null, fairOdds: fair, valuePct: (odds / fair - 1) * 100 };
    };
    const v = computeValueStats([row("WON", 2.2, 2), row("LOST", 2.2, 2), row("LOST", 3.3, 3), row("PENDING", 2, 1.9)]);
    expect(v.overall.net).toBe(1200 - 2000);
    expect(v.overall.expectedNet).toBe(300); // 3 × 1000 × 10%
    expect(v.overall.expectedWins).toBeCloseTo(1.3, 5); // 0.5 + 0.5 + 0.333
    expect(v.overall.avgValuePct).toBeCloseTo(10, 6);
    expect(v.byValue.find((b) => b.key === "8-12")!.total).toBe(3);
    expect(v.byType).toHaveLength(1);
  });
});

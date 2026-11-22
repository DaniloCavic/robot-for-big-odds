import { describe, expect, it } from "vitest";
import { fairOdds, findValue, margin, valuePct } from "@/lib/value/math";
import { parseOdds, summarizeOdds } from "@/lib/value/apifootball-odds";

describe("value – marža i poštena kvota", () => {
  it("marža 1X2 (Pinnacle 2.00 / 3.60 / 3.90 ≈ 3.4%)", () => {
    expect(margin([2, 3.6, 3.9])!).toBeCloseTo(0.0341, 3);
  });
  it("poštene kvote: zbir verovatnoća = 1", () => {
    const f = fairOdds([2, 3.6, 3.9])!;
    expect(f.reduce((a, o) => a + 1 / o, 0)).toBeCloseTo(1, 10);
    expect(f[0]).toBeCloseTo(2.068, 3);
  });
  it("više/manje (2 ishoda)", () => {
    const f = fairOdds([1.9, 1.95])!;
    expect(f.reduce((a, o) => a + 1 / o, 0)).toBeCloseTo(1, 10);
  });
  it("neispravne kvote → null", () => {
    expect(margin([2])).toBeNull();
    expect(margin([1, 3])).toBeNull();
    expect(fairOdds([2, NaN, 3])).toBeNull();
  });
  it("vrednost u %", () => {
    expect(valuePct(2.2, 2.068)).toBeCloseTo(6.38, 1);
    expect(valuePct(2, 2)).toBe(0);
  });
});

describe("value – pronalaženje tipova", () => {
  const ref = [2, 3.6, 3.9]; // poštene ≈ 2.068 / 3.723 / 4.033
  it("primer: AdmiralBet 1 @ 2.20 je value (+6.4%), X i 2 nisu", () => {
    const v = findValue(ref, [2.2, 3.4, 3.7]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ index: 0, odds: 2.2 });
    expect(v[0].valuePct).toBeCloseTo(6.4, 1);
  });
  it("prag vrednosti (podrazumevano 4%)", () => {
    expect(findValue(ref, [2.14, null, null])).toHaveLength(0); // ≈ 3.5%
    expect(findValue(ref, [2.16, null, null])).toHaveLength(1); // ≈ 4.5%
    expect(findValue(ref, [2.14, null, null], { minValuePct: 3, minOdds: 1.5, maxOdds: 5 })).toHaveLength(1);
  });
  it("opseg kvote 1.50–5.00", () => {
    expect(findValue([1.2, 7, 15], [1.4, null, null])).toHaveLength(0); // ispod 1.50
    expect(findValue([1.2, 7, 15], [null, null, 18])).toHaveLength(0); // iznad 5.00
  });
  it("nema kvote kod nas → preskače se; različit broj ishoda → ništa", () => {
    expect(findValue(ref, [null, null, null])).toHaveLength(0);
    expect(findValue(ref, [2.5, 4])).toHaveLength(0);
  });
});

describe("API-Football kvote – parsiranje", () => {
  const raw = [{
    fixture: { id: 101, date: "2026-11-22T18:00:00+01:00" }, league: { name: "Super Liga", country: "Serbia" },
    bookmakers: [
      { id: 4, name: "Pinnacle", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.00" }, { value: "Draw", odd: "3.60" }, { value: "Away", odd: "3.90" }] }] },
      { id: 8, name: "Bet365", bets: [{ id: 5, name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.90" }, { value: "Under 2.5", odd: "x" }] }] },
    ],
  }];
  it("kvote kao brojevi, neispravne se izbacuju", () => {
    const [f] = parseOdds(raw);
    expect(f).toMatchObject({ fixtureId: 101, league: "Serbia · Super Liga" });
    expect(f.bookmakers[0].bets[0].values.map((v) => v.odd)).toEqual([2, 3.6, 3.9]);
    expect(f.bookmakers[1].bets[0].values).toEqual([{ value: "Over 2.5", odd: 1.9 }]);
  });
  it("pregled kladionica i tržišta", () => {
    expect(summarizeOdds(parseOdds(raw))).toEqual({
      fixtures: 1,
      bookmakers: [{ name: "4: Pinnacle", count: 1 }, { name: "8: Bet365", count: 1 }],
      bets: [{ name: "1: Match Winner", count: 1 }, { name: "5: Goals Over/Under", count: 1 }],
    });
  });
});

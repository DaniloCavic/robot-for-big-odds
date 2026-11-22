import type { MarketTypeCode } from "@/lib/odds";
import type { OddsProvider, ProviderFixture } from "../types";

/**
 * DEMO izvor – izmišljene utakmice za testiranje toka robota. Svaka utakmica i kvota je jasno
 * označena kao DEMO. Namerno sadrži i kvote iznad 1.30 i virtuelni fudbal, da se vidi da ih robot izbacuje.
 */
const LEAGUES = [
  { name: "DEMO Liga A", country: "DEMO" },
  { name: "DEMO Liga B", country: "DEMO" },
  { name: "DEMO Kup", country: "DEMO" },
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PRICES = [1.08, 1.12, 1.15, 1.2, 1.25, 1.29, 1.3, 1.31, 1.35, 1.45, 1.6, 1.9, 2.4, 3.2, 4.5];

export function demoFixtures(from: Date, to: Date): ProviderFixture[] {
  const out: ProviderFixture[] = [];
  const hour = 3600_000;
  const start = Math.ceil(from.getTime() / hour) * hour;
  const r = rng(Math.floor(start / hour));
  let i = 0;
  for (let t = start; t < to.getTime() && out.length < 60; t += 2 * hour) {
    const local = new Date(t).getUTCHours();
    if (local < 10 || local > 20) continue;
    for (let k = 0; k < 2; k++) {
      i += 1;
      const league = LEAGUES[i % LEAGUES.length];
      const virtual = i % 9 === 0;
      const pick = () => PRICES[Math.floor(r() * PRICES.length)];
      const odds: Partial<Record<MarketTypeCode, { price: number; changedAt: Date }>> = {};
      (["HOME", "AWAY", "OVER_1_5", "UNDER_3_5"] as const).forEach((m) => {
        if (r() < 0.85) odds[m] = { price: pick(), changedAt: new Date() };
      });
      // DEMO spojene kvote („1&2+“ …) – ponekad ih nema, da se vidi i preskakanje utakmice
      (["HOME_OVER_1_5", "HOME_UNDER_3_5", "AWAY_OVER_1_5", "AWAY_UNDER_3_5"] as const).forEach((m) => {
        const p = Math.round((1.3 + r() * 1.2) * 100) / 100;
        if (i % 2 === 0) odds[m] = { price: p, changedAt: new Date() }; // svaka druga utakmica nema spojene kvote → kandidat za ručni unos
      });
      // DEMO kontra kvote (0–1, 4+) – zaseban generator, da kvote osnovnog robota ostanu iste kao ranije.
      // Svaka deseta utakmica nema 0–1 ili 4+, da se vidi preskok „nema kontra kvote“.
      const rk = rng(i * 7919 + Math.floor(start / hour));
      if (i % 10 !== 3) odds.UNDER_1_5 = { price: Math.round((2.6 + rk() * 3) * 100) / 100, changedAt: new Date() };
      if (i % 10 !== 7) odds.OVER_3_5 = { price: Math.round((2.4 + rk() * 2.8) * 100) / 100, changedAt: new Date() };
      out.push({
        externalId: `demo-${t}-${k}`,
        sport: "football",
        homeTeam: `DEMO Tim ${i * 2 - 1}`,
        awayTeam: `DEMO Tim ${i * 2}`,
        competition: virtual ? "DEMO Virtual Football" : league.name,
        country: league.country,
        externalCompetitionId: null,
        kickoffTime: new Date(t + k * 30 * 60_000),
        odds,
      });
    }
  }
  return out;
}

/** Poisson: verovatnoća da padne najviše k golova (λ = očekivani broj golova). */
function poissonCdf(k: number, lambda: number) {
  let p = 0, term = Math.exp(-lambda);
  for (let i = 0; i <= k; i++) { p += term; term *= lambda / (i + 1); }
  return p;
}

/**
 * DEMO za value robota: utakmice sa realnim kvotama iz modela verovatnoća.
 * „Pinnacle“ = poštena kvota sa maržom 3%; „AdmiralBet“ = marža 7% i slučajno odstupanje (−10% … +16%),
 * pa se ponekad pojavi value. Svaka deseta utakmica je virtuelna (mora da se izbaci).
 */
export function demoValueFixtures(from: Date, to: Date): ProviderFixture[] {
  const out: ProviderFixture[] = [];
  const hour = 3600_000;
  const start = Math.ceil(from.getTime() / hour) * hour;
  let i = 0;
  for (let t = start; t < to.getTime() && out.length < 60; t += 2 * hour) {
    const h = new Date(t).getUTCHours();
    if (h < 10 || h > 20) continue;
    for (let k = 0; k < 2; k++) {
      i += 1;
      const r = rng(Math.floor(t / hour) * 31 + k * 7 + 3);
      const px = 0.2 + r() * 0.1;
      const p1 = (1 - px) * (0.25 + r() * 0.5);
      const p2 = 1 - px - p1;
      const lambda = 1.8 + r() * 1.6;
      const under = { "1.5": poissonCdf(1, lambda), "2.5": poissonCdf(2, lambda), "3.5": poissonCdf(3, lambda) } as const;
      const pin = (p: number) => Math.round((1 / (p * 1.03)) * 100) / 100;
      const adm = (p: number) => Math.max(1.01, Math.round((1 / (p * 1.07)) * (0.9 + r() * 0.26) * 100) / 100);
      const now = new Date();
      const o = (p: number) => ({ price: adm(p), changedAt: now });
      const odds: ProviderFixture["odds"] = {
        HOME: o(p1), DRAW: o(px), AWAY: o(p2), DC_1X: o(p1 + px), DC_X2: o(px + p2), DC_12: o(p1 + p2),
        OVER_1_5: o(1 - under["1.5"]), UNDER_1_5: o(under["1.5"]), OVER_2_5: o(1 - under["2.5"]), UNDER_2_5: o(under["2.5"]),
        OVER_3_5: o(1 - under["3.5"]), UNDER_3_5: o(under["3.5"]),
      };
      const league = LEAGUES[i % LEAGUES.length];
      out.push({
        externalId: `demo-v-${t}-${k}`,
        sport: "football",
        homeTeam: `DEMO Tim ${i * 2 - 1}`,
        awayTeam: `DEMO Tim ${i * 2}`,
        competition: i % 10 === 0 ? "DEMO Virtual Football" : league.name,
        country: league.country,
        externalCompetitionId: null,
        kickoffTime: new Date(t + k * 30 * 60_000),
        odds,
        demoReference: {
          result: [pin(p1), pin(px), pin(p2)],
          totals: {
            "1.5": [pin(1 - under["1.5"]), pin(under["1.5"])],
            "2.5": [pin(1 - under["2.5"]), pin(under["2.5"])],
            "3.5": [pin(1 - under["3.5"]), pin(under["3.5"])],
          },
        },
      });
    }
  }
  return out;
}

export const demoProvider: OddsProvider = {
  id: "demo",
  name: "Probni podaci",
  sourceLabel: "DEMO",
  isDemo: true,
  async *scan(range, ctx) {
    const fixtures = ctx.strategy === "VALUE" ? demoValueFixtures(range.from, range.to) : demoFixtures(range.from, range.to);
    await ctx.setTotal(fixtures.length);
    for (const f of fixtures) {
      if (await ctx.shouldStop()) return;
      await new Promise((res) => setTimeout(res, Number(process.env.DEMO_DELAY_MS ?? 250)));
      yield f;
    }
  },
};

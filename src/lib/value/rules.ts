/**
 * Value robot – pravila (čiste funkcije).
 *
 * 1) Iz Pinnacle kvota (API-Football) za 1X2 i više/manje golova (1.5, 2.5, 3.5) skida se marža → poštene kvote.
 *    Dupla šansa (1X, X2, 12) se računa iz poštenih verovatnoća 1X2 (npr. P(1X) = P(1) + P(X)).
 * 2) Za svaki tip AdmiralBet kvota se poredi sa poštenom: vrednost = kvota / poštena − 1.
 * 3) Tip ulazi ako je vrednost ≥ praga i kvota u opsegu (Podešavanja; podrazumevano ≥ 4%, 1.50–5.00).
 * 4) Najviše jedan tip po grupi po utakmici (ishod: 1, X, 2, 1X, X2, 12; golovi: sve granice) – onaj sa najvećom
 *    vrednošću, jer su tipovi iste grupe povezani (npr. „1“ i „1X“ prolaze zajedno).
 */
import type { ValueTypeCode } from "@/lib/odds";
import { fairOdds, valuePct, VALUE_DEFAULTS, type ValueOpts } from "./math";
import type { AfOddsBet } from "./apifootball-odds";

export type RefMarkets = {
  /** Pinnacle 1X2: [1, X, 2] */
  result?: [number, number, number];
  /** Pinnacle više/manje po granici: [više, manje] */
  totals: Partial<Record<"1.5" | "2.5" | "3.5", [number, number]>>;
};

const LINES = ["1.5", "2.5", "3.5"] as const;
const OU_TYPES: Record<(typeof LINES)[number], [ValueTypeCode, ValueTypeCode]> = {
  "1.5": ["OVER_1_5", "UNDER_1_5"],
  "2.5": ["OVER_2_5", "UNDER_2_5"],
  "3.5": ["OVER_3_5", "UNDER_3_5"],
};
export const RESULT_GROUP: ValueTypeCode[] = ["HOME", "DRAW", "AWAY", "DC_1X", "DC_X2", "DC_12"];
export const GOALS_GROUP: ValueTypeCode[] = ["OVER_1_5", "UNDER_1_5", "OVER_2_5", "UNDER_2_5", "OVER_3_5", "UNDER_3_5"];

const ok = (o: number | undefined) => typeof o === "number" && Number.isFinite(o) && o > 1;

/** Iz Pinnacle tržišta API-Football-a (bet 1 = Match Winner, bet 5 = Goals Over/Under). */
export function refMarketsFromBets(bets: AfOddsBet[]): RefMarkets {
  const out: RefMarkets = { totals: {} };
  const mw = bets.find((b) => b.id === 1 || /^match winner$/i.test(b.name));
  if (mw) {
    const v = (n: string) => mw.values.find((x) => x.value.toLowerCase() === n)?.odd;
    const r = [v("home"), v("draw"), v("away")];
    if (r.every(ok)) out.result = r as [number, number, number];
  }
  const ou = bets.find((b) => b.id === 5 || /^goals over\/under$/i.test(b.name));
  if (ou) {
    for (const line of LINES) {
      const o = ou.values.find((x) => x.value.toLowerCase() === `over ${line}`)?.odd;
      const u = ou.values.find((x) => x.value.toLowerCase() === `under ${line}`)?.odd;
      if (ok(o) && ok(u)) out.totals[line] = [o!, u!];
    }
  }
  return out;
}

export type Reference = {
  /** Poštena kvota po tipu (bez marže). */
  fair: Partial<Record<ValueTypeCode, number>>;
  /** Pinnacle kvota sa maržom (za duplu šansu nema – računa se). */
  raw: Partial<Record<ValueTypeCode, number>>;
};

export function buildReference(m: RefMarkets): Reference {
  const fair: Reference["fair"] = {};
  const raw: Reference["raw"] = {};
  if (m.result) {
    const f = fairOdds(m.result);
    if (f) {
      const [p1, px, p2] = f.map((o) => 1 / o);
      Object.assign(fair, { HOME: f[0], DRAW: f[1], AWAY: f[2], DC_1X: 1 / (p1 + px), DC_X2: 1 / (px + p2), DC_12: 1 / (p1 + p2) });
      Object.assign(raw, { HOME: m.result[0], DRAW: m.result[1], AWAY: m.result[2] });
    }
  }
  for (const line of LINES) {
    const t = m.totals[line];
    const f = t && fairOdds(t);
    if (!t || !f) continue;
    const [over, under] = OU_TYPES[line];
    fair[over] = f[0]; fair[under] = f[1];
    raw[over] = t[0]; raw[under] = t[1];
  }
  return { fair, raw };
}

export type ValueTip = { type: ValueTypeCode; odds: number; fair: number; ref: number | null; valuePct: number };
export type ValueCheck = { type: ValueTypeCode; odds: number; fair: number; valuePct: number };

/**
 * Value tipovi jedne utakmice. `ours` = AdmiralBet kvote po tipu.
 * Vraća i sve proverene tipove (za dijagnostiku: koliko je bilo blizu).
 */
export function findValueTips(ref: Reference, ours: Partial<Record<ValueTypeCode, number>>, opts: ValueOpts = VALUE_DEFAULTS) {
  const checked: ValueCheck[] = [];
  const candidates: ValueTip[] = [];
  for (const type of [...RESULT_GROUP, ...GOALS_GROUP]) {
    const fair = ref.fair[type];
    const odds = ours[type];
    if (!fair || !ok(odds)) continue;
    const v = Math.round(valuePct(odds!, fair) * 100) / 100;
    checked.push({ type, odds: odds!, fair, valuePct: v });
    if (v >= opts.minValuePct - 1e-9 && odds! >= opts.minOdds - 1e-9 && odds! <= opts.maxOdds + 1e-9) {
      candidates.push({ type, odds: odds!, fair: Math.round(fair * 10000) / 10000, ref: ref.raw[type] ?? null, valuePct: v });
    }
  }
  const best = (group: ValueTypeCode[]) => candidates.filter((c) => group.includes(c.type)).sort((a, b) => b.valuePct - a.valuePct)[0];
  const tips = [best(RESULT_GROUP), best(GOALS_GROUP)].filter((x): x is ValueTip => !!x);
  return { tips, checked };
}

/**
 * Value betting – matematika (čiste funkcije).
 *
 * Referentna kladionica (npr. Pinnacle) ima maržu: zbir 1/kvota za sve ishode jednog tržišta je > 1.
 * „Poštena“ verovatnoća = (1/kvota) / zbir (proporcionalno skidanje marže),
 * „poštena“ kvota = 1 / poštena verovatnoća.
 * Vrednost tipa kod naše kladionice = našaKvota / poštenaKvota − 1 (npr. 2.20 / 2.06 − 1 = +6.8%).
 */

/** Marža tržišta: zbir 1/kvota − 1 (npr. 0.03 = 3%). null ako kvote nisu ispravne. */
export function margin(odds: number[]): number | null {
  if (odds.length < 2 || odds.some((o) => !Number.isFinite(o) || o <= 1)) return null;
  return odds.reduce((a, o) => a + 1 / o, 0) - 1;
}

/** Poštene kvote za sve ishode jednog tržišta (1X2 ili više/manje). null ako kvote nisu ispravne. */
export function fairOdds(odds: number[]): number[] | null {
  const m = margin(odds);
  if (m == null) return null;
  const total = 1 + m;
  return odds.map((o) => o * total);
}

/** Vrednost u procentima: (našaKvota / poštenaKvota − 1) × 100. */
export function valuePct(bookOdds: number, fair: number): number {
  return (bookOdds / fair - 1) * 100;
}

export type ValueOpts = { minValuePct: number; minOdds: number; maxOdds: number };
/** Podrazumevano (predlog): vrednost ≥ 4%, kvota 1.50–5.00. */
export const VALUE_DEFAULTS: ValueOpts = { minValuePct: 4, minOdds: 1.5, maxOdds: 5 };

/**
 * Za jedno tržište (isti redosled ishoda kod reference i naše kladionice) vraća ishode sa vrednošću.
 * Ishod bez kvote kod nas (null) se preskače.
 */
export function findValue(reference: number[], ours: (number | null)[], opts: ValueOpts = VALUE_DEFAULTS) {
  const fair = fairOdds(reference);
  if (!fair || fair.length !== ours.length) return [];
  const out: { index: number; odds: number; fair: number; valuePct: number }[] = [];
  ours.forEach((o, index) => {
    if (o == null || !Number.isFinite(o) || o < opts.minOdds - 1e-9 || o > opts.maxOdds + 1e-9) return;
    const v = valuePct(o, fair[index]);
    if (v >= opts.minValuePct - 1e-9) out.push({ index, odds: o, fair: Math.round(fair[index] * 1000) / 1000, valuePct: Math.round(v * 10) / 10 });
  });
  return out;
}

import { ABSOLUTE_MAX_ODDS } from "./settings";

/** Tipovi koje robot traži: 1, 2, 2+, 0–3. (X se ne prati – odluka korisnika.) */
export const MARKET_TYPES = ["HOME", "AWAY", "OVER_1_5", "UNDER_3_5"] as const;
/** Spojeni tipovi „ishod + golovi“ – jedno tržište kladionice (npr. „1&2+“). Bez ograničenja kvote. */
export const COMBO_TYPES = ["HOME_OVER_1_5", "HOME_UNDER_3_5", "AWAY_OVER_1_5", "AWAY_UNDER_3_5"] as const;
export type ComboTypeCode = (typeof COMBO_TYPES)[number];
/** Kontra robot: igra suprotno od favorita golova – „0–1“ umesto 2+, „4+“ umesto 0–3. Bez ograničenja kvote. */
export const KONTRA_TYPES = ["UNDER_1_5", "OVER_3_5"] as const;
export type KontraTypeCode = (typeof KONTRA_TYPES)[number];
export const isKontra = (t: string): t is KontraTypeCode => (KONTRA_TYPES as readonly string[]).includes(t);
/** Value robot: tipovi koji se porede sa Pinnacle-om (redosled = redosled prikaza). */
export const VALUE_TYPES = ["HOME", "DRAW", "AWAY", "DC_1X", "DC_X2", "DC_12", "OVER_1_5", "UNDER_1_5", "OVER_2_5", "UNDER_2_5", "OVER_3_5", "UNDER_3_5"] as const;
export type ValueTypeCode = (typeof VALUE_TYPES)[number];
export const isValueType = (t: string): t is ValueTypeCode => (VALUE_TYPES as readonly string[]).includes(t);
/** Svi tipovi koji mogu postojati u bazi. */
export type MarketTypeCode = (typeof MARKET_TYPES)[number] | ComboTypeCode | KontraTypeCode | ValueTypeCode | "DRAW";

/** Od kojih delova se sastoji spojeni tip. */
export const COMBO_PARTS: Record<ComboTypeCode, ["HOME" | "AWAY", "OVER_1_5" | "UNDER_3_5"]> = {
  HOME_OVER_1_5: ["HOME", "OVER_1_5"],
  HOME_UNDER_3_5: ["HOME", "UNDER_3_5"],
  AWAY_OVER_1_5: ["AWAY", "OVER_1_5"],
  AWAY_UNDER_3_5: ["AWAY", "UNDER_3_5"],
};
export const isCombo = (t: string): t is ComboTypeCode => (COMBO_TYPES as readonly string[]).includes(t);

export const MARKET_LABELS: Record<MarketTypeCode, string> = {
  HOME: "1",
  DRAW: "X",
  AWAY: "2",
  OVER_1_5: "2+",
  UNDER_3_5: "0–3",
  HOME_OVER_1_5: "1&2+",
  HOME_UNDER_3_5: "1&0–3",
  AWAY_OVER_1_5: "2&2+",
  AWAY_UNDER_3_5: "2&0–3",
  UNDER_1_5: "0–1",
  OVER_3_5: "4+",
  OVER_2_5: "3+",
  UNDER_2_5: "0–2",
  DC_1X: "1X",
  DC_X2: "X2",
  DC_12: "12",
};

export const MARKET_DESCRIPTIONS: Record<MarketTypeCode, string> = {
  HOME: "Pobeda domaćina",
  DRAW: "Nerešeno",
  AWAY: "Pobeda gosta",
  OVER_1_5: "Ukupno golova 2 ili više",
  UNDER_3_5: "Ukupno golova 0 do 3",
  HOME_OVER_1_5: "Pobeda domaćina i 2+ gola",
  HOME_UNDER_3_5: "Pobeda domaćina i 0–3 gola",
  AWAY_OVER_1_5: "Pobeda gosta i 2+ gola",
  AWAY_UNDER_3_5: "Pobeda gosta i 0–3 gola",
  UNDER_1_5: "Ukupno golova 0 ili 1",
  OVER_3_5: "Ukupno golova 4 ili više",
  OVER_2_5: "Ukupno golova 3 ili više",
  UNDER_2_5: "Ukupno golova 0 do 2",
  DC_1X: "Domaćin ne gubi",
  DC_X2: "Gost ne gubi",
  DC_12: "Nema nerešenog",
};

const EPS = 1e-9;

/**
 * Centralno pravilo kvote (backend). Kvota mora biti konačan broj, veća od 1.00
 * i najviše maxOdds (koji nikada ne može preći 1.30). 1.30 prolazi, 1.31 i 1.301 ne.
 */
export function isValidOdds(odds: unknown, maxOdds: number = ABSOLUTE_MAX_ODDS): boolean {
  if (typeof odds !== "number" || !Number.isFinite(odds)) return false;
  const limit = Math.min(Number.isFinite(maxOdds) ? maxOdds : ABSOLUTE_MAX_ODDS, ABSOLUTE_MAX_ODDS);
  return odds > 1 + EPS && odds <= limit + EPS;
}

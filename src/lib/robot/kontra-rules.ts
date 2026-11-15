import type { KontraTypeCode } from "@/lib/odds";

/**
 * Kontra robot – pravila izbora (čista funkcija, bez baze i mreže).
 *
 * Okidač je tip golova koji je favorit (kvota ≤ prag, podrazumevano 1.30):
 *   2+  (OVER_1_5)  ≤ prag → igra se 0–1 (UNDER_1_5)
 *   0–3 (UNDER_3_5) ≤ prag → igra se 4+  (OVER_3_5)
 *
 * Utakmica se preskače (sa razlogom) kada okidač postoji, ali:
 *   FAVORIT_1_2       – 1 ili 2 je ≤ prag favorita (podrazumevano 1.30)
 *   OBA_GOLA          – i 2+ i 0–3 su ≤ prag okidača
 *   NEMA_KONTRA_KVOTE – kladionica ne nudi kontra tip (ili je < 1.01 / neaktivan)
 *
 * Utakmica bez okidača nije „preskok“ – samo ne pripada Kontra robotu (pick = null, skipReason = null).
 * Kontra tip se igra po kvoti kladionice, bez gornje granice.
 */

export type KontraSkipReason = "OBA_GOLA" | "FAVORIT_1_2" | "NEMA_KONTRA_KVOTE";
export const KONTRA_SKIP_REASONS: KontraSkipReason[] = ["OBA_GOLA", "FAVORIT_1_2", "NEMA_KONTRA_KVOTE"];
export const KONTRA_SKIP_LABELS: Record<KontraSkipReason, string> = {
  OBA_GOLA: "Oba tipa golova (2+ i 0–3) ispod praga",
  FAVORIT_1_2: "Favorit 1 ili 2 ispod praga",
  NEMA_KONTRA_KVOTE: "Kladionica ne nudi kontra tip",
};

/** Podrazumevani pragovi (Podešavanja ih mogu promeniti). 1.30 ulazi, 1.31 ne. */
export const KONTRA_DEFAULT_TRIGGER_MAX = 1.3;
export const KONTRA_DEFAULT_FAVORITE_MAX = 1.3;
/** Najniža prihvatljiva kvota kontra tipa. */
export const KONTRA_MIN_ODDS = 1.01;

type Price = number | { price: number; active?: boolean } | null | undefined;

export type KontraOddsInput = {
  HOME?: Price;
  AWAY?: Price;
  OVER_1_5?: Price;
  UNDER_3_5?: Price;
  UNDER_1_5?: Price;
  OVER_3_5?: Price;
};

export type KontraOptions = { triggerMax?: number; favoriteMax?: number };

export type KontraTrigger = "OVER_1_5" | "UNDER_3_5";

export type KontraDecision = {
  /** Tip koji se igra (ili null). */
  pick: KontraTypeCode | null;
  /** Kvota kontra tipa (ili null). */
  odds: number | null;
  /** Razlog preskoka (null ako se igra ili ako utakmica nema okidač). */
  skipReason: KontraSkipReason | null;
  /** Koji tip golova je okidač i njegova kvota (čuva se kao triggerOdds). */
  trigger: KontraTrigger | null;
  triggerOdds: number | null;
};

const EPS = 1e-9;
const COUNTER: Record<KontraTrigger, KontraTypeCode> = { OVER_1_5: "UNDER_1_5", UNDER_3_5: "OVER_3_5" };

function priceOf(p: Price): number | null {
  if (p == null) return null;
  if (typeof p === "number") return Number.isFinite(p) ? p : null;
  if (p.active === false) return null;
  return typeof p.price === "number" && Number.isFinite(p.price) ? p.price : null;
}

/** Kvota je „ispod praga“: veća od 1.00 i ≤ prag (1.30 ulazi, 1.31 ne). */
const atOrBelow = (price: number | null, max: number) => price !== null && price > 1 + EPS && price <= max + EPS;

export function applyKontraRules(input: KontraOddsInput, opts: KontraOptions = {}): KontraDecision {
  const triggerMax = opts.triggerMax ?? KONTRA_DEFAULT_TRIGGER_MAX;
  const favoriteMax = opts.favoriteMax ?? KONTRA_DEFAULT_FAVORITE_MAX;

  const over15 = priceOf(input.OVER_1_5);
  const under35 = priceOf(input.UNDER_3_5);
  const overTrig = atOrBelow(over15, triggerMax);
  const underTrig = atOrBelow(under35, triggerMax);

  const none: KontraDecision = { pick: null, odds: null, skipReason: null, trigger: null, triggerOdds: null };
  if (!overTrig && !underTrig) return none;

  const trigger: KontraTrigger = overTrig ? "OVER_1_5" : "UNDER_3_5";
  const triggerOdds = overTrig ? over15 : under35;
  const skip = (skipReason: KontraSkipReason): KontraDecision => ({ ...none, skipReason, trigger, triggerOdds });

  // Pravilo 4: favorit 1 ili 2 → preskoči, čak i kad okidač postoji
  if (atOrBelow(priceOf(input.HOME), favoriteMax) || atOrBelow(priceOf(input.AWAY), favoriteMax)) return skip("FAVORIT_1_2");
  // Pravilo 3: oba tipa golova ispod praga → preskoči
  if (overTrig && underTrig) return { ...skip("OBA_GOLA"), trigger: null, triggerOdds: null };

  // Pravila 5 i 6: kontra kvota mora postojati, biti aktivna i ≥ 1.01 (bez gornje granice)
  const pick = COUNTER[trigger];
  const odds = priceOf(input[pick]);
  if (odds === null || odds < KONTRA_MIN_ODDS - EPS) return skip("NEMA_KONTRA_KVOTE");

  return { pick, odds, skipReason: null, trigger, triggerOdds };
}

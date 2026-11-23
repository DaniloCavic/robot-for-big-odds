/**
 * Ulog „na dobitak“: ulog se bira tako da prolaz donese tačno `target` čistog dobitka.
 * ulog = target / (kvota − 1)  →  kvota 3.00: 500 RSD, kvota 1.82: 1.219,51 RSD, kvota 5.00: 250 RSD.
 * Manje se ulaže na visoke kvote (veće oscilacije, nepouzdanija procena vrednosti), više na niske.
 */
export function toWinStake(target: number, odds: number): number {
  if (!(odds > 1) || !(target > 0)) throw new Error("Neispravna kvota ili ciljani dobitak.");
  return Math.round((target / (odds - 1)) * 100) / 100;
}

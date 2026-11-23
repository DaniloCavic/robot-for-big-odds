/**
 * Ulog „na dobitak“: ulog se bira tako da prolaz donese tačno `target` čistog dobitka.
 * ulog = target / (kvota − 1), zaokruženo NAVIŠE na ceo dinar (998,34 → 999), pa je dobitak uvek ≥ target:
 * kvota 3.00: 500 RSD, kvota 1.82: 1.220 RSD, kvota 5.00: 250 RSD.
 * Manje se ulaže na visoke kvote (veće oscilacije, nepouzdanija procena vrednosti), više na niske.
 */
export function toWinStake(target: number, odds: number): number {
  if (!(odds > 1) || !(target > 0)) throw new Error("Neispravna kvota ili ciljani dobitak.");
  // −1e-9: tačni celi brojevi (npr. 1000 / 2 = 500) da ne skoče na 501 zbog greške u zapisu decimala
  return Math.ceil(target / (odds - 1) - 1e-9);
}

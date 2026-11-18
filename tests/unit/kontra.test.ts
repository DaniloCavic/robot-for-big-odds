import { describe, expect, it } from "vitest";
import { applyKontraRules, type KontraOddsInput } from "@/lib/robot/kontra-rules";
import { amountsFor, outcomeFor } from "@/lib/results/settle-math";
import { MARKET_LABELS } from "@/lib/odds";

/** Kvote kontra tipova koje kladionica nudi u primerima (realne vrednosti oko 3–5). */
const COUNTER = { UNDER_1_5: 4.2, OVER_3_5: 3.6 };
const row = (h: number, a: number, o15: number, u35: number, extra: Partial<KontraOddsInput> = {}): KontraOddsInput =>
  ({ HOME: h, AWAY: a, OVER_1_5: o15, UNDER_3_5: u35, ...COUNTER, ...extra });

describe("Kontra pravila – tabela primera iz specifikacije", () => {
  it("A: 2+ 1.20 → 0–1", () => {
    expect(applyKontraRules(row(1.8, 4.2, 1.2, 1.45))).toEqual({ pick: "UNDER_1_5", odds: 4.2, skipReason: null, trigger: "OVER_1_5", triggerOdds: 1.2 });
  });
  it("B: 0–3 1.25 → 4+", () => {
    expect(applyKontraRules(row(2.1, 3.3, 1.45, 1.25))).toEqual({ pick: "OVER_3_5", odds: 3.6, skipReason: null, trigger: "UNDER_3_5", triggerOdds: 1.25 });
  });
  it("C: 1 = 1.25 se ne gleda (pravilo od 18.11.) → 0–1", () => {
    expect(applyKontraRules(row(1.25, 9, 1.22, 1.6))).toMatchObject({ pick: "UNDER_1_5", odds: 4.2, skipReason: null, triggerOdds: 1.22 });
  });
  it("D: 2+ 1.28 i 0–3 1.30 → preskoči OBA_GOLA", () => {
    expect(applyKontraRules(row(2.4, 2.9, 1.28, 1.3))).toMatchObject({ pick: null, odds: null, skipReason: "OBA_GOLA" });
  });
  it("E: 1 = 1.31 → 0–1", () => {
    expect(applyKontraRules(row(1.31, 8.5, 1.2, 1.7))).toMatchObject({ pick: "UNDER_1_5", skipReason: null, triggerOdds: 1.2 });
  });
  it("F: 2+ = 1.30 ulazi → 0–1", () => {
    expect(applyKontraRules(row(1.9, 3.8, 1.3, 1.5))).toMatchObject({ pick: "UNDER_1_5", skipReason: null, triggerOdds: 1.3 });
  });
  it("G: nema kvote za 0–1 → preskoči NEMA_KONTRA_KVOTE", () => {
    expect(applyKontraRules(row(1.7, 4.5, 1.18, 1.55, { UNDER_1_5: undefined }))).toMatchObject({ pick: null, skipReason: "NEMA_KONTRA_KVOTE", trigger: "OVER_1_5", triggerOdds: 1.18 });
    // sa kvotom – igra se
    expect(applyKontraRules(row(1.7, 4.5, 1.18, 1.55)).pick).toBe("UNDER_1_5");
  });
});

describe("Kontra pravila – granice i posebni slučajevi", () => {
  it("okidač: 1.30 ulazi, 1.31 ne", () => {
    expect(applyKontraRules(row(2, 3, 1.3, 1.6)).pick).toBe("UNDER_1_5");
    expect(applyKontraRules(row(2, 3, 1.31, 1.6))).toMatchObject({ pick: null, skipReason: null, trigger: null });
    expect(applyKontraRules(row(2, 3, 1.6, 1.3)).pick).toBe("OVER_3_5");
    expect(applyKontraRules(row(2, 3, 1.6, 1.31)).pick).toBeNull();
    expect(applyKontraRules(row(2, 3, 1.301, 1.6)).pick).toBeNull();
  });
  it("kvote za 1 i 2 se ne gledaju – ni 1.01, ni 1.30", () => {
    expect(applyKontraRules(row(1.3, 9, 1.2, 1.6)).pick).toBe("UNDER_1_5");
    expect(applyKontraRules(row(9, 1.3, 1.2, 1.6)).pick).toBe("UNDER_1_5");
    expect(applyKontraRules(row(1.01, 25, 1.6, 1.25)).pick).toBe("OVER_3_5");
    expect(applyKontraRules(row(1.05, 30, 1.1, 1.2))).toMatchObject({ pick: null, skipReason: "OBA_GOLA" }); // oba gola i dalje preskače
  });
  it("bez okidača nema ni preskoka (utakmica ne pripada Kontra robotu)", () => {
    expect(applyKontraRules(row(1.2, 12, 1.5, 1.5))).toEqual({ pick: null, odds: null, skipReason: null, trigger: null, triggerOdds: null });
  });
  it("kontra tip bez gornje granice kvote", () => {
    expect(applyKontraRules(row(2, 3, 1.05, 1.9, { UNDER_1_5: 11.5 }))).toMatchObject({ pick: "UNDER_1_5", odds: 11.5 });
  });
  it("kontra kvota ispod 1.01 ili neaktivna → NEMA_KONTRA_KVOTE", () => {
    expect(applyKontraRules(row(2, 3, 1.2, 1.6, { UNDER_1_5: 1.005 })).skipReason).toBe("NEMA_KONTRA_KVOTE");
    expect(applyKontraRules(row(2, 3, 1.2, 1.6, { UNDER_1_5: 1.01 })).pick).toBe("UNDER_1_5");
    expect(applyKontraRules(row(2, 3, 1.2, 1.6, { UNDER_1_5: { price: 4.1, active: false } })).skipReason).toBe("NEMA_KONTRA_KVOTE");
    expect(applyKontraRules(row(2, 3, 1.2, 1.6, { UNDER_1_5: { price: 4.1, active: true } })).odds).toBe(4.1);
  });
  it("neaktivan okidač se ne računa", () => {
    expect(applyKontraRules(row(2, 3, 1.6, 1.6, { OVER_1_5: { price: 1.2, active: false } })).pick).toBeNull();
  });
  it("nedostaje 1 ili 2 – ne smeta", () => {
    expect(applyKontraRules({ OVER_1_5: 1.2, UNDER_1_5: 4 }).pick).toBe("UNDER_1_5");
  });
  it("prilagođeni pragovi iz Podešavanja", () => {
    expect(applyKontraRules(row(2, 3, 1.25, 1.6), { triggerMax: 1.2 }).pick).toBeNull();
  });
});

describe("obračun kontra tipova (90 min)", () => {
  it("0–1 prolazi do 1 gola", () => {
    expect(outcomeFor("UNDER_1_5", 0, 0)).toBe("WON");
    expect(outcomeFor("UNDER_1_5", 1, 0)).toBe("WON");
    expect(outcomeFor("UNDER_1_5", 0, 1)).toBe("WON");
    expect(outcomeFor("UNDER_1_5", 1, 1)).toBe("LOST");
    expect(outcomeFor("UNDER_1_5", 2, 0)).toBe("LOST");
    expect(outcomeFor("UNDER_1_5", 2, 2)).toBe("LOST");
    expect(outcomeFor("UNDER_1_5", 3, 0)).toBe("LOST");
    expect(outcomeFor("UNDER_1_5", 3, 1)).toBe("LOST");
  });
  it("4+ prolazi od 4 gola", () => {
    expect(outcomeFor("OVER_3_5", 0, 0)).toBe("LOST");
    expect(outcomeFor("OVER_3_5", 1, 0)).toBe("LOST");
    expect(outcomeFor("OVER_3_5", 1, 1)).toBe("LOST");
    expect(outcomeFor("OVER_3_5", 3, 0)).toBe("LOST");
    expect(outcomeFor("OVER_3_5", 2, 1)).toBe("LOST");
    expect(outcomeFor("OVER_3_5", 2, 2)).toBe("WON");
    expect(outcomeFor("OVER_3_5", 3, 1)).toBe("WON");
    expect(outcomeFor("OVER_3_5", 4, 0)).toBe("WON");
  });
  it("novac: ulog 1.000, kvota 4.20 → +3.200 / −1.000 / VOID 0", () => {
    const n = (x: { grossReturn: unknown; netProfit: unknown }) => [Number(x.grossReturn), Number(x.netProfit)];
    expect(n(amountsFor("WON", 1000, 4.2))).toEqual([4200, 3200]);
    expect(n(amountsFor("LOST", 1000, 4.2))).toEqual([0, -1000]);
    expect(n(amountsFor("VOID", 1000, 4.2))).toEqual([1000, 0]);
  });
  it("oznake tipova", () => {
    expect(MARKET_LABELS.UNDER_1_5).toBe("0–1");
    expect(MARKET_LABELS.OVER_3_5).toBe("4+");
  });
});

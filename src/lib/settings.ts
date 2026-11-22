import { z } from "zod";

/** Gornja granica kvote koju je korisnik potvrdio (1.30 uključujući 1.30). */
export const ABSOLUTE_MAX_ODDS = 1.3;

/** Kontra pragovi: veći od 1.00, najviše `max`, dve decimale. */
const kontraThreshold = (label: string, max: number) => z.coerce
  .number({ invalid_type_error: `${label} mora biti broj.` })
  .gt(1, `${label} mora biti veći od 1.00.`)
  .max(max, `${label} može biti najviše ${max.toFixed(2)}.`)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, { message: `${label} može imati najviše dve decimale.` });

export const settingsSchema = z.object({
  maxOdds: z.coerce
    .number({ invalid_type_error: "Kvota mora biti broj." })
    .gt(1, "Kvota mora biti veća od 1.00.")
    .max(ABSOLUTE_MAX_ODDS, "Maksimalna kvota ne može biti veća od 1.30.")
    .refine((v) => Number.isInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
      message: "Kvota može imati najviše dve decimale.",
    }),
  stakePerSelection: z.coerce
    .number({ invalid_type_error: "Ulog mora biti broj." })
    .positive("Ulog mora biti veći od 0.")
    .max(10_000_000, "Ulog je prevelik.")
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
      message: "Ulog može imati najviše dve decimale.",
    }),
  maxRequestsPerScan: z.coerce
    .number({ invalid_type_error: "Limit zahteva mora biti broj." })
    .int("Limit zahteva mora biti ceo broj.")
    .min(1, "Limit zahteva mora biti najmanje 1.")
    .max(1000, "Limit zahteva može biti najviše 1000."),
  resultCheckMinutes: z.coerce.number({ invalid_type_error: "Interval mora biti broj." }).int("Interval mora biti ceo broj.").min(5, "Interval je najmanje 5 minuta.").max(240, "Interval je najviše 240 minuta."),
  excludeGoalsPair: z.boolean().default(true),
  combineResultGoals: z.boolean().default(true),
  comboFallback: z.enum(["SKIP", "WINNER_ONLY", "BOTH_SINGLE"]).default("WINNER_ONLY"),
  kontraTriggerMax: kontraThreshold("Prag okidača", 1.5).default(1.3),
  valueMinPct: z.coerce.number({ invalid_type_error: "Najmanja vrednost mora biti broj." }).min(0.5, "Najmanja vrednost je 0.5%.").max(30, "Najmanja vrednost može biti najviše 30%.")
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, { message: "Najmanja vrednost može imati najviše dve decimale." }).default(4),
  valueMinOdds: kontraThreshold("Najmanja kvota", 20).default(1.5),
  valueMaxOdds: kontraThreshold("Najveća kvota", 50).default(5),
  apiFootballDailyCap: z.coerce.number({ invalid_type_error: "Limit mora biti broj." }).int("Limit mora biti ceo broj.").min(10, "Najmanje 10.").max(7000, "Najviše 7.000 (Pro paket: 7.500 dnevno)."),
  oddsPapiResultChecksPerDay: z.coerce.number({ invalid_type_error: "Limit mora biti broj." }).int("Limit mora biti ceo broj.").min(0, "Limit ne može biti negativan.").max(200, "Limit je najviše 200."),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

/** Prihvata i decimalni zarez („1,25“). */
export function normalizeDecimal(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim().replace(/\s/g, "").replace(",", ".");
}

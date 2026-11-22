"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { normalizeDecimal, settingsSchema } from "@/lib/settings";
import { getSettings } from "@/lib/settings-repo";

export type SettingsState = { ok?: boolean; error?: string };

export async function saveSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return { error: "Samo administrator može da menja podešavanja." };

  // skener velikih kvota: pravila osnovnog robota (maks. kvota, 2+ i 0–3, spojeni tipovi) se ne menjaju ovde
  const before = await getSettings();
  const parsed = settingsSchema.safeParse({
    maxOdds: before.maxOdds,
    stakePerSelection: normalizeDecimal(formData.get("stakePerSelection")),
    maxRequestsPerScan: normalizeDecimal(formData.get("maxRequestsPerScan")),
    resultCheckMinutes: normalizeDecimal(formData.get("resultCheckMinutes")),
    apiFootballDailyCap: normalizeDecimal(formData.get("apiFootballDailyCap")),
    oddsPapiResultChecksPerDay: normalizeDecimal(formData.get("oddsPapiResultChecksPerDay")),
    excludeGoalsPair: before.excludeGoalsPair,
    combineResultGoals: before.combineResultGoals,
    comboFallback: before.comboFallback,
    kontraTriggerMax: before.kontraTriggerMax,
    valueMinPct: normalizeDecimal(formData.get("valueMinPct")) || undefined,
    valueMinOdds: normalizeDecimal(formData.get("valueMinOdds")) || undefined,
    valueMaxOdds: normalizeDecimal(formData.get("valueMaxOdds")) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.valueMinOdds >= parsed.data.valueMaxOdds) return { error: "Najmanja kvota mora biti manja od najveće." };

  const next = parsed.data;
  const keys = ["maxOdds", "stakePerSelection", "maxRequestsPerScan", "resultCheckMinutes", "apiFootballDailyCap", "oddsPapiResultChecksPerDay", "excludeGoalsPair", "combineResultGoals", "comboFallback", "kontraTriggerMax", "valueMinPct", "valueMinOdds", "valueMaxOdds"] as const;
  if (keys.every((k) => before[k] === next[k])) return { ok: true };

  await prisma.$transaction([
    prisma.settings.update({ where: { id: 1 }, data: next }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        entityType: "Settings",
        entityId: "1",
        action: "UPDATE",
        oldValue: Object.fromEntries(keys.map((k) => [k, before[k]])),
        newValue: next,
      },
    }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

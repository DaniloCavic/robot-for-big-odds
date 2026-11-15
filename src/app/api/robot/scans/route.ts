import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings-repo";
import { periodRange, PERIODS, type PeriodKey } from "@/lib/time";
import { getProvider } from "@/lib/robot/providers";
import { markStaleScans, runScans } from "@/lib/robot/runner";
import { getScanStatus } from "@/lib/robot/scans";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  period: z.enum(Object.keys(PERIODS) as [PeriodKey, ...PeriodKey[]]),
  from: z.string().optional(),
  to: z.string().optional(),
  provider: z.string(),
  /** OSNOVNI (podrazumevano), KONTRA ili OBA – „Skeniraj oba“: jedan prolaz kroz izvor, dva skeniranja. */
  strategy: z.enum(["OSNOVNI", "KONTRA", "OBA"]).default("OSNOVNI"),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Niste prijavljeni." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Neispravan zahtev." }, { status: 400 });
  const { period, from, to, provider: providerId, strategy } = parsed.data;

  const range = periodRange(period, new Date(), { from, to });
  if ("error" in range) return Response.json({ error: range.error }, { status: 400 });

  const provider = getProvider(providerId);
  if (!provider) return Response.json({ error: "Izabrani izvor kvota nije dostupan." }, { status: 400 });

  await markStaleScans();
  const settings = await getSettings();

  const strategies = strategy === "OBA" ? (["OSNOVNI", "KONTRA"] as const) : ([strategy] as const);
  const created = await prisma.$transaction(async (tx) => {
    const running = await tx.robotScan.findFirst({ where: { status: "RUNNING" } });
    if (running) return null;
    const base = {
      userId: user.id, provider: provider.id, isDemo: provider.isDemo, periodLabel: range.label,
      startDate: range.from, endDate: range.to,
    };
    const out = [];
    for (const st of strategies) {
      out.push(await tx.robotScan.create({
        data: { ...base, strategy: st, maxOddsUsed: st === "KONTRA" ? settings.kontraTriggerMax : settings.maxOdds },
      }));
    }
    // „Oba“: Kontra skeniranje deli zahteve sa Osnovnim (zahtevi se broje samo na Osnovnom)
    if (out.length === 2) {
      await tx.robotScan.update({ where: { id: out[0].id }, data: { diagnostics: { pairedWith: out[1].id } } });
      out[1] = await tx.robotScan.update({ where: { id: out[1].id }, data: { diagnostics: { pairedWith: out[0].id, sharedRequests: true } } });
    }
    return out;
  }, { isolationLevel: "Serializable" }).catch(() => null);

  if (!created) return Response.json({ error: "Robot već radi. Sačekajte da završi ili ga zaustavite." }, { status: 409 });
  const scan = created[0];

  // Robot radi u pozadini; napredak se čita iz baze.
  void runScans(created.map((s) => s.id)).catch((e) => console.error("[robot]", e));
  const paired = created.length > 1 ? await getScanStatus(created[1].id) : null;
  return Response.json({ ...(await getScanStatus(scan.id)), paired }, { status: 201 });
}

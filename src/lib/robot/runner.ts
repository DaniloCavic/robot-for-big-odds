import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { COMBO_PARTS, COMBO_TYPES, isCombo, isValidOdds, KONTRA_TYPES, MARKET_LABELS, MARKET_TYPES, type ComboTypeCode, type MarketTypeCode } from "@/lib/odds";
import { isRealFootball } from "./football";
import { applyMatchRules, type ComboFallback } from "./rules";
import { applyKontraRules, KONTRA_DEFAULT_FAVORITE_MAX, KONTRA_DEFAULT_TRIGGER_MAX, KONTRA_SKIP_REASONS, type KontraSkipReason } from "./kontra-rules";
import { getProvider } from "./providers";
import { ProviderError, RequestLimitReached, type OddsProvider, type ProviderFixture, type ScanContext } from "./types";

/** Skeniranje koje nije javilo napredak duže od ovoga smatra se prekinutim (npr. restart servera). */
export const STALE_MS = 3 * 60_000;

export async function markStaleScans() {
  await prisma.robotScan.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: "FAILED", finishedAt: new Date(), errors: ["Skeniranje je prekinuto (restart servera ili greška)."] },
  });
}

async function appendError(scanId: string, msg: string) {
  const s = await prisma.robotScan.findUnique({ where: { id: scanId }, select: { errors: true } });
  const list = Array.isArray(s?.errors) ? (s!.errors as string[]) : [];
  await prisma.robotScan.update({ where: { id: scanId }, data: { errors: [...list, msg].slice(-20) } });
}

type Settings = Awaited<ReturnType<typeof prisma.settings.findUnique>>;
type Scan = NonNullable<Awaited<ReturnType<typeof prisma.robotScan.findUnique>>>;

/** Dijagnostika Kontra skeniranja (čuva se u RobotScan.diagnostics.kontra). */
export type KontraDiagnostics = {
  triggerMax: number;
  favoriteMax: number;
  /** Utakmice gde je 2+ ili 0–3 ispod praga. */
  withTrigger: number;
  /** Odigrani kontra tipovi. */
  played: number;
  playedByType: Record<string, number>;
  skips: Record<KontraSkipReason, number>;
  /** Koliko utakmica je imalo kvotu za 0–1 / 4+ (provera mapiranja). */
  counterOffered: Record<string, number>;
};

/** Obrada jedne (prave, u periodu) utakmice – svaka strategija ima svoju. */
type Processor = {
  scanId: string;
  handle(fx: ProviderFixture): Promise<void>;
  /** Dijagnostika koja se upisuje na kraju (spaja se sa dijagnostikom izvora). */
  finalDiagnostics(): Record<string, unknown>;
};

async function upsertMatch(provider: OddsProvider, fx: ProviderFixture) {
  return prisma.match.upsert({
    where: { provider_externalId: { provider: provider.matchNamespace ?? provider.id, externalId: fx.externalId } },
    create: {
      provider: provider.matchNamespace ?? provider.id, externalId: fx.externalId, homeTeam: fx.homeTeam, awayTeam: fx.awayTeam,
      competition: fx.competition, country: fx.country, externalCompetitionId: fx.externalCompetitionId,
      kickoffTime: fx.kickoffTime, isDemo: provider.isDemo,
    },
    update: { homeTeam: fx.homeTeam, awayTeam: fx.awayTeam, competition: fx.competition, country: fx.country, kickoffTime: fx.kickoffTime },
  });
}

/** Osnovni robot – pravila i čuvanje identični kao pre uvođenja Kontra robota. */
function osnovniProcessor(scan: Scan, provider: OddsProvider, settings: Settings): Processor {
  const scanId = scan.id;
  const maxOdds = scan.maxOddsUsed.toNumber();
  const ruleLog: { match: string; found: string[]; kept: string[]; note: string }[] = [];
  const priceCounts: Record<string, { total: number; valid: number; min: number | null }> = {};
  for (const m of MARKET_TYPES) priceCounts[m] = { total: 0, valid: 0, min: null };
  return {
    scanId,
    finalDiagnostics: () => ({ priceCounts, ruleLog }),
    async handle(fx) {
      for (const m of MARKET_TYPES) {
        const p = fx.odds[m]?.price;
        if (typeof p !== "number") continue;
        priceCounts[m].total += 1;
        priceCounts[m].min = priceCounts[m].min == null ? p : Math.min(priceCounts[m].min!, p);
      }
      const rawValid = MARKET_TYPES.filter((m) => fx.odds[m] && isValidOdds(fx.odds[m]!.price, maxOdds));
      for (const m of rawValid) priceCounts[m].valid += 1;
      const combosAvail: Partial<Record<ComboTypeCode, number>> = {};
      for (const c of COMBO_TYPES) if (fx.odds[c]) combosAvail[c] = fx.odds[c]!.price;
      const rule = applyMatchRules(rawValid, combosAvail, {
        excludeGoalsPair: settings?.excludeGoalsPair ?? true,
        combineResultGoals: settings?.combineResultGoals ?? true,
        comboFallback: (settings?.comboFallback as ComboFallback | undefined) ?? "WINNER_ONLY",
      });
      const valid: MarketTypeCode[] = [...rule.singles, ...(rule.combo ? [rule.combo] : [])];
      if ((rule.pairExcluded || rule.comboMissing || rule.combo) && ruleLog.length < 300) {
        ruleLog.push({
          match: `${fx.homeTeam} – ${fx.awayTeam}`,
          found: rawValid.map((m) => `${MARKET_LABELS[m]} @ ${fx.odds[m]!.price.toFixed(2)}`),
          kept: valid.map((m) => `${MARKET_LABELS[m]}${isCombo(m) ? ` @ ${fx.odds[m]!.price.toFixed(2)}` : ""}`),
          note: [rule.pairExcluded ? "2+ i 0–3 zajedno → izbačeni" : null, rule.combo ? "spojeni tip po kvoti izvora" : null,
            rule.comboMissing ? `nema kvote za ${MARKET_LABELS[rule.wanted!]} → kandidat za ručni unos` : null].filter(Boolean).join("; "),
        });
      }
      if (rule.pairExcluded || rule.comboMissing || rule.combo) {
        await prisma.robotScan.update({
          where: { id: scanId },
          data: {
            pairsExcluded: { increment: rule.pairExcluded ? 1 : 0 },
            comboSkipped: { increment: rule.comboMissing ? 1 : 0 },
            combosCreated: { increment: rule.combo ? 1 : 0 },
          },
        });
      }
      let created = 0;
      if (valid.length || rule.wanted) {
        const match = await upsertMatch(provider, fx);
        const res = await prisma.marketSelection.createMany({
          data: valid.map((m) => ({
            matchId: match.id, scanId, marketType: m, odds: new Prisma.Decimal(fx.odds[m]!.price),
            oddsTimestamp: fx.odds[m]!.changedAt, source: provider.sourceLabel, isDemo: provider.isDemo,
          })),
          skipDuplicates: true,
        });
        created = res.count;
        // kandidat za ručni unos spojene kvote („1&2+“ …)
        if (rule.wanted) {
          const [w, g] = COMBO_PARTS[rule.wanted];
          await prisma.comboCandidate.upsert({
            where: { scanId_matchId: { scanId, matchId: match.id } },
            create: { scanId, matchId: match.id, comboType: rule.wanted, winnerOdds: fx.odds[w]!.price, goalsOdds: fx.odds[g]!.price, source: provider.sourceLabel },
            update: {},
          });
        }
      }
      await prisma.robotScan.update({
        where: { id: scanId },
        data: { fixturesScanned: { increment: 1 }, selectionsFound: { increment: created } },
      });
    },
  };
}

/** Kontra robot – igra 0–1 umesto 2+ i 4+ umesto 0–3 (pravila u kontra-rules.ts). Spojeni tipovi i ručni unos se ne koriste. */
function kontraProcessor(scan: Scan, provider: OddsProvider): Processor {
  const scanId = scan.id;
  const kd: KontraDiagnostics = {
    triggerMax: scan.maxOddsUsed.toNumber() || KONTRA_DEFAULT_TRIGGER_MAX,
    favoriteMax: KONTRA_DEFAULT_FAVORITE_MAX,
    withTrigger: 0, played: 0,
    playedByType: Object.fromEntries(KONTRA_TYPES.map((t) => [t, 0])),
    skips: Object.fromEntries(KONTRA_SKIP_REASONS.map((r) => [r, 0])) as Record<KontraSkipReason, number>,
    counterOffered: Object.fromEntries(KONTRA_TYPES.map((t) => [t, 0])),
  };
  const kontraLog: { match: string; odds: string; decision: string }[] = [];
  const fmt = (fx: ProviderFixture, t: MarketTypeCode) => fx.odds[t] ? fx.odds[t]!.price.toFixed(2) : "—";
  return {
    scanId,
    finalDiagnostics: () => ({ kontra: kd, kontraLog }),
    async handle(fx) {
      for (const t of KONTRA_TYPES) if (fx.odds[t]) kd.counterOffered[t] += 1;
      const d = applyKontraRules(
        { HOME: fx.odds.HOME, AWAY: fx.odds.AWAY, OVER_1_5: fx.odds.OVER_1_5, UNDER_3_5: fx.odds.UNDER_3_5, UNDER_1_5: fx.odds.UNDER_1_5, OVER_3_5: fx.odds.OVER_3_5 },
        { triggerMax: kd.triggerMax, favoriteMax: kd.favoriteMax },
      );
      let created = 0;
      if (d.pick || d.skipReason) {
        kd.withTrigger += 1;
        if (d.skipReason) kd.skips[d.skipReason] += 1;
        if (kontraLog.length < 300) {
          kontraLog.push({
            match: `${fx.homeTeam} – ${fx.awayTeam}`,
            odds: `1 ${fmt(fx, "HOME")} · 2 ${fmt(fx, "AWAY")} · 2+ ${fmt(fx, "OVER_1_5")} · 0–3 ${fmt(fx, "UNDER_3_5")} · 0–1 ${fmt(fx, "UNDER_1_5")} · 4+ ${fmt(fx, "OVER_3_5")}`,
            decision: d.pick ? `${MARKET_LABELS[d.pick]} @ ${d.odds!.toFixed(2)}` : `preskok: ${d.skipReason}`,
          });
        }
      }
      if (d.pick) {
        const match = await upsertMatch(provider, fx);
        const res = await prisma.marketSelection.createMany({
          data: [{
            matchId: match.id, scanId, marketType: d.pick, odds: new Prisma.Decimal(d.odds!),
            triggerOdds: new Prisma.Decimal(d.triggerOdds!),
            oddsTimestamp: fx.odds[d.pick]!.changedAt, source: provider.sourceLabel, isDemo: provider.isDemo,
          }],
          skipDuplicates: true,
        });
        created = res.count;
        if (created) { kd.played += 1; kd.playedByType[d.pick] += 1; }
      }
      await prisma.robotScan.update({
        where: { id: scanId },
        data: {
          fixturesScanned: { increment: 1 }, selectionsFound: { increment: created },
          // brojevi preskoka su vidljivi i dok skeniranje traje
          ...(d.pick || d.skipReason ? { diagnostics: JSON.parse(JSON.stringify({ ...(scan.diagnostics as object), kontra: kd })) } : {}),
        },
      });
    },
  };
}

/** Pokreće skeniranje. Ne baca grešku – sve greške se upisuju u RobotScan. */
export async function runScan(scanId: string): Promise<void> {
  return runScans([scanId]);
}

/**
 * Pokreće jedno ili više skeniranja (npr. „Skeniraj oba“: Osnovni + Kontra) iz JEDNOG prolaza kroz izvor –
 * isti odgovor kladionice služi svim strategijama, pa se OddsPapi zahtevi ne dupliraju.
 * Sva skeniranja moraju imati isti izvor i period. Zahtevi se broje na prvom skeniranju.
 */
export async function runScans(scanIds: string[]): Promise<void> {
  const scans = (await Promise.all(scanIds.map((id) => prisma.robotScan.findUnique({ where: { id } }))))
    .filter((s): s is Scan => !!s && s.status === "RUNNING");
  if (!scans.length) return;
  const ids = scans.map((s) => s.id);
  const primary = scans[0];
  const provider = getProvider(primary.provider);
  if (!provider) {
    await prisma.robotScan.updateMany({ where: { id: { in: ids } }, data: { status: "FAILED", finishedAt: new Date(), errors: ["Izvor kvota nije dostupan."] } });
    return;
  }
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const processors = scans.map((s) => (s.strategy === "KONTRA" ? kontraProcessor(s, provider) : osnovniProcessor(s, provider, settings)));

  const diag: Record<string, unknown> = {};
  let lastStopCheck = 0;
  let stop = false;
  const ctx: ScanContext = {
    maxRequests: settings?.maxRequestsPerScan ?? 60,
    async shouldStop() {
      if (stop) return true;
      if (Date.now() - lastStopCheck < 500) return false;
      lastStopCheck = Date.now();
      // STOP na bilo kom od povezanih skeniranja zaustavlja sva
      const s = await prisma.robotScan.findFirst({ where: { id: { in: ids }, stopRequested: true }, select: { id: true } });
      stop = !!s;
      return stop;
    },
    async setTotal(n) {
      await prisma.robotScan.updateMany({ where: { id: { in: ids } }, data: { fixturesTotal: n } });
    },
    async countRequest() {
      await prisma.robotScan.update({ where: { id: primary.id }, data: { requestsUsed: { increment: 1 } } });
    },
    async warn(msg) {
      for (const id of ids) await appendError(id, msg);
    },
    async diagnostic(data) {
      Object.assign(diag, data);
    },
  };

  let finalStatus: "COMPLETED" | "STOPPED" | "FAILED" = "COMPLETED";
  try {
    for await (const fx of provider.scan({ from: primary.startDate, to: primary.endDate }, ctx)) {
      const inRange = fx.kickoffTime >= primary.startDate && fx.kickoffTime < primary.endDate;
      if (!inRange || !isRealFootball(fx)) {
        await prisma.robotScan.updateMany({ where: { id: { in: ids } }, data: { fixturesScanned: { increment: 1 }, fixturesExcluded: { increment: 1 } } });
        continue;
      }
      for (const p of processors) await p.handle(fx);
    }
    if (await ctx.shouldStop()) finalStatus = "STOPPED";
  } catch (e) {
    if (e instanceof RequestLimitReached) {
      finalStatus = "STOPPED";
      for (const id of ids) await appendError(id, e.message);
    } else {
      finalStatus = "FAILED";
      const msg = e instanceof ProviderError ? e.message : "Neočekivana greška robota.";
      log.error("robot", "skeniranje palo", { scanIds: ids, error: (e as Error).message });
      for (const id of ids) await appendError(id, msg);
    }
  }
  for (const [k, p] of processors.entries()) {
    const own = (scans[k].diagnostics ?? {}) as Record<string, unknown>;
    await prisma.robotScan.update({
      where: { id: p.scanId },
      data: { status: finalStatus, finishedAt: new Date(), diagnostics: JSON.parse(JSON.stringify({ ...own, ...diag, ...p.finalDiagnostics() })) },
    });
  }
}

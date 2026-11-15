import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CandidateRow, StatRow } from "./compute";

export type StatQuery = {
  from?: Date | null;
  to?: Date | null;
  /** active = samo tipovi u aktivnim filterima; all = i uklonjeni/obrisani (istorija) */
  scope: "active" | "all";
  includeDemo: boolean;
  filterSetId?: string | null;
  /** OSNOVNI / KONTRA / SVE (podrazumevano OSNOVNI – stari podaci su Osnovni) */
  strategy?: "OSNOVNI" | "KONTRA" | "SVE";
};

export async function loadStatRows(q: StatQuery): Promise<StatRow[]> {
  const strategy = q.strategy ?? "OSNOVNI";
  const where: Prisma.FilterSetSelectionWhereInput = {
    ...(q.scope === "active" ? { removedAt: null } : {}),
    filterSet: {
      ...(q.scope === "active" ? { status: { not: "DELETED" } } : {}),
      ...(strategy === "SVE" ? {} : { strategy }),
    },
    ...(q.filterSetId ? { filterSetId: q.filterSetId } : {}),
    marketSelection: { excludedReason: null, ...(q.includeDemo ? {} : { isDemo: false }) },
    trackedSelection: {
      match: {
        kickoffTime: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) },
      },
    },
  };
  const rows = await prisma.filterSetSelection.findMany({
    where,
    include: { filterSet: { select: { id: true, name: true, strategy: true } }, trackedSelection: { include: { match: true } }, marketSelection: { select: { triggerOdds: true } } },
  });
  return rows.map((r) => ({
    status: r.settlementStatus,
    marketType: r.trackedSelection.marketType,
    odds: r.oddsSnapshot.toNumber(),
    stake: r.stake.toNumber(),
    gross: r.grossReturn?.toNumber() ?? null,
    net: r.netProfit?.toNumber() ?? null,
    kickoff: r.trackedSelection.match.kickoffTime.toISOString(),
    competition: r.trackedSelection.match.competition,
    country: r.trackedSelection.match.country,
    filterSetId: r.filterSet.id,
    filterSetName: r.filterSet.name,
    match: `${r.trackedSelection.match.homeTeam} – ${r.trackedSelection.match.awayTeam}`,
    home: r.trackedSelection.finalHomeScore,
    away: r.trackedSelection.finalAwayScore,
    strategy: r.filterSet.strategy,
    triggerOdds: r.marketSelection.triggerOdds?.toNumber() ?? null,
  }));
}

/** Kandidati za spojeni tip u periodu (po utakmici – poslednji kandidat), sa rezultatom utakmice ako je poznat. */
export async function loadCandidateRows(q: Pick<StatQuery, "from" | "to" | "includeDemo">): Promise<CandidateRow[]> {
  const rows = await prisma.comboCandidate.findMany({
    where: {
      match: {
        kickoffTime: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) },
        ...(q.includeDemo ? {} : { isDemo: false }),
      },
    },
    include: { match: true },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Set<string>();
  const out: CandidateRow[] = [];
  for (const r of rows) {
    if (seen.has(r.matchId)) continue;
    seen.add(r.matchId);
    out.push({
      matchId: r.matchId, comboType: r.comboType, winnerOdds: r.winnerOdds.toNumber(), goalsOdds: r.goalsOdds.toNumber(),
      home: r.match.finalHomeScore, away: r.match.finalAwayScore,
    });
  }
  return out;
}

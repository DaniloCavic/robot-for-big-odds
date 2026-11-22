import { Prisma, type PrismaClient } from "@prisma/client";
import { isCombo, isKontra, isValidOdds, MARKET_LABELS, type MarketTypeCode } from "@/lib/odds";
import { KONTRA_MIN_ODDS } from "@/lib/robot/kontra-rules";

export type StrategyCode = "OSNOVNI" | "KONTRA" | "VALUE";
export const STRATEGY_LABELS: Record<StrategyCode, string> = { OSNOVNI: "Osnovni", KONTRA: "Kontra", VALUE: "Value" };

type Db = PrismaClient | Prisma.TransactionClient;

export class FilterError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export const NAME_MAX = 80;

export function cleanName(raw: unknown): string {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new FilterError("Unesite naziv filtera.");
  if (name.length > NAME_MAX) throw new FilterError(`Naziv može imati najviše ${NAME_MAX} znakova.`);
  return name;
}

export async function listFilterSets(db: Db, strategy?: StrategyCode) {
  const sets = await db.filterSet.findMany({
    where: { status: { not: "DELETED" }, ...(strategy ? { strategy } : {}) },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entries: { where: { removedAt: null } } } } },
  });
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    strategy: s.strategy as StrategyCode,
    status: s.status,
    stakePerSelection: s.stakePerSelection.toNumber(),
    currency: s.currency,
    createdAt: s.createdAt.toISOString(),
    count: s._count.entries,
  }));
}
export type FilterSetDto = Awaited<ReturnType<typeof listFilterSets>>[number];

export async function createFilterSet(db: Db, input: { name: unknown; userId: string | null; stake: number; strategy?: unknown }) {
  const name = cleanName(input.name);
  const strategy = input.strategy ?? "OSNOVNI";
  if (strategy !== "OSNOVNI" && strategy !== "KONTRA" && strategy !== "VALUE") throw new FilterError("Nepoznata strategija filtera.");
  const set = await db.filterSet.create({ data: { name, userId: input.userId, stakePerSelection: input.stake, strategy } });
  return set.id;
}

export async function getActiveSet(db: Db, id: string) {
  const set = await db.filterSet.findUnique({ where: { id } });
  if (!set || set.status === "DELETED") throw new FilterError("Filter ne postoji.", 404);
  return set;
}

export async function renameFilterSet(db: Db, id: string, name: unknown) {
  await getActiveSet(db, id);
  await db.filterSet.update({ where: { id }, data: { name: cleanName(name) } });
}

/** Brisanje filtera je "meko": nestaje iz prikaza, a zapisi (i kasnija statistika) ostaju. */
export async function deleteFilterSet(db: PrismaClient, id: string, userId: string | null) {
  const set = await getActiveSet(db, id);
  await db.$transaction([
    db.filterSet.update({ where: { id }, data: { status: "DELETED" } }),
    db.auditLog.create({ data: { userId, entityType: "FilterSet", entityId: id, action: "DELETE", oldValue: { name: set.name } } }),
  ]);
}

export async function listEntries(db: Db, filterSetId: string) {
  await getActiveSet(db, filterSetId);
  const rows = await db.filterSetSelection.findMany({
    where: { filterSetId, removedAt: null },
    include: { trackedSelection: { include: { match: true } }, marketSelection: true },
    orderBy: [{ trackedSelection: { match: { kickoffTime: "asc" } } }, { addedAt: "asc" }],
  });
  return rows.map((r) => {
    const m = r.trackedSelection.match;
    const type = r.trackedSelection.marketType as MarketTypeCode;
    return {
      id: r.id,
      marketSelectionId: r.marketSelectionId,
      trackedSelectionId: r.trackedSelectionId,
      matchId: m.id,
      marketType: type,
      label: MARKET_LABELS[type],
      odds: r.oddsSnapshot.toNumber(),
      fairOdds: r.marketSelection.fairOdds?.toNumber() ?? null,
      valuePct: r.marketSelection.valuePct?.toNumber() ?? null,
      stake: r.stake.toNumber(),
      status: r.settlementStatus,
      grossReturn: r.grossReturn?.toNumber() ?? null,
      netProfit: r.netProfit?.toNumber() ?? null,
      home: r.trackedSelection.finalHomeScore,
      away: r.trackedSelection.finalAwayScore,
      source: r.marketSelection.source,
      isDemo: r.marketSelection.isDemo,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      competition: m.competition,
      country: m.country,
      kickoffTime: m.kickoffTime.toISOString(),
      addedAt: r.addedAt.toISOString(),
    };
  });
}
export type FilterEntryDto = Awaited<ReturnType<typeof listEntries>>[number];

/**
 * Dodaje jedan tip u filter. Pravila:
 * - utakmica ne sme da je počela, kvota mora da poštuje pravilo ≤ maxOdds (backend);
 * - isti tip iste utakmice ne može dva puta u isti filter (različiti tipovi iste utakmice mogu);
 * - kvota i ulog se zaključavaju u trenutku dodavanja.
 */
export async function addEntry(db: PrismaClient, input: { filterSetId: string; marketSelectionId: string; maxOdds: number; now?: Date; excludeGoalsPair?: boolean }) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const set = await getActiveSet(tx, input.filterSetId);
    const ms = await tx.marketSelection.findUnique({ where: { id: input.marketSelectionId }, include: { match: true } });
    if (!ms) throw new FilterError("Tip ne postoji.", 404);
    if (ms.excludedReason) throw new FilterError("Ovaj tip je izbačen pravilom (2+ i 0–3 za istu utakmicu).");
    // Value filter: samo tipovi koje je našao value robot (imaju vrednost u odnosu na Pinnacle), po kvoti kladionice
    const valueTip = ms.valuePct != null;
    if (set.strategy === "VALUE" || valueTip) {
      if (set.strategy !== "VALUE") throw new FilterError("Value tipovi idu samo u Value filter.");
      if (!valueTip) throw new FilterError("Value filter prima samo tipove koje je našao value robot.");
      if (ms.match.kickoffTime <= now) throw new FilterError("Utakmica je već počela – tip ne može da se doda.");
      if (!(ms.odds.toNumber() > 1)) throw new FilterError("Neispravna kvota.");
    } else {
      // Filter pripada jednoj strategiji: kontra tipovi (0–1, 4+) samo u Kontra filter, ostali samo u Osnovni
      const kontraType = isKontra(ms.marketType);
      if (set.strategy === "KONTRA" && !kontraType) throw new FilterError(`Kontra filter prima samo 0–1 i 4+ (ovo je ${MARKET_LABELS[ms.marketType as MarketTypeCode]}).`);
      if (set.strategy !== "KONTRA" && kontraType) throw new FilterError("Kontra tipovi (0–1, 4+) idu samo u Kontra filter – napravite filter sa strategijom Kontra.");
      if (kontraType) {
        const other = ms.marketType === "UNDER_1_5" ? "OVER_3_5" : "UNDER_1_5";
        const clash = await tx.filterSetSelection.findFirst({
          where: { filterSetId: set.id, removedAt: null, trackedSelection: { matchId: ms.matchId, marketType: other } },
        });
        if (clash) throw new FilterError("Ova utakmica već ima drugi kontra tip u filteru – igra se najviše jedan kontra tip po utakmici.");
      }
      if (!isCombo(ms.marketType)) {
        const combo = await tx.filterSetSelection.findFirst({
          where: { filterSetId: set.id, removedAt: null, trackedSelection: { matchId: ms.matchId, marketType: { in: ["HOME_OVER_1_5", "HOME_UNDER_3_5", "AWAY_OVER_1_5", "AWAY_UNDER_3_5"] } } },
        });
        if (combo) throw new FilterError("Ova utakmica je u filteru kao spojeni tip – pojedinačni tip se ne dodaje.");
      }
      if (input.excludeGoalsPair !== false && (ms.marketType === "OVER_1_5" || ms.marketType === "UNDER_3_5")) {
        const other = ms.marketType === "OVER_1_5" ? "UNDER_3_5" : "OVER_1_5";
        const clash = await tx.filterSetSelection.findFirst({
          where: { filterSetId: set.id, removedAt: null, trackedSelection: { matchId: ms.matchId, marketType: other } },
        });
        if (clash) throw new FilterError("Ova utakmica već ima suprotan tip golova (2+ / 0–3) u filteru – takve utakmice se ne igraju.");
      }
      if (ms.match.kickoffTime <= now) throw new FilterError("Utakmica je već počela – tip ne može da se doda.");
      const odds = ms.odds.toNumber();
      // kontra tipovi (0–1, 4+): bez gornje granice, najmanje 1.01
      if (kontraType && odds < KONTRA_MIN_ODDS - 1e-9) throw new FilterError(`Kvota ${odds.toFixed(2)} je ispod najmanje dozvoljene ${KONTRA_MIN_ODDS.toFixed(2)} za kontra tip.`);
      // pojedinačni tipovi: do maks. kvote; spojeni tipovi („1&2+“…): bez ograničenja, samo veća od 1.00
      if (!kontraType && (isCombo(ms.marketType) ? !(odds > 1) : !isValidOdds(odds, input.maxOdds))) {
        throw new FilterError(`Kvota ${odds.toFixed(2)} je iznad dozvoljene ${input.maxOdds.toFixed(2)}.`);
      }
    }

    const type = ms.marketType as MarketTypeCode;
    const tracked = await tx.trackedSelection.upsert({
      where: { matchId_marketType: { matchId: ms.matchId, marketType: ms.marketType } },
      create: { matchId: ms.matchId, marketSelectionId: ms.id, marketType: ms.marketType, selection: MARKET_LABELS[type], originalOdds: ms.odds },
      update: {},
    });

    const existing = await tx.filterSetSelection.findUnique({
      where: { filterSetId_trackedSelectionId: { filterSetId: set.id, trackedSelectionId: tracked.id } },
    });
    if (existing && !existing.removedAt) throw new FilterError("Ovaj tip je već u filteru.", 409);
    const data = { marketSelectionId: ms.id, oddsSnapshot: ms.odds, stake: set.stakePerSelection, addedAt: now, removedAt: null };
    const entry = existing
      ? await tx.filterSetSelection.update({ where: { id: existing.id }, data })
      : await tx.filterSetSelection.create({ data: { ...data, filterSetId: set.id, trackedSelectionId: tracked.id } });
    return entry.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export const BULK_MAX = 500;

/** Dodaje više tipova odjednom. Tipove koji ne mogu (duplikat, počela, kvota) preskače i prijavljuje. */
export async function addEntries(db: PrismaClient, input: { filterSetId: string; marketSelectionIds: string[]; maxOdds: number; now?: Date; excludeGoalsPair?: boolean }) {
  const ids = [...new Set(input.marketSelectionIds)];
  if (ids.length === 0) throw new FilterError("Nema tipova za dodavanje.");
  if (ids.length > BULK_MAX) throw new FilterError(`Najviše ${BULK_MAX} tipova odjednom.`);
  const result: { added: number; duplicate: number; started: number; invalid: number; pair?: number; strategy?: number } = { added: 0, duplicate: 0, started: 0, invalid: 0 };
  for (const id of ids) {
    try {
      await addEntry(db, { filterSetId: input.filterSetId, marketSelectionId: id, maxOdds: input.maxOdds, now: input.now, excludeGoalsPair: input.excludeGoalsPair });
      result.added += 1;
    } catch (e) {
      if (!(e instanceof FilterError)) throw e;
      if (e.status === 404 && /Filter/.test(e.message)) throw e;
      if (e.status === 409) result.duplicate += 1;
      else if (/počela/.test(e.message)) result.started += 1;
      else if (/2\+ \/ 0–3|izbačen pravilom|spojeni tip|drugi kontra tip/.test(e.message)) result.pair = (result.pair ?? 0) + 1;
      else if (/Kontra filter|Kontra tipovi|Value filter|Value tipovi/.test(e.message)) result.strategy = (result.strategy ?? 0) + 1;
      else result.invalid += 1;
    }
  }
  return result;
}

export async function removeEntry(db: Db, filterSetId: string, entryId: string) {
  await getActiveSet(db, filterSetId);
  const res = await db.filterSetSelection.updateMany({ where: { id: entryId, filterSetId, removedAt: null }, data: { removedAt: new Date() } });
  if (res.count === 0) throw new FilterError("Tip nije u filteru.", 404);
}

export async function clearFilterSet(db: PrismaClient, filterSetId: string, userId: string | null) {
  await getActiveSet(db, filterSetId);
  const [res] = await db.$transaction([
    db.filterSetSelection.updateMany({ where: { filterSetId, removedAt: null }, data: { removedAt: new Date() } }),
    db.auditLog.create({ data: { userId, entityType: "FilterSet", entityId: filterSetId, action: "CLEAR" } }),
  ]);
  return res.count;
}

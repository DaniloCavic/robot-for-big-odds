import Link from "next/link";
import { PageHeader, StatCard, Card, EmptyState } from "@/components/ui";
import { IconRobot } from "@/components/icons";
import { getSettings } from "@/lib/settings-repo";
import { formatDateTime, formatOdds, formatRsd } from "@/lib/format";
import { recentScans } from "@/lib/robot/scans";
import { prisma } from "@/lib/db";
import { activeEntriesWhere, entrySummary } from "@/lib/results/queries";

export default async function DashboardPage() {
  // value betting: samo Value filteri
  const kontra = { removedAt: null, filterSet: { status: { not: "DELETED" as const }, strategy: "VALUE" as const } };
  const [settings, [last], active, planned, sum] = await Promise.all([
    getSettings(),
    recentScans(1),
    prisma.trackedSelection.count({ where: { status: { in: ["PENDING", "LIVE"] }, filterEntries: { some: kontra } } }),
    prisma.filterSetSelection.aggregate({ where: { ...kontra, settlementStatus: { in: ["PENDING", "LIVE"] } }, _sum: { stake: true } }),
    entrySummary({ ...activeEntriesWhere, filterSet: { status: { not: "DELETED" }, strategy: "VALUE" } }),
  ]);
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Value betting – AdmiralBet naspram Pinnacle-a.">
        <Link href="/robot" className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-bg hover:bg-accent-strong">
          <IconRobot /> START ROBOT
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Aktivne selekcije" value={String(active)} hint={`Na čekanju i uživo · planirani ulog ${formatRsd(planned._sum.stake?.toNumber() ?? 0)}`} tone="live" />
        <StatCard label="Završeni tipovi" value={String(sum.won + sum.lost + sum.void)} hint={`Prošlo / palo: ${sum.won} / ${sum.lost}${sum.void ? ` · vraćeno ${sum.void}` : ""}`} />
        <StatCard label="Prolaznost" value={sum.passRate == null ? "—" : `${sum.passRate.toFixed(1)}%`} hint="WON / (WON + LOST)" tone="won" />
        <StatCard label="Neto profit / gubitak" value={(sum.netProfit > 0 ? "+" : "") + formatRsd(sum.netProfit)} hint={`Uloženo ${formatRsd(sum.settledStake)} · ${formatRsd(settings.stakePerSelection)} po tipu`} tone={sum.netProfit > 0 ? "won" : sum.netProfit < 0 ? "lost" : "default"} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 font-semibold">Poslednje skeniranje</h2>
          {last ? (
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-muted">Vreme</dt><dd className="mt-1 font-medium">{formatDateTime(new Date(last.startedAt))}</dd></div>
              <div><dt className="text-muted">Period</dt><dd className="mt-1 font-medium">{last.periodLabel}{last.isDemo && <span className="ml-2 rounded bg-live/20 px-1.5 text-[10px] font-bold text-live">DEMO</span>}</dd></div>
              <div><dt className="text-muted">Pregledano utakmica</dt><dd className="mt-1 font-medium tabular-nums">{last.fixturesScanned}</dd></div>
              <div><dt className="text-muted">Pronađeno selekcija</dt><dd className="mt-1 font-medium tabular-nums">{last.selectionsFound}</dd></div>
            </dl>
          ) : (
            <EmptyState title="Još nema skeniranja" text="Robot se pokreće isključivo ručno, dugmetom START ROBOT." />
          )}
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Pravila</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">Referenca</dt><dd className="font-medium">Pinnacle bez marže</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Najmanja vrednost</dt><dd className="font-medium tabular-nums">{settings.valueMinPct}%</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Kvote</dt><dd className="font-medium tabular-nums">{formatOdds(settings.valueMinOdds)}–{formatOdds(settings.valueMaxOdds)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Tipovi</dt><dd className="font-medium">1, X, 2, 1X, X2, 12, golovi</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Ulog po tipu</dt><dd className="font-medium tabular-nums">{formatRsd(settings.stakePerSelection)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Sport</dt><dd className="font-medium">Samo pravi fudbal</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Vremenska zona</dt><dd className="font-medium">{settings.timezone}</dd></div>
          </dl>
        </Card>
      </div>
    </>
  );
}

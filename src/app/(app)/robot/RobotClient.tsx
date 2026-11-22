"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { IconRobot } from "@/components/icons";
import type { ScanStatusDto, SelectionDto } from "@/lib/robot/scans";

type Provider = { id: string; name: string; isDemo: boolean; available: boolean; reason?: string; bookmakerSlug?: string };
type SourceStatus = { similar?: string[]; configured: boolean; ok?: boolean; error?: string; requestLimit?: number | null; requestCount?: number | null; hasSoccerbet?: boolean | null; hasFootball?: boolean | null; bookmakers?: string[] | null };

const PERIODS = [
  ["today", "Danas"],
  ["tomorrow", "Sutra"],
  ["next3", "Naredna 3 dana"],
  ["next7", "Narednih 7 dana"],
  ["custom", "Prilagođeni period"],
] as const;
type PeriodKey = (typeof PERIODS)[number][0];

const VALUE_LABELS = ["1", "X", "2", "1X", "X2", "12", "2+", "0–1", "3+", "0–2", "4+", "0–3"] as const;

const STATUS_LABEL: Record<ScanStatusDto["status"], [string, string]> = {
  RUNNING: ["Radi", "bg-live/15 text-live"],
  COMPLETED: ["Završeno", "bg-won/15 text-won"],
  STOPPED: ["Zaustavljeno", "bg-pending/15 text-pending"],
  FAILED: ["Greška", "bg-lost/15 text-lost"],
};

const fmt = new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: "Europe/Belgrade", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtTime = new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("sr-Latn-RS", { timeZone: "Europe/Belgrade", weekday: "short", day: "2-digit", month: "2-digit" });

function DemoBadge() {
  return <span className="rounded-md bg-live/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-live">DEMO</span>;
}

export function RobotClient({ providers: serverProviders, initialScans, today, maxRequests, valueRules = { minValuePct: 4, minOdds: 1.5, maxOdds: 5 } }: {
  providers: Provider[]; initialScans: ScanStatusDto[]; today: string; maxRequests: number;
  valueRules?: { minValuePct: number; minOdds: number; maxOdds: number };
}) {
  const [source, setSource] = useState<SourceStatus | null>(null);
  const [touched, setTouched] = useState(false);
  // Ako provera naloga kaže da ključ radi, OddsPapi je dostupan i bez osvežavanja stranice.
  const providers = useMemo(() => serverProviders.map((p) => {
    if (p.isDemo || !source?.configured || !source.ok) return p;
    const inPlan = !source.bookmakers || !p.bookmakerSlug || source.bookmakers.includes(p.bookmakerSlug);
    return inPlan ? { ...p, available: true, reason: undefined } : { ...p, available: false, reason: "Nije u vašem OddsPapi paketu" };
  }), [serverProviders, source]);
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const firstAvailable = providers.find((p) => p.available && !p.isDemo) ?? providers.find((p) => p.available)!;
  const [providerId, setProviderId] = useState(firstAvailable.id);
  const [scans, setScans] = useState(initialScans);
  const [current, setCurrent] = useState<ScanStatusDto | null>(initialScans[0] ?? null);
  const [selections, setSelections] = useState<SelectionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [sort, setSort] = useState<"time" | "odds">("time");

  const running = current?.status === "RUNNING";

  useEffect(() => {
    if (touched || running) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("fos.robot.provider"); } catch {}
    const pick = providers.find((p) => p.id === saved && p.available) ?? providers.find((p) => !p.isDemo && p.available);
    if (pick && providerId !== pick.id) setProviderId(pick.id);
  }, [providers, touched, running, providerId]);

  useEffect(() => {
    const p = providers.find((x) => x.id === providerId);
    if (p && !p.available) setProviderId(providers.find((x) => x.available)!.id);
  }, [providers, providerId]);

  const loadSelections = useCallback(async (id: string) => {
    const r = await fetch(`/api/robot/scans/${id}/selections`, { cache: "no-store" });
    if (r.ok) setSelections(await r.json());
  }, []);

  useEffect(() => {
    fetch("/api/robot/source-status", { cache: "no-store" }).then((r) => r.json()).then(setSource).catch(() => setSource(null));
  }, []);

  useEffect(() => {
    if (current) loadSelections(current.id);
    else setSelections([]);
  }, [current?.id, loadSelections]); // eslint-disable-line react-hooks/exhaustive-deps

  // Praćenje napretka dok robot radi
  useEffect(() => {
    if (!running || !current) return;
    let tick = 0;
    const iv = setInterval(async () => {
      tick += 1;
      const r = await fetch(`/api/robot/scans/${current.id}`, { cache: "no-store" });
      if (!r.ok) return;
      const s: ScanStatusDto = await r.json();
      setCurrent(s);
      setScans((list) => list.map((x) => (x.id === s.id ? s : x)));
      if (s.status !== "RUNNING" || tick % 3 === 0) loadSelections(s.id);
      if (s.status !== "RUNNING") {
        fetch("/api/robot/source-status", { cache: "no-store" }).then((x) => x.json()).then(setSource).catch(() => {});
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [running, current?.id, loadSelections]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/robot/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, from, to, provider: providerId }),
      });
      const data = await r.json();
      if (!r.ok) return setError(data.error ?? "Greška pri pokretanju.");
      const main = data as ScanStatusDto;
      setCurrent(main);
      setSelections([]);
      setTypes([]);
      setScans((list) => [main, ...list].slice(0, 5));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!current) return;
    setBusy(true);
    const r = await fetch(`/api/robot/scans/${current.id}/stop`, { method: "POST" });
    if (r.ok) setCurrent(await r.json());
    setBusy(false);
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = selections.filter((s) =>
      (!needle || [s.homeTeam, s.awayTeam, s.competition, s.country ?? ""].some((f) => f.toLowerCase().includes(needle))) &&
      (types.length === 0 || types.includes(s.label)));
    return [...rows].sort((a, b) => (sort === "odds" ? a.odds - b.odds : a.kickoffTime.localeCompare(b.kickoffTime)));
  }, [selections, q, types, sort]);

  const grouped = useMemo(() => {
    if (sort === "odds") return null;
    const m = new Map<string, SelectionDto[]>();
    for (const s of filtered) m.set(s.matchId, [...(m.get(s.matchId) ?? []), s]);
    return [...m.values()];
  }, [filtered, sort]);

  const pct = current?.fixturesTotal ? Math.min(100, Math.round((current.fixturesScanned / current.fixturesTotal) * 100)) : running ? 5 : 100;
  const selectedProvider = providers.find((p) => p.id === providerId);

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <h2 className="mb-3 font-semibold">Period</h2>
            <div className="flex flex-wrap gap-2">
              {PERIODS.map(([key, label]) => (
                <button key={key} type="button" disabled={running} onClick={() => setPeriod(key)} aria-pressed={period === key}
                  className={`rounded-xl border px-4 py-2 text-sm transition ${period === key ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted hover:text-text"} disabled:opacity-50`}>
                  {label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="mt-4 flex flex-wrap gap-3">
                <label className="text-sm text-muted">Od
                  <input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} disabled={running}
                    className="ml-2 rounded-lg border border-line bg-bg px-2 py-1.5 text-text [color-scheme:dark]" />
                </label>
                <label className="text-sm text-muted">Do
                  <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} disabled={running}
                    className="ml-2 rounded-lg border border-line bg-bg px-2 py-1.5 text-text [color-scheme:dark]" />
                </label>
              </div>
            )}

            <h2 className="mb-1 mt-6 font-semibold">Kladionica (izvor kvota)</h2>
            <p className="mb-3 text-xs text-muted">Kvote preko OddsPapi. Kladionice se razlikuju po broju utakmica i tipova – pogledajte „Dijagnostiku izvora“ posle skeniranja.</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {providers.map((p) => (
                <label key={p.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${providerId === p.id ? "border-accent/60 bg-accent/5" : "border-line"} ${!p.available ? "cursor-not-allowed opacity-50" : ""}`}>
                  <input type="radio" name="provider" value={p.id} checked={providerId === p.id} disabled={!p.available || running}
                    onChange={() => { setTouched(true); setProviderId(p.id); try { localStorage.setItem("fos.robot.provider", p.id); } catch {} }} className="mt-0.5 accent-[var(--color-accent)]" />
                  <span>
                    <span className="flex items-center gap-2 font-medium">{p.name} {p.isDemo && <DemoBadge />}</span>
                    {p.reason && <span className="block text-xs text-muted">{p.reason}</span>}
                    {p.isDemo ? <span className="block text-xs text-muted">Izmišljene utakmice, samo za probu toka.</span>
                      : !p.reason && <span className="block text-xs text-muted">preko OddsPapi</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <SourceBox source={source} maxRequests={maxRequests} />
            {source?.configured && source.ok && <CompareBox />}
            <ReferenceProbeBox />
          </div>
        </div>

        {error && <p role="alert" className="mt-5 rounded-lg bg-lost/10 px-3 py-2 text-sm text-lost">{error}</p>}

        <p className="mt-6 rounded-xl border border-line bg-panel-2/50 px-4 py-3 text-sm text-muted" data-testid="rules-info">
          AdmiralBet kvote se porede sa <b className="text-text">Pinnacle</b> kvotama bez marže („poštena“ kvota, API-Football).
          Tip ulazi ako je AdmiralBet kvota bar <b className="text-accent">{valueRules.minValuePct}%</b> veća od poštene i između {valueRules.minOdds.toFixed(2)} i {valueRules.maxOdds.toFixed(2)}.
          Tipovi: 1, X, 2, 1X, X2, 12 i golovi 2+/0–1, 3+/0–2, 4+/0–3 – najviše jedan tip ishoda i jedan tip golova po utakmici. Pravila: Podešavanja.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!running ? (
            <button type="button" onClick={start} disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-accent py-5 text-xl font-bold tracking-wide text-bg shadow-lg shadow-accent/20 transition hover:bg-accent-strong disabled:opacity-60 sm:w-auto sm:px-14">
              <IconRobot className="h-7 w-7" /> START ROBOT
            </button>
          ) : (
            <button type="button" onClick={stop} disabled={busy || current?.stopRequested}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-lost py-5 text-xl font-bold tracking-wide text-white transition hover:bg-lost/80 disabled:opacity-60 sm:w-auto sm:px-14">
              ■ {current?.stopRequested ? "ZAUSTAVLJAM…" : "STOP"}
            </button>
          )}
          {selectedProvider?.isDemo && !running && <span className="text-sm text-live">Pokrećete DEMO skeniranje, podaci nisu stvarni.</span>}
        </div>
      </Card>

      {current && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold">
              Skeniranje: {current.periodLabel} · {current.providerName} {current.isDemo && <DemoBadge />}
            </h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_LABEL[current.status][1]}`} data-testid="scan-status">
              {STATUS_LABEL[current.status][0]}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel-2">
            <div className={`h-full rounded-full bg-accent transition-all ${running ? "animate-pulse" : ""}`} style={{ width: `${pct}%` }} />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Početak" value={fmtTime.format(new Date(current.startedAt))} />
            <Stat label="Kraj" value={current.finishedAt ? fmtTime.format(new Date(current.finishedAt)) : "—"} />
            <Stat label="Pregledano utakmica" value={`${current.fixturesScanned}${current.fixturesTotal != null ? ` / ${current.fixturesTotal}` : ""}`} testId="scanned" />
            <Stat label="Izbačeno (virtuelno i sl.)" value={String(current.fixturesExcluded)} />
            <Stat label="Pinnacle utakmica (API-Football)" value={current.isDemo ? "DEMO" : String(current.diagnostics?.value?.refFixtures ?? 0)} testId="ref-fixtures" />
            <Stat label="Spojeno sa Pinnacle-om" value={String(current.diagnostics?.value?.matched ?? 0)} testId="matched" />
            <Stat label="Value tipova" value={String(current.selectionsFound)} testId="found" />
            <Stat label="API zahteva (OddsPapi / API-Football)" value={current.isDemo ? "0 (DEMO)" : `${current.requestsUsed} / ${current.diagnostics?.value?.afRequests ?? 0}`} />
          </dl>
          <ValueDiagnosticsBox scan={current} />
          {current.errors.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-lg bg-lost/10 px-3 py-2 text-sm text-lost">
              {current.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </Card>
      )}

      {current && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="mr-auto font-semibold">Pronađene selekcije ({filtered.length})</h2>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pretraga tima ili lige"
              className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent sm:w-56" />
            <div className="flex gap-1">
              {VALUE_LABELS.map((t) => (
                <button key={t} type="button" aria-pressed={types.includes(t)}
                  onClick={() => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}
                  className={`min-w-10 rounded-lg border px-2.5 py-1.5 text-sm ${types.includes(t) ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted"}`}>{t}</button>
              ))}
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as "time" | "odds")} aria-label="Sortiranje"
              className="rounded-xl border border-line bg-bg px-3 py-2 text-sm">
              <option value="time">Po vremenu</option>
              <option value="odds">Po kvoti</option>
            </select>
          </div>
          <p className="mb-4 text-xs text-muted">AdmiralBet kvota, „fer“ = poštena kvota (Pinnacle bez marže) i vrednost u %. U filter se dodaju na stranici Filter.</p>

          {filtered.length === 0 ? (
            <EmptyState title={running ? "Robot traži…" : "Nema selekcija"} text={running ? "Selekcije se pojavljuju dok robot radi." : "Za ovaj period nema tipova sa dovoljnom vrednošću."} />
          ) : grouped ? (
            <ul className="grid gap-3 md:grid-cols-2" data-testid="selections">
              {grouped.map((rows) => {
                const s = rows[0];
                return (
                  <li key={s.matchId} className="rounded-xl border border-line bg-panel-2/60 p-4">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="truncate">{s.country ? `${s.country} · ` : ""}{s.competition}</span>
                      <span className="shrink-0">{fmtDay.format(new Date(s.kickoffTime))} {fmt.format(new Date(s.kickoffTime)).split(" ").pop()}</span>
                    </div>
                    <p className="mt-1.5 font-medium">{s.homeTeam} – {s.awayTeam}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {rows.map((r) => (
                        <span key={r.id} data-odds={r.odds} data-combo={r.label.includes("&") ? "1" : undefined} title={`Izvor: ${r.source}, kvota od ${fmt.format(new Date(r.oddsTimestamp))}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-sm">
                          <span className="font-semibold">{r.label}</span>
                          <span className="tabular-nums text-accent">{r.odds.toFixed(2)}</span>
                          {r.valuePct != null && <span className="text-xs text-muted" data-testid="value-info">fer {r.fairOdds?.toFixed(2)} · <b className="text-won">+{r.valuePct.toFixed(1)}%</b></span>}
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 flex items-center gap-2 text-[11px] text-muted">Izvor: {s.source} {s.isDemo && <DemoBadge />}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm" data-testid="selections">
                <thead className="text-muted"><tr>{["Vreme", "Liga", "Utakmica", "Tip", "Kvota", "Izvor"].map((c) => <th key={c} className="border-b border-line px-3 py-2 font-medium">{c}</th>)}</tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-line/50">
                      <td className="px-3 py-2 whitespace-nowrap">{fmt.format(new Date(r.kickoffTime))}</td>
                      <td className="px-3 py-2">{r.competition}</td>
                      <td className="px-3 py-2">{r.homeTeam} – {r.awayTeam}</td>
                      <td className="px-3 py-2 font-semibold">{r.label}{r.valuePct != null && <span className="ml-2 text-xs font-normal text-muted">fer {r.fairOdds?.toFixed(2)} · +{r.valuePct.toFixed(1)}%</span>}</td>
                      <td className="px-3 py-2 tabular-nums text-accent" data-odds={r.odds} data-combo={r.label.includes("&") ? "1" : undefined}>{r.odds.toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs text-muted"><span className="flex items-center gap-1.5">{r.source} {r.isDemo && <DemoBadge />}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {scans.length > 1 && (
        <Card>
          <h2 className="mb-3 font-semibold">Poslednja skeniranja</h2>
          <ul className="divide-y divide-line/60 text-sm">
            {scans.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => !running && setCurrent(s)} disabled={running}
                  className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-left hover:text-accent ${current?.id === s.id ? "text-accent" : ""}`}>
                  <span className="w-28 text-muted">{fmt.format(new Date(s.startedAt))}</span>
                  <span className="flex items-center gap-2">{s.periodLabel} · {s.providerName} {s.isDemo && <DemoBadge />}</span>
                  <span className="text-muted">{s.selectionsFound} selekcija</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${STATUS_LABEL[s.status][1]}`}>{STATUS_LABEL[s.status][0]}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  );
}

function SourceBox({ source, maxRequests }: { source: SourceStatus | null; maxRequests: number }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/50 p-4 text-sm">
      <h3 className="mb-2 font-semibold">OddsPapi nalog</h3>
      {!source ? <p className="text-muted">Proveravam…</p>
        : !source.configured ? (
          <div className="space-y-2 text-muted">
            <p>API ključ nije podešen (<code>ODDSPAPI_API_KEY</code> na Railway-u). Dostupan je samo DEMO izvor.</p>
            <p className="text-xs">Slične promenljive na serveru: {source.similar?.length ? <code className="text-live">{source.similar.join(", ")}</code> : "nema nijedne"}</p>
          </div>
        )
        : !source.ok ? <p className="text-lost">{source.error}</p>
        : (
          <dl className="space-y-1.5">
            <div className="flex justify-between gap-3"><dt className="text-muted">Veza</dt><dd className="text-won">Radi</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Potrošeno ovog meseca</dt>
              <dd className="tabular-nums">{source.requestCount ?? "?"} / {source.requestLimit ?? "∞"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Kladionice u paketu</dt>
              <dd>{source.bookmakers ? "ograničen spisak" : "sve"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Limit po skeniranju</dt><dd className="tabular-nums">{maxRequests}</dd></div>
          </dl>
        )}
      <p className="mt-3 text-xs text-muted">Provera naloga ne troši kvotu.</p>
    </div>
  );
}

const COMPARE_COLS = ["HOME", "DRAW", "AWAY", "DC_1X", "DC_X2", "DC_12", "OVER_1_5", "UNDER_1_5", "OVER_2_5", "UNDER_2_5", "OVER_3_5", "UNDER_3_5"];
const TYPE_LABEL: Record<string, string> = { HOME: "1", DRAW: "X", AWAY: "2", DC_1X: "1X", DC_X2: "X2", DC_12: "12", OVER_1_5: "2+", UNDER_1_5: "0–1", OVER_2_5: "3+", UNDER_2_5: "0–2", OVER_3_5: "4+", UNDER_3_5: "0–3" };

function ValueDiagnosticsBox({ scan }: { scan: ScanStatusDto }) {
  const v = scan.diagnostics?.value;
  if (!v || scan.status === "RUNNING") return null;
  const log = scan.diagnostics?.valueLog ?? [];
  const unmatched = scan.diagnostics?.unmatchedLog ?? [];
  const label = (t: string) => TYPE_LABEL[t] ?? t;
  return (
    <details className="mt-4 rounded-lg border border-line px-3 py-2 text-sm" data-testid="value-diagnostics">
      <summary className="cursor-pointer text-muted">Dijagnostika skeniranja</summary>
      <ul className="mt-3 space-y-0.5 text-sm">
        <li>Referenca: <b>{v.reference}</b>{v.reference !== "DEMO" && <> · Pinnacle utakmica u periodu: <b>{v.refFixtures}</b> · API-Football zahteva: <b>{v.afRequests}</b></>}</li>
        <li>AdmiralBet utakmica (pravi fudbal): <b>{v.matched + v.unmatched}</b> · spojeno sa Pinnacle-om: <b>{v.matched}</b> · nije nađeno: <b>{v.unmatched}</b></li>
        <li>Provereno tipova: <b>{v.checked}</b> · value tipova: <b className="text-won">{v.tips}</b>{Object.keys(v.tipsByType).length > 0 && <> ({Object.entries(v.tipsByType).map(([t, n]) => `${label(t)}: ${n}`).join(", ")})</>}</li>
        <li>Najveća vrednost po utakmici: {Object.entries(v.bestValue).map(([k, n]) => `${k}: ${n}`).join(" · ")}</li>
        <li className="text-xs text-muted">Pravila: vrednost ≥ {v.opts.minValuePct}%, kvota {v.opts.minOdds.toFixed(2)}–{v.opts.maxOdds.toFixed(2)}. AdmiralBet nudi: {Object.entries(v.admiralOffered).map(([t, n]) => `${label(t)} ${n}`).join(", ")}</li>
      </ul>
      {scan.diagnostics?.marketMap && <p className="mt-3 break-all text-xs text-muted">Mapiranje tržišta (OddsPapi): {JSON.stringify(scan.diagnostics.marketMap)}</p>}
      {log.length > 0 && (
        <div className="mt-3 text-xs text-muted" data-testid="value-log">
          <p className="mb-1">Spojene utakmice ({log.length}):</p>
          <ul className="space-y-0.5">
            {log.map((r, i) => <li key={i}><span className="text-text">{r.match}</span>: {r.tips ? <b className="text-won">{r.tips}</b> : <>najbliže: {r.best}</>}</li>)}
          </ul>
        </div>
      )}
      {unmatched.length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">Nije nađeno kod Pinnacle-a ({v.unmatched})</summary>
          <p className="mt-1">{unmatched.join(" · ")}</p>
        </details>
      )}
    </details>
  );
}

type MarketDesc = { marketId: string; name: string; bookmakerMarketId?: string; outcomes: { id: string; name: string; price: number | null; active: boolean | null; bookmakerOutcomeId?: string }[] };

function MarketList({ markets }: { markets: MarketDesc[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {markets.map((g) => (
        <li key={g.marketId}>
          <span className="text-text">{g.marketId}</span> {g.name}{g.bookmakerMarketId ? ` · šifra kladionice ${g.bookmakerMarketId}` : ""}:{" "}
          {g.outcomes.length === 0 ? "nema ishoda" : g.outcomes.map((o) => (
            <span key={o.id} className="mr-2 inline-block">„{o.name}“ ({o.id}) = <span className="text-text">{o.price ?? "—"}</span>{o.active === false ? " neaktivan" : ""}</span>
          ))}
        </li>
      ))}
    </ul>
  );
}

type CompareResult = {
  fixtureId: string; match: string; competition: string; startTime: string;
  bookmakers: { slug: string; name: string; present: boolean; odds: Record<string, number>;
    goals?: MarketDesc[] }[];
};

type ProbeResult = {
  date: string; bookmakers: { id: number; name: string }[]; pinnacle: { id: number; name: string } | null; pinnacleInOdds: boolean;
  paging: { current: number; total: number } | null; results: number | null;
  summary: { fixtures: number; bookmakers: { name: string; count: number }[]; bets: { name: string; count: number }[] };
  sample: { fixtureId: number; date: string | null; league: string | null; bookmakers: { id: number; name: string; bets: { id: number; name: string; values: { value: string; odd: number }[] }[] }[] } | null;
};

/** Value betting: provera da li API-Football nudi referentne kvote (Pinnacle i druge kladionice). */
function ReferenceProbeBox() {
  const [data, setData] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/value/probe", { method: "POST" });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? "Greška."); else setData(j);
    } catch { setErr("Greška u vezi."); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-line bg-panel-2/50 p-4 text-sm" data-testid="probe-box">
      <h3 className="mb-1 font-semibold">Referentne kvote (value)</h3>
      <p className="mb-3 text-xs text-muted">Da li API-Football nudi kvote drugih kladionica (Pinnacle) za „poštenu“ kvotu. Troši 2 API-Football zahteva.</p>
      <button type="button" onClick={run} disabled={busy} className="rounded-lg border border-accent/50 px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-50">
        {busy ? "Proveravam…" : "Proveri referentne kvote"}
      </button>
      {err && <p className="mt-2 text-xs text-lost" role="alert">{err}</p>}
      {data && (
        <div className="mt-3 space-y-2 text-xs" data-testid="probe-result">
          <p className={data.pinnacle ? "text-won" : "text-lost"}>
            Pinnacle: <b>{data.pinnacle ? `DA (id ${data.pinnacle.id})` : "NE"}</b>
            {data.pinnacle && <> · u današnjim kvotama: <b>{data.pinnacleInOdds ? "da" : "ne (na 1. strani)"}</b></>}
          </p>
          <p className="text-muted">Kladionica u API-Football-u: <b className="text-text">{data.bookmakers.length}</b> · danas ({data.date}) utakmica sa kvotama: <b className="text-text">{data.results ?? "?"}</b>{data.paging ? ` · strana ${data.paging.current}/${data.paging.total}` : ""}</p>
          <details>
            <summary className="cursor-pointer text-muted">Sve kladionice</summary>
            <p className="mt-1 break-words text-muted">{data.bookmakers.map((b) => `${b.id}: ${b.name}`).join(", ")}</p>
          </details>
          <details>
            <summary className="cursor-pointer text-muted">Kladionice i tržišta na 1. strani</summary>
            <p className="mt-1 break-words text-muted">Kladionice: {data.summary.bookmakers.map((b) => `${b.name} ×${b.count}`).join(", ") || "—"}</p>
            <p className="mt-1 break-words text-muted">Tržišta: {data.summary.bets.slice(0, 25).map((b) => `${b.name} ×${b.count}`).join(", ") || "—"}</p>
          </details>
          {data.sample && (
            <details>
              <summary className="cursor-pointer text-muted">Primer utakmice ({data.sample.league ?? data.sample.fixtureId})</summary>
              <ul className="mt-1 space-y-1 text-muted">
                {data.sample.bookmakers.map((b) => (
                  <li key={b.id}><b className="text-text">{b.name}</b>: {b.bets.map((t) => `${t.name} [${t.values.map((v) => `${v.value} ${v.odd}`).join(", ")}]`).join(" · ") || "—"}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CompareBox() {
  const [data, setData] = useState<CompareResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/robot/compare", { method: "POST" });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? "Greška."); else { setData(j.results); setOpen(true); }
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-line bg-panel-2/50 p-4 text-sm">
      <h3 className="mb-1 font-semibold">Uporedi kladionice</h3>
      <p className="mb-3 text-xs text-muted">Kvote svih 6 kladionica na 3 predstojeće utakmice iz skeniranja. Troši 3 zahteva.</p>
      <button type="button" onClick={run} disabled={busy} className="rounded-lg border border-accent/50 px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-50">
        {busy ? "Upoređujem…" : "Uporedi"}
      </button>
      {err && <p className="mt-2 text-xs text-lost">{err}</p>}
      {data && open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Poređenje kladionica</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-text">Zatvori</button></div>
            {data.map((r) => (
              <div key={r.fixtureId} className="mb-5">
                <p className="text-xs text-muted">{r.competition} · {fmt.format(new Date(r.startTime))}</p>
                <p className="mb-2 font-medium">{r.match}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="text-muted"><tr><th className="py-1 font-medium">Kladionica</th>{COMPARE_COLS.map((t) => <th key={t} className="font-medium">{TYPE_LABEL[t]}</th>)}</tr></thead>
                    <tbody>
                      {r.bookmakers.map((b) => (
                        <tr key={b.slug} className="border-t border-line/50">
                          <td className="py-1.5">{b.name}{!b.present && <span className="ml-1 text-xs text-muted">(nema utakmicu)</span>}</td>
                          {COMPARE_COLS.map((t) => <td key={t} className="tabular-nums">{b.odds[t]?.toFixed(2) ?? <span className="text-muted">—</span>}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {r.bookmakers.filter((b) => b.goals?.length).map((b) => (
                  <details key={b.slug} className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer">{b.name}: sva tržišta golova (pun meč)</summary>
                    <MarketList markets={b.goals!} />
                  </details>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

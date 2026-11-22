"use client";

import { useActionState } from "react";
import { saveSettingsAction, type SettingsState } from "./actions";

const input = "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

export function SettingsForm({ stake, maxRequests, checkMinutes, opChecks, afCap, value = { minPct: 4, minOdds: 1.5, maxOdds: 5 } }: { stake: number; maxRequests: number; checkMinutes: number; opChecks: number; afCap: number; value?: { minPct: number; minOdds: number; maxOdds: number } }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettingsAction, {});
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="stakePerSelection" className="mb-1.5 block text-sm text-muted">Ulog po tipu (RSD)</label>
          <input id="stakePerSelection" name="stakePerSelection" inputMode="decimal" defaultValue={stake.toFixed(2)} className={input} />
          <p className="mt-1.5 text-xs text-muted">Važi samo za nove obračune, stari se ne menjaju.</p>
        </div>
        <div>
          <label htmlFor="maxRequestsPerScan" className="mb-1.5 block text-sm text-muted">Limit API zahteva po skeniranju</label>
          <input id="maxRequestsPerScan" name="maxRequestsPerScan" inputMode="numeric" defaultValue={maxRequests} className={input} />
          <p className="mt-1.5 text-xs text-muted">Robot staje kad potroši ovoliko OddsPapi zahteva, da ne potroši mesečnu kvotu.</p>
        </div>
        <div>
          <label htmlFor="resultCheckMinutes" className="mb-1.5 block text-sm text-muted">Provera rezultata – interval (min)</label>
          <input id="resultCheckMinutes" name="resultCheckMinutes" inputMode="numeric" defaultValue={checkMinutes} className={input} />
          <p className="mt-1.5 text-xs text-muted">Najmanji razmak između dva API-Football zahteva za isti dan (5–240). Besplatno: 100 zahteva/dan.</p>
        </div>
        <div>
          <label htmlFor="apiFootballDailyCap" className="mb-1.5 block text-sm text-muted">API-Football zahteva dnevno (rezultati i Pinnacle kvote)</label>
          <input id="apiFootballDailyCap" name="apiFootballDailyCap" inputMode="numeric" defaultValue={afCap} className={input} />
          <p className="mt-1.5 text-xs text-muted">Rezultati (1 zahtev po danu) i Pinnacle kvote (oko 10–15 zahteva po danu u skeniranju). Pro paket ima 7.500 dnevno.</p>
        </div>
        <div>
          <label htmlFor="oddsPapiResultChecksPerDay" className="mb-1.5 block text-sm text-muted">OddsPapi provere rezultata dnevno</label>
          <input id="oddsPapiResultChecksPerDay" name="oddsPapiResultChecksPerDay" inputMode="numeric" defaultValue={opChecks} className={input} />
          <p className="mt-1.5 text-xs text-muted">Rezervni izvor – 1 zahtev po utakmici, troši mesečnu OddsPapi kvotu.</p>
        </div>
      </div>
      <fieldset className="rounded-xl border border-line p-4" data-testid="value-settings">
        <legend className="px-1 text-sm font-semibold">Pravila value robota</legend>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor="valueMinPct" className="mb-1.5 block text-sm text-muted">Najmanja vrednost (%)</label>
            <input id="valueMinPct" name="valueMinPct" inputMode="decimal" defaultValue={value.minPct.toFixed(1)} className={input} />
          </div>
          <div>
            <label htmlFor="valueMinOdds" className="mb-1.5 block text-sm text-muted">Najmanja kvota</label>
            <input id="valueMinOdds" name="valueMinOdds" inputMode="decimal" defaultValue={value.minOdds.toFixed(2)} className={input} />
          </div>
          <div>
            <label htmlFor="valueMaxOdds" className="mb-1.5 block text-sm text-muted">Najveća kvota</label>
            <input id="valueMaxOdds" name="valueMaxOdds" inputMode="decimal" defaultValue={value.maxOdds.toFixed(2)} className={input} />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">Tip ulazi kad je AdmiralBet kvota bar ovoliko % veća od poštene (Pinnacle bez marže) i u opsegu kvota. Predlog: 4%, 1.50–5.00. Važi za nova skeniranja.</p>
      </fieldset>
      {state.error && <p role="alert" className="rounded-lg bg-lost/10 px-3 py-2 text-sm text-lost">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-lg bg-won/10 px-3 py-2 text-sm text-won">Sačuvano.</p>}
      <button type="submit" disabled={pending} className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-bg hover:bg-accent-strong disabled:opacity-60">
        {pending ? "Čuvanje…" : "Sačuvaj"}
      </button>
    </form>
  );
}

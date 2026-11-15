"use client";

import { useActionState } from "react";
import { saveSettingsAction, type SettingsState } from "./actions";

const input = "w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

export function SettingsForm({ stake, maxRequests, checkMinutes, opChecks, afCap, kontraTrigger = 1.3, kontraFavorite = 1.3 }: { stake: number; maxRequests: number; checkMinutes: number; opChecks: number; afCap: number; kontraTrigger?: number; kontraFavorite?: number }) {
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
          <label htmlFor="apiFootballDailyCap" className="mb-1.5 block text-sm text-muted">API-Football zahteva dnevno (rezultati)</label>
          <input id="apiFootballDailyCap" name="apiFootballDailyCap" inputMode="numeric" defaultValue={afCap} className={input} />
          <p className="mt-1.5 text-xs text-muted">Glavni izvor rezultata. Pro paket ima 7.500 dnevno; 1 zahtev pokriva sve utakmice jednog dana.</p>
        </div>
        <div>
          <label htmlFor="oddsPapiResultChecksPerDay" className="mb-1.5 block text-sm text-muted">OddsPapi provere rezultata dnevno</label>
          <input id="oddsPapiResultChecksPerDay" name="oddsPapiResultChecksPerDay" inputMode="numeric" defaultValue={opChecks} className={input} />
          <p className="mt-1.5 text-xs text-muted">Rezervni izvor – 1 zahtev po utakmici, troši mesečnu OddsPapi kvotu.</p>
        </div>
      </div>
      <fieldset className="rounded-xl border border-line p-4" data-testid="kontra-settings">
        <legend className="px-1 text-sm font-semibold">Pravila skenera velikih kvota</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="kontraTriggerMax" className="mb-1.5 block text-sm text-muted">Prag okidača (2+ ili 0–3)</label>
            <input id="kontraTriggerMax" name="kontraTriggerMax" inputMode="decimal" defaultValue={kontraTrigger.toFixed(2)} className={input} />
            <p className="mt-1.5 text-xs text-muted">Kad je 2+ (ili 0–3) do ove kvote, igra se 0–1 (ili 4+). Podrazumevano 1.30 – 1.30 ulazi, 1.31 ne.</p>
          </div>
          <div>
            <label htmlFor="kontraFavoriteMax" className="mb-1.5 block text-sm text-muted">Prag favorita 1/2</label>
            <input id="kontraFavoriteMax" name="kontraFavoriteMax" inputMode="decimal" defaultValue={kontraFavorite.toFixed(2)} className={input} />
            <p className="mt-1.5 text-xs text-muted">Ako je 1 ili 2 do ove kvote, utakmica se preskače. Podrazumevano 1.30.</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">Pragovi važe za nova skeniranja.</p>
      </fieldset>
      {state.error && <p role="alert" className="rounded-lg bg-lost/10 px-3 py-2 text-sm text-lost">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-lg bg-won/10 px-3 py-2 text-sm text-won">Sačuvano.</p>}
      <button type="submit" disabled={pending} className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-bg hover:bg-accent-strong disabled:opacity-60">
        {pending ? "Čuvanje…" : "Sačuvaj"}
      </button>
    </form>
  );
}

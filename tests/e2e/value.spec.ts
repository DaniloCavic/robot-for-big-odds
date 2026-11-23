import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { E2E_ENV } from "../../playwright.config";

test.describe.configure({ mode: "serial" });

const LABEL: Record<string, string> = { HOME: "1", DRAW: "X", AWAY: "2", DC_1X: "1X", DC_X2: "X2", DC_12: "12", OVER_1_5: "2+", UNDER_1_5: "0–1", OVER_2_5: "3+", UNDER_2_5: "0–2", OVER_3_5: "4+", UNDER_3_5: "0–3" };

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_ENV.ADMIN_EMAIL);
  await page.getByLabel("Lozinka").fill(E2E_ENV.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/robot");
});

test("ceo tok: skeniranje → „Dodaj sve“ u filter → ručni rezultat → profit → statistika", async ({ page }) => {
  // 1) skeniranje (demo)
  await page.getByRole("button", { name: "Narednih 7 dana", exact: true }).click();
  await page.getByRole("button", { name: /START ROBOT/ }).click();
  await expect(page.getByTestId("scan-status")).toHaveText("Radi");
  await expect(page.getByTestId("scan-status")).toHaveText("Završeno", { timeout: 60_000 });
  const found = Number(await page.getByTestId("found").textContent());
  expect(found).toBeGreaterThan(0);

  // 2) Filter: novi filter i „Dodaj sve“
  await page.goto("/filter");
  await page.getByRole("button", { name: "+ Novi filter" }).click();
  const name = `E2E veliki ${Math.random().toString(36).slice(2, 7)}`;
  await page.getByLabel("Naziv novog filtera").fill(name);
  await page.getByRole("button", { name: "Napravi" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Dodaj sve u filter/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dodato" })).toBeVisible();
  await expect(page.getByTestId("filter-count")).not.toHaveText("0");
  const labels = await page.locator("[data-testid=filter-list] li > span:first-child").allTextContents();
  expect(labels.every((l) => ["1", "X", "2", "1X", "X2", "12", "2+", "0–1", "3+", "0–2", "4+", "0–3"].includes(l))).toBe(true);
  const odds = await page.locator("[data-testid=filter-list] [data-odds]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-odds"))));
  expect(odds.some((o) => o > 1.3)).toBe(true); // value kvote nisu ograničene na 1.30

  // 3) Ručno postavljen rezultat za prvi tip iz filtera (pobednički rezultat za taj tip)
  const db = new PrismaClient({ datasourceUrl: E2E_ENV.DATABASE_URL });
  const entry = await db.filterSetSelection.findFirstOrThrow({
    // tip koji još nije obračunat (prethodni test je mogao da obračuna istu demo utakmicu)
    where: { filterSet: { name }, removedAt: null, trackedSelection: { status: "PENDING" } }, include: { trackedSelection: { include: { match: true } } }, orderBy: { addedAt: "asc" },
  });
  const t = entry.trackedSelection;
  const originalKickoff = t.match.kickoffTime;
  await db.match.update({ where: { id: t.matchId }, data: { kickoffTime: new Date(Date.now() - 3 * 3600_000) } });
  // rezultat pri kome tip prolazi
  const WIN: Record<string, [string, string]> = {
    HOME: ["2", "0"], DRAW: ["1", "1"], AWAY: ["0", "2"], DC_1X: ["1", "0"], DC_X2: ["0", "1"], DC_12: ["2", "1"],
    OVER_1_5: ["2", "1"], UNDER_1_5: ["1", "0"], OVER_2_5: ["2", "1"], UNDER_2_5: ["1", "1"], OVER_3_5: ["3", "1"], UNDER_3_5: ["1", "0"],
  };
  const [h, a] = WIN[t.marketType];
  await page.goto("/aktivne");
  await page.locator("[data-testid=tracked-table] tbody tr").filter({ hasText: `${t.match.homeTeam} – ${t.match.awayTeam}` })
    .filter({ has: page.locator("td", { hasText: new RegExp(`^${LABEL[t.marketType].replace("+", "\\+")}$`) }) }).first().click();
  const dialog = page.getByRole("dialog", { name: "Detalji selekcije" });
  await dialog.getByLabel("Novi status").selectOption("AUTO");
  await dialog.getByLabel("Golovi domaćin").fill(h);
  await dialog.getByLabel("Golovi gost").fill(a);
  await dialog.getByLabel("Obrazloženje").fill("Proveren rezultat – E2E test Value");
  await dialog.getByRole("button", { name: "Sačuvaj ispravku" }).click();
  await expect(dialog.getByText("(ručno)")).toBeVisible();

  const settled = await db.filterSetSelection.findUniqueOrThrow({ where: { id: entry.id } });
  expect(settled.settlementStatus).toBe("WON");
  // ulog „na dobitak“: ulog = 1.000 / (kvota − 1), prolaz donosi ~1.000 čistog dobitka
  const stake = entry.stake.toNumber();
  expect(stake).toBeCloseTo(1000 / (entry.oddsSnapshot.toNumber() - 1), 1);
  const expectedNet = Math.round((Math.round(stake * entry.oddsSnapshot.toNumber() * 100) / 100 - stake) * 100) / 100;
  expect(expectedNet).toBeCloseTo(1000, 0);
  expect(settled.netProfit!.toNumber()).toBeCloseTo(expectedNet, 2);

  // 4) Filter pokazuje prolaz i profit
  await page.goto("/filter");
  await expect(page.getByTestId("filter-summary")).toBeVisible();
  const netText = (await page.getByTestId("filter-net").textContent())!;
  expect(Number(netText.replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", "."))).toBeCloseTo(expectedNet, 2);
  // 5) Statistika: prolaz, profit i očekivani profit
  const valueSettled = await db.filterSetSelection.findMany({
    where: { removedAt: null, filterSet: { status: { not: "DELETED" }, strategy: "VALUE" }, settlementStatus: { in: ["WON", "LOST", "VOID"] } },
    include: { trackedSelection: true },
  });
  const valueNet = Math.round(valueSettled.reduce((acc, e) => acc + Number(e.netProfit), 0));
  await page.goto("/statistika");
  await page.getByLabel("DEMO").check();
  await page.getByRole("button", { name: "Sve", exact: true }).click(); // ceo period (demo utakmice su i u budućnosti)
  await expect(page.getByTestId("value-stats")).toBeVisible();
  await expect(page.getByTestId("kpi-net")).toBeVisible();
  await expect.poll(async () => Number((await page.getByTestId("kpi-net").textContent())!.replace(/[^\d-]/g, ""))).toBe(valueNet);
  const typeRow = page.getByTestId("value-by-type").locator(`tr[data-row=${t.marketType}]`);
  const ofType = valueSettled.filter((e) => e.trackedSelectionId === t.id || e.trackedSelection.marketType === t.marketType);
  await expect(typeRow).toContainText(`${ofType.filter((e) => e.settlementStatus === "WON").length} / ${ofType.filter((e) => e.settlementStatus === "LOST").length}`);
  await expect(page.getByTestId("value-expected")).toContainText("Očekivani profit");

  // čišćenje: drugi testovi broje ručne ispravke i aktivne filtere (filter se briše kao dugmetom „Obriši filter“)
  await db.auditLog.deleteMany({ where: { action: "MANUAL_OVERRIDE", reason: "Proveren rezultat – E2E test Value" } });
  await db.filterSet.updateMany({ where: { name }, data: { status: "DELETED" } });
  // ručno obračunat demo tip vraćamo u početno stanje (drugi testovi ponovo skeniraju iste demo utakmice)
  await db.filterSetSelection.deleteMany({ where: { trackedSelectionId: t.id } });
  await db.auditLog.deleteMany({ where: { entityType: "TrackedSelection", entityId: t.id } });
  await db.resultUpdate.deleteMany({ where: { matchId: t.matchId } });
  await db.trackedSelection.delete({ where: { id: t.id } });
  await db.match.update({ where: { id: t.matchId }, data: { finalHomeScore: null, finalAwayScore: null, matchStatus: "NOT_STARTED", kickoffTime: originalKickoff } });
  await db.$disconnect();
});

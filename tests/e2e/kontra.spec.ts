import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { E2E_ENV } from "../../playwright.config";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_ENV.ADMIN_EMAIL);
  await page.getByLabel("Lozinka").fill(E2E_ENV.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/robot");
});

test("Kontra skeniranje: samo 0–1 i 4+, kvota okidača, brojevi preskoka", async ({ page }) => {
  await page.getByTestId("strategy-KONTRA").click();
  await expect(page.getByTestId("strategy-KONTRA")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Narednih 7 dana", exact: true }).click();
  await page.getByRole("button", { name: /START ROBOT/ }).click();
  await expect(page.getByTestId("scan-status")).toHaveText("Radi");
  await expect(page.getByTestId("scan-status")).toHaveText("Završeno", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /Skeniranje:/ }).getByTestId("strategy-badge")).toHaveText("KONTRA");

  const found = Number(await page.getByTestId("found").textContent());
  expect(found).toBeGreaterThan(0);
  expect(Number(await page.getByTestId("kontra-trigger").textContent())).toBeGreaterThanOrEqual(found);
  await expect(page.getByTestId("kontra-skip-FAVORIT_1_2")).not.toHaveText("0");

  const chips = page.locator("[data-testid=selections] [data-odds]");
  await expect(chips).toHaveCount(found);
  const labels = await chips.locator("span.font-semibold").allTextContents();
  expect(labels.every((l) => l === "0–1" || l === "4+")).toBe(true);
  // kontra kvote nisu ograničene na 1.30
  const odds = await chips.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-odds"))));
  expect(odds.some((o) => o > 1.3)).toBe(true);
  await expect(page.getByTestId("trigger-odds").first()).toContainText("okidač");

  // dijagnostika
  await page.getByText("Dijagnostika Kontra robota").click();
  await expect(page.getByTestId("kontra-log")).toBeVisible();

  // izbor strategije se pamti
  await page.reload();
  await expect(page.getByTestId("strategy-KONTRA")).toHaveAttribute("aria-checked", "true");
});

test("Skeniraj oba: dva skeniranja iz jednog prolaza", async ({ page, isMobile }) => {
  test.skip(isMobile, "dovoljno na desktopu");
  await page.getByTestId("strategy-OBA").click();
  await page.getByRole("button", { name: "Narednih 7 dana", exact: true }).click();
  await page.getByRole("button", { name: /START ROBOT/ }).click();
  await expect(page.getByTestId("scan-status")).toHaveText("Radi");
  await expect(page.getByTestId("scan-status")).toHaveText("Završeno", { timeout: 60_000 });
  // prikazuje se Osnovni; Kontra je u listi poslednjih skeniranja
  await expect(page.getByRole("heading", { name: /Skeniranje:/ }).getByTestId("strategy-badge")).toHaveText("OSNOVNI");
  const recent = page.getByRole("heading", { name: "Poslednja skeniranja" }).locator("..");
  await recent.getByRole("button").filter({ hasText: "KONTRA" }).first().click();
  await expect(page.getByRole("heading", { name: /Skeniranje:/ }).getByTestId("strategy-badge")).toHaveText("KONTRA");
  await expect(page.getByTestId("scan-status")).toHaveText("Završeno");
  await expect(page.getByText("deljeno sa Osnovnim").or(page.getByText("0 (DEMO)"))).toBeVisible();
  const labels = await page.locator("[data-testid=selections] [data-odds] span.font-semibold").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((l) => l === "0–1" || l === "4+")).toBe(true);
});

test("Kontra tok: skeniranje → „Dodaj sve“ u Kontra filter → ručni rezultat → profit", async ({ page }) => {
  // 1) Kontra skeniranje (demo)
  await page.getByTestId("strategy-KONTRA").click();
  await page.getByRole("button", { name: "Narednih 7 dana", exact: true }).click();
  await page.getByRole("button", { name: /START ROBOT/ }).click();
  await expect(page.getByTestId("scan-status")).toHaveText("Radi");
  await expect(page.getByTestId("scan-status")).toHaveText("Završeno", { timeout: 60_000 });
  const found = Number(await page.getByTestId("found").textContent());
  expect(found).toBeGreaterThan(0);

  // 2) Filter: novi Kontra filter (predložen jer je izabrano Kontra skeniranje) i „Dodaj sve“
  await page.goto("/filter");
  await expect(page.getByLabel("Skeniranje")).toContainText("KONTRA");
  await expect(page.getByTestId("kontra-note")).toBeVisible();
  await page.getByRole("button", { name: "+ Novi filter" }).click();
  await expect(page.getByTestId("new-filter-KONTRA")).toHaveAttribute("aria-checked", "true");
  const name = `Kontra E2E ${Math.random().toString(36).slice(2, 7)}`;
  await page.getByLabel("Naziv novog filtera").fill(name);
  await page.getByRole("button", { name: "Napravi" }).click();
  await expect(page.getByTestId("filter-strategy")).toHaveText("KONTRA");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Dodaj sve u filter/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dodato" })).toBeVisible();
  const count = Number(await page.getByTestId("filter-count").textContent());
  expect(count).toBeGreaterThan(0);
  const labels = await page.locator("[data-testid=filter-list] li > span:first-child").allTextContents();
  expect(labels.every((l) => l === "0–1" || l === "4+")).toBe(true);
  const odds = await page.locator("[data-testid=filter-list] [data-odds]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-odds"))));
  expect(odds.some((o) => o > 1.3)).toBe(true); // kontra kvote iznad 1.30 se prihvataju

  // 3) Ručno postavljen rezultat za prvi tip iz filtera (pobednički rezultat za taj tip)
  const db = new PrismaClient({ datasourceUrl: E2E_ENV.DATABASE_URL });
  const entry = await db.filterSetSelection.findFirstOrThrow({
    // tip koji još nije obračunat (prethodni test je mogao da obračuna istu demo utakmicu)
    where: { filterSet: { name }, removedAt: null, trackedSelection: { status: "PENDING" } }, include: { trackedSelection: { include: { match: true } } }, orderBy: { addedAt: "asc" },
  });
  const t = entry.trackedSelection;
  await db.match.update({ where: { id: t.matchId }, data: { kickoffTime: new Date(Date.now() - 3 * 3600_000) } });
  const [h, a] = t.marketType === "UNDER_1_5" ? ["1", "0"] : ["2", "2"];
  await page.goto("/aktivne");
  await page.locator("[data-testid=tracked-table] tbody tr").filter({ hasText: `${t.match.homeTeam} – ${t.match.awayTeam}` })
    .filter({ hasText: t.marketType === "UNDER_1_5" ? "0–1" : "4+" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Detalji selekcije" });
  await dialog.getByLabel("Novi status").selectOption("AUTO");
  await dialog.getByLabel("Golovi domaćin").fill(h);
  await dialog.getByLabel("Golovi gost").fill(a);
  await dialog.getByLabel("Obrazloženje").fill("Proveren rezultat – E2E test Kontra");
  await dialog.getByRole("button", { name: "Sačuvaj ispravku" }).click();
  await expect(dialog.getByText("(ručno)")).toBeVisible();

  const settled = await db.filterSetSelection.findUniqueOrThrow({ where: { id: entry.id } });
  expect(settled.settlementStatus).toBe("WON");
  const expectedNet = Math.round(1000 * entry.oddsSnapshot.toNumber() * 100) / 100 - 1000;
  expect(settled.netProfit!.toNumber()).toBeCloseTo(expectedNet, 2);

  // 4) Filter pokazuje prolaz i profit
  await page.goto("/filter");
  await expect(page.getByTestId("filter-strategy")).toHaveText("KONTRA");
  await expect(page.getByTestId("filter-summary")).toBeVisible();
  const netText = (await page.getByTestId("filter-net").textContent())!;
  expect(Number(netText.replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", "."))).toBeCloseTo(expectedNet, 2);
  // 5) Statistika – prekidač Kontra: prolaz i profit; Osnovni ne sadrži kontra tipove
  const kontraSettled = await db.filterSetSelection.findMany({
    where: { removedAt: null, filterSet: { status: { not: "DELETED" }, strategy: "KONTRA" }, settlementStatus: { in: ["WON", "LOST", "VOID"] } },
  });
  const kontraNet = Math.round(kontraSettled.reduce((acc, e) => acc + Number(e.netProfit), 0));
  await page.goto("/statistika");
  await page.getByTestId("stats-strategy-KONTRA").click();
  await page.getByLabel("DEMO").check();
  await expect(page.getByTestId("kontra-stats")).toBeVisible();
  await expect(page.getByTestId("kpi-net")).toBeVisible();
  await expect.poll(async () => Number((await page.getByTestId("kpi-net").textContent())!.replace(/[^\d-]/g, ""))).toBe(kontraNet);
  const typeRow = page.getByTestId("kontra-by-type").locator(`tr[data-row=${t.marketType}]`);
  await expect(typeRow).toContainText("1 / 0");
  await expect(page.getByTestId("kontra-comparison")).toBeVisible();
  await expect(page.getByTestId("kontra-verdict")).toContainText("Osnovni na istim utakmicama");
  await expect(page.getByTestId("kontra-by-trigger")).toContainText("1.21–1.30");
  await page.getByTestId("stats-strategy-OSNOVNI").click();
  await expect(page.getByTestId("kontra-stats")).toHaveCount(0);

  // čišćenje: drugi testovi broje ručne ispravke i aktivne filtere (filter se briše kao dugmetom „Obriši filter“)
  await db.auditLog.deleteMany({ where: { action: "MANUAL_OVERRIDE", reason: "Proveren rezultat – E2E test Kontra" } });
  await db.filterSet.updateMany({ where: { name }, data: { status: "DELETED" } });
  await db.$disconnect();
});

test("Podešavanja: Kontra pragovi se čuvaju i proveravaju", async ({ page, isMobile }) => {
  test.skip(isMobile, "dovoljno na desktopu");
  await page.goto("/podesavanja");
  const trig = page.getByLabel("Prag okidača (2+ ili 0–3)");
  const fav = page.getByLabel("Prag favorita 1/2");
  await expect(trig).toHaveValue("1.30");
  await expect(fav).toHaveValue("1.30");
  await trig.fill("1,60");
  await page.getByRole("button", { name: "Sačuvaj" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: "najviše 1.50" })).toBeVisible();
  await trig.fill("1,25");
  await fav.fill("1.40");
  await page.getByRole("button", { name: "Sačuvaj" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Sačuvano" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Prag okidača (2+ ili 0–3)")).toHaveValue("1.25");
  await expect(page.getByLabel("Prag favorita 1/2")).toHaveValue("1.40");
  // vraćanje na podrazumevano
  await page.getByLabel("Prag okidača (2+ ili 0–3)").fill("1.30");
  await page.getByLabel("Prag favorita 1/2").fill("1.30");
  await page.getByRole("button", { name: "Sačuvaj" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Sačuvano" })).toBeVisible();
});

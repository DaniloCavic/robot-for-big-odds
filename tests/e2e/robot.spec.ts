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

test("bez API ključa OddsPapi je isključen, a DEMO izabran", async ({ page }) => {
  for (const name of ["Soccerbet", "Mozzart", "MaxBet", "AdmiralBet", "Superbet", "BalkanBet"]) {
    await expect(page.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeDisabled();
  }
  await expect(page.getByRole("radio", { name: /DEMO/ })).toBeChecked();
  await expect(page.getByText("API ključ nije podešen")).toBeVisible();
});

test("STOP zaustavlja robota", async ({ page, isMobile }) => {
  test.skip(isMobile, "dovoljno na desktopu");
  await page.getByRole("button", { name: "Narednih 7 dana", exact: true }).click();
  await page.getByRole("button", { name: /START ROBOT/ }).click();
  await expect(page.getByTestId("scan-status")).toHaveText("Radi");
  await page.getByRole("button", { name: /STOP/ }).click();
  await expect(page.getByTestId("scan-status")).toHaveText("Zaustavljeno", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /START ROBOT/ })).toBeVisible();
});

test("DEMO value skeniranje: samo tipovi sa vrednošću, virtuelni fudbal izbačen, dijagnostika", async ({ page }) => {
  await expect(page.getByTestId("rules-info")).toContainText("Pinnacle");
  await page.getByRole("button", { name: "Narednih 7 dana", exact: true }).click();
  await page.getByRole("button", { name: /START ROBOT/ }).click();
  await expect(page.getByTestId("scan-status")).toHaveText("Radi");
  await expect(page.getByTestId("scan-status")).toHaveText("Završeno", { timeout: 60_000 });

  const found = Number(await page.getByTestId("found").textContent());
  expect(found).toBeGreaterThan(0);
  expect(Number(await page.getByTestId("matched").textContent())).toBeGreaterThan(0);
  await expect(page.getByText("Izbačeno (virtuelno i sl.)").locator("..").locator("dd")).not.toHaveText("0");
  await expect(page.getByText("Virtual")).toHaveCount(0);

  const chips = page.locator("[data-testid=selections] [data-odds]");
  await expect(chips).toHaveCount(found);
  const labels = await chips.locator("span.font-semibold").allTextContents();
  expect(labels.every((l) => ["1", "X", "2", "1X", "X2", "12", "2+", "0–1", "3+", "0–2", "4+", "0–3"].includes(l))).toBe(true);
  const odds = await chips.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-odds"))));
  expect(odds.every((o) => o >= 1.5 && o <= 5)).toBe(true);
  const values = await page.getByTestId("value-info").allTextContents();
  expect(values.length).toBe(found);
  expect(values.every((v) => Number(v.match(/\+([\d.]+)%/)![1]) >= 4)).toBe(true);
  await expect(page.locator("[data-testid=selections]").getByText("DEMO", { exact: true }).first()).toBeVisible();

  // filter po tipu i sortiranje po kvoti
  const first = labels[0];
  await page.getByRole("button", { name: first, exact: true }).click();
  const only = await page.locator("[data-testid=selections] [data-odds] span.font-semibold").allTextContents();
  expect(only.length).toBeGreaterThan(0);
  expect(only.every((l) => l === first)).toBe(true);
  await page.getByLabel("Sortiranje").selectOption("odds");
  const sorted = await page.locator("[data-testid=selections] td[data-odds]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-odds"))));
  expect(sorted).toEqual([...sorted].sort((a, b) => a - b));

  // dijagnostika
  await page.getByText("Dijagnostika skeniranja").click();
  await expect(page.getByTestId("value-log")).toBeVisible();

  // dashboard pokazuje poslednje skeniranje
  await page.goto("/");
  await expect(page.getByText("Narednih 7 dana")).toBeVisible();
});

test("provera referentnih kvota: bez API-Football ključa jasna poruka", async ({ page, isMobile }) => {
  test.skip(isMobile, "dovoljno na desktopu");
  await expect(page.getByTestId("probe-box")).toBeVisible();
  await page.getByRole("button", { name: "Proveri referentne kvote" }).click();
  await expect(page.getByTestId("probe-box").getByRole("alert")).toContainText("API-Football ključ nije podešen");
});

test("prilagođeni period u prošlosti se odbija", async ({ page, isMobile }) => {
  test.skip(isMobile, "dovoljno na desktopu");
  await page.getByRole("button", { name: "Prilagođeni period", exact: true }).click();
  await page.getByLabel("Od", { exact: true }).fill("2020-01-01");
  await page.getByLabel("Do", { exact: true }).fill("2020-01-02");
  await page.getByRole("button", { name: /START ROBOT/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText("Period je već prošao");
});

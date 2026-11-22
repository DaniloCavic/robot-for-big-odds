import { expect, test, type Page } from "@playwright/test";
import { E2E_ENV } from "../../playwright.config";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_ENV.ADMIN_EMAIL);
  await page.getByLabel("Lozinka").fill(E2E_ENV.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

const PAGES = [
  ["Robot", "/robot"],
  ["Filter", "/filter"],
  ["Aktivne selekcije", "/aktivne"],
  ["Statistika", "/statistika"],
  ["Istorija skeniranja", "/istorija"],
  ["Podešavanja", "/podesavanja"],
  ["Dashboard", "/"],
] as const;

test("privatne stranice traže prijavu", async ({ page }) => {
  for (const [, path] of PAGES) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("lažni cookie ne daje pristup", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "fos_session", value: "lazni-token", url: baseURL! }]);
  await page.goto("/robot");
  await expect(page).toHaveURL(/\/login$/);
});

test("pogrešna lozinka prikazuje grešku", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_ENV.ADMIN_EMAIL);
  await page.getByLabel("Lozinka").fill("pogresna-lozinka");
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText("Pogrešan email ili lozinka.");
});

test("prijava, navigacija kroz sve stranice i odjava", async ({ page, isMobile }) => {
  await login(page);
  for (const [label, path] of PAGES) {
    if (isMobile) await page.getByRole("button", { name: "Otvori meni" }).click();
    await page.getByRole("navigation").getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path}$`));
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
  }
  // nema horizontalnog skrolovanja
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  if (isMobile) await page.getByRole("button", { name: "Otvori meni" }).click();
  await page.getByRole("button", { name: "Odjava" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("podešavanja: pravila value robota i ulog se proveravaju i čuvaju trajno", async ({ page, isMobile }) => {
  test.skip(isMobile, "dovoljno na desktopu");
  await login(page);
  await page.goto("/podesavanja");
  await expect(page.getByLabel("Maksimalna kvota")).toHaveCount(0);
  await expect(page.getByLabel("Prag okidača (2+ ili 0–3)")).toHaveCount(0);
  const minPct = page.getByLabel("Najmanja vrednost (%)");
  const minOdds = page.getByLabel("Najmanja kvota");
  const maxOdds = page.getByLabel("Najveća kvota");
  const stake = page.getByLabel("Ulog po tipu (RSD)");
  await expect(minPct).toHaveValue("4.0");
  await expect(minOdds).toHaveValue("1.50");
  await expect(maxOdds).toHaveValue("5.00");

  await minPct.fill("40");
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText("najviše 30%");
  await minPct.fill("4");
  await minOdds.fill("3");
  await maxOdds.fill("2,5");
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText("manja od najveće");

  await minPct.fill("5,5");
  await minOdds.fill("1.60");
  await maxOdds.fill("4");
  await stake.fill("500");
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByRole("status")).toHaveText("Sačuvano.");
  await page.reload();
  await expect(minPct).toHaveValue("5.5");
  await expect(minOdds).toHaveValue("1.60");
  await expect(maxOdds).toHaveValue("4.00");
  await expect(stake).toHaveValue("500.00");

  await minPct.fill("4");
  await minOdds.fill("1.50");
  await maxOdds.fill("5");
  await stake.fill("1000");
  await page.getByRole("button", { name: "Sačuvaj" }).click();
  await expect(page.getByRole("status")).toHaveText("Sačuvano.");
});

test("health endpoint", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
});

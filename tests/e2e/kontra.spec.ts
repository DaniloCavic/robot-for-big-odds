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

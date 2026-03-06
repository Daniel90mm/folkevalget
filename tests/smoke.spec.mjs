import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "parallel" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("home page renders live site stats", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toHaveClass(/page-home/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Se stemmer");
  await expect(page.locator('[data-stat="profiles"]')).toHaveText("179");
  await expect(page.locator('[data-stat="votes"]')).not.toHaveText("-");
});

test("discover page renders member cards", async ({ page }) => {
  await page.goto("/discover.html");

  await expect(page.locator("body")).toHaveClass(/page-discover/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find en politiker");
  await expect.poll(async () => page.locator(".member-card").count()).toBeGreaterThan(20);
});

test("votes page renders proposal list", async ({ page }) => {
  await page.goto("/afstemninger.html");

  await expect(page.locator("body")).toHaveClass(/page-votes/);
  await expect(page.getByRole("heading", { level: 2, name: "Forslagsliste" })).toBeVisible();
  await expect.poll(async () => page.locator("#vote-list .vote-list-item").count()).toBeGreaterThan(20);
});

test("parliament page renders live overview", async ({ page }) => {
  await page.goto("/folketinget.html");

  await expect(page.locator("body")).toHaveClass(/page-parliament/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Folketinget lige nu");
  await expect(page.locator("#parliament-member-count")).toHaveText("179");
  await expect.poll(async () => page.locator("#parliament-seat-legend .parliament-seat-row").count()).toBeGreaterThan(10);
  await expect.poll(async () => page.locator("#parliament-committee-directory .parliament-committee-item").count()).toBeGreaterThan(20);
});

test("parties page renders party overview", async ({ page }) => {
  await page.goto("/partier.html");

  await expect(page.locator("body")).toHaveClass(/page-parties/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Partierne lige nu");
  await expect.poll(async () => page.locator("#party-seat-legend .party-seat-row").count()).toBeGreaterThan(10);
  await expect.poll(async () => page.locator("#party-directory .party-row").count()).toBeGreaterThan(10);
});

test("favorites page shows empty-state guidance when no favorites are saved", async ({ page }) => {
  await page.goto("/favoritter.html");

  await expect(page.locator("body")).toHaveClass(/page-favorites/);
  await expect(page.locator("#favorites-summary")).toHaveText("Ingen favoritter endnu.");
  await expect(page.locator("#favorites-empty-intro")).not.toHaveClass(/hidden/);
  await expect(page.locator("#favorite-cases .panel-empty")).toHaveText("Ingen favoritsager endnu.");
  await expect(page.locator("#favorite-profiles .panel-empty")).toHaveText("Ingen favoritpolitikere endnu.");
});

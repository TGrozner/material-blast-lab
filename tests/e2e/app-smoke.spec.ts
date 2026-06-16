import { expect, type Locator, type Page, test } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const BODY_COUNT_BUDGET = { min: 350, max: 700 };
const SCORE_REVEAL_TIMEOUT_MS = 45_000;
const SETTINGS_STORAGE_KEY = "material-blast-lab:settings:v1";
const SMOKE_PERFORMANCE_SETTINGS = {
  graphicsQuality: "performance",
  antialias: false,
  masterVolume: 0,
  cameraShake: 0.2,
  motionEffects: false,
  showFps: true
};

test("renders the mobile city trial inside the initial body-count budget", async ({ page }) => {
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, MOBILE_VIEWPORT);

  await expect(page.locator(".hud")).toBeVisible();
  await expect(page.locator(".hud [data-role='chamber']")).toHaveText("Quarantine Junction");
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(fireButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Hammer" })).toBeVisible();
  await expectRenderableCanvas(page);
  await expectBodyCountWithinBudget(page);
  await expect(page.evaluate(isHudWithinViewport)).resolves.toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("selects a projectile, reveals the final score, then resets to a ready trial", async ({ page }) => {
  test.setTimeout(70_000);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, { width: 1024, height: 768 });
  await expectRenderableCanvas(page);

  await clickUi(page.getByRole("button", { name: "Hammer" }));
  await expectSelectedProjectile(page, "Hammer");

  await clickUi(page.getByRole("button", { name: "Gel" }));
  await expectSelectedProjectile(page, "Gel");

  await clickUi(fireButton(page));
  await expect(fireButton(page)).toBeDisabled();
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("SPENT");

  await expectFinalScore(page, "Gel Burst");

  await clickUi(page.getByRole("button", { name: "Retry" }));
  await expect(page.locator(".hud [data-role='score']")).toBeHidden();
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(fireButton(page)).toBeEnabled();
  await expectSelectedProjectile(page, "Gel");
  await expectBodyCountWithinBudget(page);
  expect(consoleErrors).toEqual([]);
});

test("persists real settings and applies the FPS toggle after reload", async ({ page }) => {
  test.setTimeout(70_000);
  const consoleErrors = trackRuntimeErrors(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expectRenderableCanvas(page);

  await openSettings(page);

  await clickUi(page.getByRole("button", { name: "Performance" }));
  await uncheckUi(page.locator("[data-setting='antialias']"));
  await setRange(page, "master-volume", 35);
  await setRange(page, "camera-shake", 20);
  await uncheckUi(page.locator("[data-setting='motion-effects']"));
  await uncheckUi(page.locator("[data-setting='show-fps']"));

  await openSettings(page);
  await expect(page.getByRole("button", { name: "Performance" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-role='master-volume']")).toHaveText("35%");
  await expect(page.locator("[data-role='camera-shake']")).toHaveText("20%");
  await expect.poll(() => page.evaluate(readSavedSettings)).toMatchObject({
    graphicsQuality: "performance",
    antialias: false,
    masterVolume: 0.35,
    cameraShake: 0.2,
    motionEffects: false,
    showFps: false
  });

  await page.reload();
  await expectRenderableCanvas(page);
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Performance" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-setting='antialias']")).not.toBeChecked();
  await expect(page.locator("[data-role='master-volume']")).toHaveText("35%");
  await expect(page.locator("[data-role='camera-shake']")).toHaveText("20%");
  await expect(page.locator("[data-setting='motion-effects']")).not.toBeChecked();
  await expect(page.locator("[data-setting='show-fps']")).not.toBeChecked();
  await expect(page.evaluate(hasWebglAntialias)).resolves.toBe(false);

  await clickUi(page.getByRole("button", { name: "Back" }));
  await clickUi(page.getByRole("button", { name: "Arcade" }).first());
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "play");
  await expect(page.locator(".hud [data-role='fps']")).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

function trackRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function bootTrial(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await useSmokePerformanceSettings(page);
  await page.setViewportSize(viewport);
  await page.goto("/");
  const startButton = page.locator("[data-action='start-arcade']").first();
  await expect(startButton).toBeVisible();
  await clickUi(startButton);
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "play");
}

async function clickUi(locator: Locator): Promise<void> {
  await locator.evaluate(
    (element) => {
      (element as HTMLElement).click();
    },
    undefined,
    { timeout: 10_000 }
  );
}

async function openSettings(page: Page): Promise<void> {
  if ((await page.locator(".hud").getAttribute("data-screen")) !== "settings") {
    await clickUi(page.getByRole("button", { name: "Settings" }));
  }
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "settings", { timeout: 10_000 });
}

async function uncheckUi(locator: Locator): Promise<void> {
  await locator.evaluate(
    (element) => {
      const input = element as HTMLInputElement;
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    undefined,
    { timeout: 10_000 }
  );
}

async function expectRenderableCanvas(page: Page): Promise<void> {
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(hasRenderableCanvasSize)).toBe(true);
  await expect.poll(() => page.evaluate(hasWebglContext)).toBe(true);
}

function fireButton(page: Page) {
  return page.locator(".hud__fire");
}

async function expectBodyCountWithinBudget(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(currentBodyCount)).toBeGreaterThanOrEqual(BODY_COUNT_BUDGET.min);
  await expect.poll(() => page.evaluate(currentBodyCount)).toBeLessThanOrEqual(BODY_COUNT_BUDGET.max);
}

async function expectSelectedProjectile(page: Page, shortName: string): Promise<void> {
  await expect(page.locator(".hud [data-role='projectile']")).toHaveText(shortName);
  await expect(page.getByRole("button", { name: shortName })).toHaveAttribute("aria-pressed", "true");
}

async function expectFinalScore(page: Page, shotName: string): Promise<void> {
  const scorePanel = page.locator(".hud [data-role='score']");
  await expect(scorePanel).toBeVisible({ timeout: SCORE_REVEAL_TIMEOUT_MS });
  await expect(scorePanel.locator(".hud__result-head")).toContainText(/Mission|Perfect/);
  await expect(scorePanel.locator(".hud__score-breakdown")).toContainText(shotName);
  await expect(scorePanel.locator(".hud__total strong")).toHaveText(/\d+/);
  await expect(scorePanel.getByText("Target core")).toBeVisible();
  await expect(scorePanel.getByText("Protected Penalty")).toBeVisible();
}

async function setRange(page: Page, setting: string, value: number): Promise<void> {
  await page.locator(`[data-setting='${setting}']`).evaluate(
    (element, nextValue) => {
      const input = element as HTMLInputElement;
      input.value = String(nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
    { timeout: 10_000 }
  );
}

function readSavedSettings(): Record<string, unknown> {
  const key = "material-blast-lab:settings:v1";
  return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
}

async function useSmokePerformanceSettings(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, settings }) => localStorage.setItem(key, JSON.stringify(settings)),
    { key: SETTINGS_STORAGE_KEY, settings: SMOKE_PERFORMANCE_SETTINGS }
  );
}

function hasRenderableCanvasSize(): boolean {
  const canvas = document.querySelector("canvas");
  return canvas instanceof HTMLCanvasElement && canvas.width >= 300 && canvas.height >= 300;
}

function hasWebglContext(): boolean {
  const canvas = document.querySelector("canvas");
  return canvas instanceof HTMLCanvasElement && Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}

function hasWebglAntialias(): boolean | null {
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return null;
  }
  const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  return context?.getContextAttributes()?.antialias ?? null;
}

function currentBodyCount(): number {
  return Number(document.querySelector(".hud [data-role='bodies']")?.textContent ?? 0);
}

function isHudWithinViewport(): boolean {
  const hud = document.querySelector(".hud");
  if (!hud) {
    return false;
  }
  const elements = [hud, ...Array.from(hud.querySelectorAll("*"))];
  return elements.every((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= window.innerWidth + 1;
  });
}

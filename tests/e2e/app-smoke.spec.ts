import { expect, type Locator, type Page, test } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const BODY_COUNT_BUDGET = { min: 350, max: 700 };
const UI_READY_TIMEOUT_MS = 15_000;
const SCORE_REVEAL_TIMEOUT_MS = 45_000;
const LONG_TEST_TIMEOUT_MS = 180_000;
const RUN_FULL_SIMULATION_SMOKE = !process.env.CI;
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
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, MOBILE_VIEWPORT);

  await expect(page.locator(".hud")).toBeVisible();
  await expect(page.locator(".hud [data-role='chamber']")).toHaveText("Hazard Junction");
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(fireButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Hammer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ignite" })).toBeVisible();
  await expectRenderableCanvas(page);
  await expectBodyCountWithinBudget(page);
  await expect(page.evaluate(isHudWithinViewport)).resolves.toBe(true);
  await expect(page.evaluate(mobileLayoutFailures)).resolves.toEqual([]);
  await expect(page.locator(".hud__command [data-action='level']")).toHaveCount(0);
  await expect(page.locator(".hud__command [data-action='clear']")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("selects a projectile, fires, then resets to a ready trial", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, { width: 1024, height: 768 });
  await expectRenderableCanvas(page);

  await clickUi(page.getByRole("button", { name: "Hammer" }));
  await expectSelectedProjectile(page, "Hammer");

  await clickUi(page.getByRole("button", { name: "Ripper" }));
  await expectSelectedProjectile(page, "Ripper");

  await clickUi(fireButton(page));
  await expect(fireButton(page)).toBeDisabled();
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("SPENT");

  if (RUN_FULL_SIMULATION_SMOKE) {
    await expectFinalScore(page, "Ripper Burst");
    await clickUi(page.locator("[data-action='result-retry']"));
  } else {
    await clickUi(page.locator("[data-action='reset']"));
  }

  await expect(page.locator(".hud [data-role='score']")).toBeHidden();
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(fireButton(page)).toBeEnabled();
  await expectSelectedProjectile(page, "Ripper");
  await expectBodyCountWithinBudget(page);
  expect(consoleErrors).toEqual([]);
});

test("persists real settings and applies the FPS toggle after reload", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await useSmokePerformanceSettings(page);
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
  await expect.poll(() => page.evaluate(readSavedSettings).catch(() => ({}))).toMatchObject({
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
  await expect(page.getByRole("checkbox", { name: "Anti-aliasing" })).not.toBeChecked({ timeout: UI_READY_TIMEOUT_MS });
  await expect(page.locator("[data-role='master-volume']")).toHaveText("35%");
  await expect(page.locator("[data-role='camera-shake']")).toHaveText("20%");
  await expect(page.getByRole("checkbox", { name: "Flash + slow-mo" })).not.toBeChecked({ timeout: UI_READY_TIMEOUT_MS });
  await expect(page.getByRole("checkbox", { name: "FPS counter" })).not.toBeChecked({ timeout: UI_READY_TIMEOUT_MS });
  await expect(page.evaluate(hasWebglAntialias)).resolves.toBe(false);

  if (process.env.CI) {
    expect(consoleErrors).toEqual([]);
    return;
  }

  await clickUi(page.getByRole("button", { name: "Back" }));
  await clickUi(page.getByRole("button", { name: "Arcade" }).first());
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "play");
  await expect(page.locator(".hud [data-role='fps']")).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

function trackRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !isIgnoredGpuConsoleError(text)) {
      errors.push(text);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function isIgnoredGpuConsoleError(text: string): boolean {
  return text.includes("THREE.WebGLProgram: Shader Error") || text.includes("THREE.THREE.WebGLProgram: Shader Error");
}

async function bootTrial(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await useSmokePerformanceSettings(page);
  await page.setViewportSize(viewport);
  await page.goto("/");
  const startButton = page.locator("[data-action='start-arcade']").first();
  await expect(startButton).toBeVisible({ timeout: UI_READY_TIMEOUT_MS });
  await clickUi(startButton);
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "play");
}

async function clickUi(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: UI_READY_TIMEOUT_MS });
  await locator.evaluate(
    (element) => {
      (element as HTMLElement).click();
    },
    undefined,
    { timeout: UI_READY_TIMEOUT_MS }
  );
}

async function openSettings(page: Page): Promise<void> {
  const hud = page.locator(".hud");
  await expect(hud).toBeAttached({ timeout: UI_READY_TIMEOUT_MS });
  if ((await hud.getAttribute("data-screen", { timeout: UI_READY_TIMEOUT_MS })) !== "settings") {
    await clickUi(page.getByRole("button", { name: "Settings" }));
  }
  await expect(hud).toHaveAttribute("data-screen", "settings", { timeout: UI_READY_TIMEOUT_MS });
}

async function uncheckUi(locator: Locator): Promise<void> {
  await expect(locator).toBeAttached({ timeout: UI_READY_TIMEOUT_MS });
  await locator.evaluate(
    (element) => {
      const input = element as HTMLInputElement;
      if (!input.checked) {
        return;
      }
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    undefined,
    { timeout: UI_READY_TIMEOUT_MS }
  );
  await expect(locator).not.toBeChecked({ timeout: UI_READY_TIMEOUT_MS });
}

async function expectRenderableCanvas(page: Page): Promise<void> {
  await expect(page.locator("canvas")).toBeVisible({ timeout: UI_READY_TIMEOUT_MS });
  await expect.poll(() => page.evaluate(hasRenderableCanvasSize).catch(() => false), { timeout: UI_READY_TIMEOUT_MS }).toBe(true);
  await expect.poll(() => page.evaluate(hasWebglContext).catch(() => false), { timeout: UI_READY_TIMEOUT_MS }).toBe(true);
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
  await expect(scorePanel.locator(".hud__result-head")).toContainText(/Mayhem/);
  await expect(scorePanel.locator(".hud__score-breakdown")).toContainText(shotName);
  await expect(scorePanel.locator(".hud__total strong")).toHaveText(/\d+/);
  await expect(scorePanel.getByText("Object damage")).toBeVisible();
  await expect(scorePanel.getByText("City Chaos")).toBeVisible();
}

async function setRange(page: Page, setting: string, value: number): Promise<void> {
  const locator = page.locator(`[data-setting='${setting}']`);
  await expect(locator).toBeAttached({ timeout: UI_READY_TIMEOUT_MS });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await locator.evaluate(
        (element, nextValue) => {
          const input = element as HTMLInputElement;
          input.value = String(nextValue);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        },
        value,
        { timeout: 10_000 }
      );
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes("Execution context was destroyed")) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded", { timeout: UI_READY_TIMEOUT_MS }).catch(() => {});
    }
  }
}

function readSavedSettings(): Record<string, unknown> {
  const key = "material-blast-lab:settings:v1";
  return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
}

async function useSmokePerformanceSettings(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, settings }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(settings));
      }
    },
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
  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const elements = [hud, ...Array.from(hud.querySelectorAll("*"))].filter(isVisible);
  return elements.every((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
  });
}

function mobileLayoutFailures(): string[] {
  const failures: string[] = [];
  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const command = document.querySelector(".hud__command");
  const topbar = document.querySelector(".hud__topbar");
  if (!(command instanceof HTMLElement) || !(topbar instanceof HTMLElement)) {
    return ["missing mobile HUD"];
  }

  const commandRect = command.getBoundingClientRect();
  const topbarRect = topbar.getBoundingClientRect();
  if (Math.ceil(commandRect.height) > 230) {
    failures.push(`mobile play dock too tall: ${Math.ceil(commandRect.height)}px`);
  }

  if (command.scrollHeight > command.clientHeight + 1) {
    failures.push("play command panel scrolls before primary controls fit");
  }

  if (topbarRect.bottom > commandRect.top - 16) {
    failures.push("top bar and command panel leave too little aim space");
  }

  const aimSpace = commandRect.top - topbarRect.bottom;
  if (aimSpace < 450) {
    failures.push(`aim space too small: ${Math.round(aimSpace)}px`);
  }

  const targetChecks: Array<[string, string, number, number]> = [
    ["fire", ".hud__fire", 44, 44],
    ["projectile", ".hud__projectile", 44, 40],
    ["utility", ".hud__utility button", 38, 38],
    ["menu", "[data-action='menu']", 38, 38]
  ];

  for (const [name, selector, minWidth, minHeight] of targetChecks) {
    for (const element of Array.from(document.querySelectorAll(selector)).filter(isVisible)) {
      const rect = element.getBoundingClientRect();
      if (rect.width < minWidth || rect.height < minHeight) {
        failures.push(`${name} target too small: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
  }

  return failures;
}

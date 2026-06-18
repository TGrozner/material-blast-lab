import { expect, type Locator, type Page, test } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const BODY_COUNT_BUDGET = { min: 350, max: 700 };
const BAKED_LEVEL_BODY_BUDGET = { min: 380, max: 620 };
const UI_READY_TIMEOUT_MS = 15_000;
const SCORE_REVEAL_TIMEOUT_MS = 45_000;
const LONG_TEST_TIMEOUT_MS = 180_000;
const RUN_FULL_SIMULATION_SMOKE = process.env.RUN_FULL_SIMULATION_SMOKE === "true";
const SETTINGS_STORAGE_KEY = "downtown-mayhem:settings:v1";
const ARCADE_PROGRESS_STORAGE_KEY = "downtown-mayhem:arcade-progress";
const STABLE_VISUAL_NOW = 1_710_000_000_000;
const SMOKE_PERFORMANCE_SETTINGS = {
  graphicsQuality: "performance",
  rendererBackend: "webgl",
  antialias: false,
  masterVolume: 0,
  cameraShake: 0.2,
  motionEffects: false,
  showFps: true
};
const STABLE_VISUAL_CAPTURE_SETTINGS = {
  ...SMOKE_PERFORMANCE_SETTINGS,
  cameraShake: 0,
  showFps: false
};
const HAZARD_JUNCTION_RENDER_BUDGET = {
  drawCalls: 5_150,
  visibleMeshes: 3_300,
  visibleMaterials: 340,
  programs: 22,
  geometries: 1_780,
  textures: 24
};

interface RenderStats {
  frame: number;
  levelName: string;
  rendererPreference: "auto" | "webgpu" | "webgl";
  rendererBackend: "webgpu" | "webgl2" | "webgl";
  bodyCount: number;
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
  visibleMeshes: number;
  visibleMaterials: number;
}

declare global {
  interface Window {
    __DOWNTOWN_MAYHEM_DEBUG__?: {
      getRenderStats(): RenderStats;
      getPerfReport(): unknown;
      setPerfEnabled(enabled: boolean): void;
      clearPerfReport(): void;
      freezeForCapture(): RenderStats;
      resume(): void;
    };
  }
}

test("renders the mobile city trial inside the initial body-count budget", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, MOBILE_VIEWPORT);

  await expect(page.locator(".hud")).toBeVisible();
  await expect(page.locator(".hud [data-role='chamber']")).toHaveText("Hazard Junction");
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(fireButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Heavy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Impulse" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ignite" })).toHaveCount(0);
  await expectRenderableCanvas(page);
  await expectBodyCountWithinBudget(page);
  await expect(page.evaluate(isHudWithinViewport)).resolves.toBe(true);
  await expect(page.evaluate(mobileLayoutFailures)).resolves.toEqual([]);
  await expect(page.locator(".hud__command [data-action='level']")).toHaveCount(0);
  await expect(page.locator(".hud__command [data-action='clear']")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("shows a clear three-level selector without free play", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await useSmokePerformanceSettings(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  await expect(page).toHaveTitle("Downtown Mayhem");
  await expect(page.locator(".app-shell__brand")).toContainText("Downtown Mayhem");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "menu");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator("[data-action='start-free']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Free Play" })).toHaveCount(0);
  await expect(page.locator("[data-role='shell-levels'] [data-action='start-arcade']")).toHaveCount(3);
  await expect(levelCard(page, "Hazard Junction")).toBeVisible();
  await expect(levelCard(page, "Breaker Yard")).toBeVisible();
  await expect(levelCard(page, "Switchback Crush")).toBeVisible();
  await expect(levelCard(page, "Hazard Junction")).toBeEnabled();
  await expect(levelCard(page, "Breaker Yard")).toBeDisabled();
  await expect(levelCard(page, "Switchback Crush")).toBeDisabled();
  await expect(page.getByText("Crosswind Depot")).toHaveCount(0);

  await clickUi(levelCard(page, "Hazard Junction"));
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "play");
  await expect(page.locator(".hud [data-role='chamber']")).toHaveText("Hazard Junction");
  await expectBodyCountWithinBudget(page);
  expect(consoleErrors).toEqual([]);
});

test("keeps the initial city render inside draw-call budgets and visually stable", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await useStableVisualCapture(page);
  await bootTrial(page, { width: 1024, height: 768 });
  const stats = await waitForRenderStats(page);

  expect(stats.levelName).toBe("Hazard Junction");
  expect(stats.bodyCount).toBeGreaterThanOrEqual(BODY_COUNT_BUDGET.min);
  expect(stats.bodyCount).toBeLessThanOrEqual(BODY_COUNT_BUDGET.max);
  expect(stats.drawCalls).toBeLessThanOrEqual(HAZARD_JUNCTION_RENDER_BUDGET.drawCalls);
  expect(stats.visibleMeshes).toBeLessThanOrEqual(HAZARD_JUNCTION_RENDER_BUDGET.visibleMeshes);
  expect(stats.visibleMaterials).toBeLessThanOrEqual(HAZARD_JUNCTION_RENDER_BUDGET.visibleMaterials);
  expect(stats.programs).toBeLessThanOrEqual(HAZARD_JUNCTION_RENDER_BUDGET.programs);
  expect(stats.geometries).toBeLessThanOrEqual(HAZARD_JUNCTION_RENDER_BUDGET.geometries);
  expect(stats.textures).toBeLessThanOrEqual(HAZARD_JUNCTION_RENDER_BUDGET.textures);

  const frozenStats = await freezeForCapture(page);
  expect(frozenStats.drawCalls).toBeLessThanOrEqual(HAZARD_JUNCTION_RENDER_BUDGET.drawCalls);
  await page.addStyleTag({ content: ".hud { visibility: hidden !important; }" });
  await expect(page.locator("canvas")).toHaveScreenshot("hazard-junction-initial-canvas.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.015,
    scale: "css",
    threshold: 0.2
  });
  await page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.resume());
  expect(consoleErrors).toEqual([]);
});

test("boots the auto renderer with a WebGPU or WebGL2 backend", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await page.addInitScript(
    ({ key, settings }) => {
      localStorage.setItem(key, JSON.stringify(settings));
    },
    { key: SETTINGS_STORAGE_KEY, settings: { ...SMOKE_PERFORMANCE_SETTINGS, rendererBackend: "auto" } }
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await clickUi(page.locator("[data-action='start-arcade']").first());
  await expectRenderableCanvas(page);
  const stats = await waitForRenderStats(page);

  expect(stats.rendererPreference).toBe("auto");
  expect(["webgpu", "webgl2", "webgl"]).toContain(stats.rendererBackend);
  expect(consoleErrors).toEqual([]);
});

test("loads the baked second and third city levels inside their object budgets", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await useSmokePerformanceSettings(page);
  await seedArcadeProgress(page, { "hazard-junction": 2, "breaker-yard": 2 });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  for (const levelName of ["Breaker Yard", "Switchback Crush"]) {
    await clickUi(levelCard(page, levelName));
    await expect(page.locator(".hud [data-role='chamber']")).toHaveText(levelName, { timeout: UI_READY_TIMEOUT_MS });
    await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
    await expectRenderableCanvas(page);
    await expectBodyCountWithinBudget(page, BAKED_LEVEL_BODY_BUDGET);
    await clickUi(page.getByRole("button", { name: "Menu" }));
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "menu");
    await expect(page.locator("canvas")).toHaveCount(0);
  }

  expect(consoleErrors).toEqual([]);
});

test("selects a projectile, fires, then resets to a ready trial", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, { width: 1024, height: 768 });
  await expectRenderableCanvas(page);

  await clickUi(page.getByRole("button", { name: "Heavy" }));
  await expectSelectedProjectile(page, "Heavy");

  await clickUi(page.getByRole("button", { name: "Frag" }));
  await expectSelectedProjectile(page, "Frag");

  await clickUi(fireButton(page));
  await expect(fireButton(page)).toBeDisabled();
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("SPENT");

  if (RUN_FULL_SIMULATION_SMOKE) {
    const finishRunButton = page.locator("[data-action='finish-run']");
    await expect(finishRunButton).toBeVisible({ timeout: SCORE_REVEAL_TIMEOUT_MS });
    await expect(page.locator("[data-role='finish-hint']")).toHaveText("Done watching? Press F or Enter, or click Score Now.");
    await expect(page.locator("[data-role='finish-hint']")).toBeVisible();
    await clickUi(finishRunButton);
    await expectFinalScore(page, "Fragmentation Cluster");
    await clickUi(page.locator("[data-action='result-retry']"));
  } else {
    await clickUi(page.locator("[data-action='reset']"));
  }

  await expect(page.locator(".hud [data-role='score']")).toBeHidden();
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(fireButton(page)).toBeEnabled();
  await expectSelectedProjectile(page, "Frag");
  await expectBodyCountWithinBudget(page);
  expect(consoleErrors).toEqual([]);
});

test("persists real settings and applies the FPS toggle after reload", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await useSmokePerformanceSettings(page);
  await page.goto("/");

  await openSettings(page);

  await clickUi(page.getByRole("button", { name: "Performance" }));
  await uncheckUi(page.locator("[data-setting='antialias']"));
  await setRange(page, "master-volume", 35);
  await setRange(page, "camera-shake", 20);
  await uncheckUi(page.locator("[data-setting='motion-effects']"));
  await uncheckUi(page.locator("[data-setting='show-fps']"));

  await openSettings(page);
  await expect(page.getByRole("button", { name: "Performance" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-role='shell-master-volume']")).toHaveText("35%");
  await expect(page.locator("[data-role='shell-camera-shake']")).toHaveText("20%");
  await expect.poll(() => page.evaluate(readSavedSettings).catch(() => ({}))).toMatchObject({
    graphicsQuality: "performance",
    rendererBackend: "webgl",
    antialias: false,
    masterVolume: 0.35,
    cameraShake: 0.2,
    motionEffects: false,
    showFps: false
  });

  await page.reload();
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Performance" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "WebGL" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox", { name: "Anti-aliasing" })).not.toBeChecked({ timeout: UI_READY_TIMEOUT_MS });
  await expect(page.locator("[data-role='shell-master-volume']")).toHaveText("35%");
  await expect(page.locator("[data-role='shell-camera-shake']")).toHaveText("20%");
  await expect(page.getByRole("checkbox", { name: "Flash + slow-mo" })).not.toBeChecked({ timeout: UI_READY_TIMEOUT_MS });
  await expect(page.getByRole("checkbox", { name: "FPS counter" })).not.toBeChecked({ timeout: UI_READY_TIMEOUT_MS });

  if (process.env.CI) {
    expect(consoleErrors).toEqual([]);
    return;
  }

  await clickUi(page.getByRole("button", { name: "Back" }));
  await clickUi(levelCard(page, "Hazard Junction"));
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "play");
  await expectRenderableCanvas(page);
  await expect(page.evaluate(hasWebglAntialias)).resolves.toBe(false);
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
  const shell = page.locator(".app-shell");
  await expect(shell).toBeAttached({ timeout: UI_READY_TIMEOUT_MS });
  if ((await shell.getAttribute("data-screen", { timeout: UI_READY_TIMEOUT_MS })) !== "settings") {
    await clickUi(page.getByRole("button", { name: "Settings" }));
  }
  await expect(shell).toHaveAttribute("data-screen", "settings", { timeout: UI_READY_TIMEOUT_MS });
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
  await expect.poll(() => page.evaluate(hasInitializedRenderer).catch(() => false), { timeout: UI_READY_TIMEOUT_MS }).toBe(true);
}

function fireButton(page: Page) {
  return page.locator(".hud__fire");
}

function levelCard(page: Page, name: string): Locator {
  return page.locator("[data-role='shell-levels'] [data-action='start-arcade']").filter({ hasText: name }).first();
}

async function expectBodyCountWithinBudget(page: Page, budget = BODY_COUNT_BUDGET): Promise<void> {
  await expect.poll(() => page.evaluate(currentBodyCount)).toBeGreaterThanOrEqual(budget.min);
  await expect.poll(() => page.evaluate(currentBodyCount)).toBeLessThanOrEqual(budget.max);
}

async function expectSelectedProjectile(page: Page, shortName: string): Promise<void> {
  await expect(page.locator(".hud [data-role='projectile']")).toHaveText(shortName);
  await expect(page.getByRole("button", { name: shortName })).toHaveAttribute("aria-pressed", "true");
}

async function expectFinalScore(page: Page, shotName: string): Promise<void> {
  const scorePanel = page.locator(".hud [data-role='score']");
  await expect(scorePanel).toBeVisible({ timeout: SCORE_REVEAL_TIMEOUT_MS });
  await expect(scorePanel.locator(".hud__result-head")).toContainText(/Mayhem|Needs 2 Stars/);
  await expect(scorePanel.locator(".hud__score-breakdown")).toContainText(shotName);
  await expect(scorePanel.locator(".hud__total strong")).toHaveText(/\d+/);
  await expect(scorePanel.getByText("Object damage")).toBeVisible();
  await expect(scorePanel.getByText("Collateral Chaos")).toBeVisible();
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
  const key = "downtown-mayhem:settings:v1";
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

async function useStableVisualCapture(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, settings, now }) => {
      localStorage.setItem(key, JSON.stringify(settings));
      Date.now = () => now;
      Math.random = () => 0.42;
    },
    { key: SETTINGS_STORAGE_KEY, settings: STABLE_VISUAL_CAPTURE_SETTINGS, now: STABLE_VISUAL_NOW }
  );
}

async function waitForRenderStats(page: Page): Promise<RenderStats> {
  await expect.poll(() => page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderStats().drawCalls ?? 0), {
    timeout: UI_READY_TIMEOUT_MS
  }).toBeGreaterThan(0);
  return page.evaluate(() => {
    const stats = window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderStats();
    if (!stats) {
      throw new Error("Missing Downtown Mayhem render stats");
    }
    return stats;
  });
}

async function freezeForCapture(page: Page): Promise<RenderStats> {
  return page.evaluate(() => {
    const stats = window.__DOWNTOWN_MAYHEM_DEBUG__?.freezeForCapture();
    if (!stats) {
      throw new Error("Missing Downtown Mayhem render stats");
    }
    return stats;
  });
}

async function seedArcadeProgress(page: Page, starsByLevel: Record<string, 0 | 1 | 2 | 3>): Promise<void> {
  await page.addInitScript(
    ({ key, stars }) => {
      const levelIds = ["hazard-junction", "breaker-yard", "switchback-crush"];
      let highestUnlockedLevel = 0;
      for (let index = 0; index < levelIds.length - 1; index += 1) {
        if (Number(stars[levelIds[index]] ?? 0) < 2) {
          break;
        }
        highestUnlockedLevel = index + 1;
      }
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          highestUnlockedLevel,
          totalStars: levelIds.reduce((total, id) => total + Number(stars[id] ?? 0), 0),
          levels: Object.fromEntries(
            levelIds.map((id) => {
              const levelStars = Number(stars[id] ?? 0);
              return [
                id,
                {
                  attempts: levelStars > 0 ? 1 : 0,
                  bestScore: levelStars > 0 ? 999_999 : 0,
                  stars: levelStars,
                  completed: levelStars >= 2
                }
              ];
            })
          )
        })
      );
    },
    { key: ARCADE_PROGRESS_STORAGE_KEY, stars: starsByLevel }
  );
}

function hasRenderableCanvasSize(): boolean {
  const canvas = document.querySelector("canvas");
  return canvas instanceof HTMLCanvasElement && canvas.width >= 300 && canvas.height >= 300;
}

function hasInitializedRenderer(): boolean {
  return Boolean(window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderStats().rendererBackend);
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

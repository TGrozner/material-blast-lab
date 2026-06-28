import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";

const MOBILE_PORTRAIT_VIEWPORT = { width: 390, height: 844 };
const MOBILE_LANDSCAPE_VIEWPORT = { width: 844, height: 390 };
const BODY_COUNT_BUDGET = { min: 350, max: 700 };
const BAKED_LEVEL_BODY_BUDGET = { min: 380, max: 620 };
const UI_READY_TIMEOUT_MS = 15_000;
const LEVEL_START_TIMEOUT_MS = process.env.CI ? 60_000 : 30_000;
const SCORE_REVEAL_TIMEOUT_MS = 45_000;
const LONG_TEST_TIMEOUT_MS = 180_000;
const RUN_FULL_SIMULATION_SMOKE = process.env.RUN_FULL_SIMULATION_SMOKE === "true";
const RUN_PERF_SMOKE = process.env.DOWNTOWN_MAYHEM_PERF_SMOKE === "true";
const SETTINGS_STORAGE_KEY = "downtown-mayhem:settings:v1";
const ARCADE_PROGRESS_STORAGE_KEY = "downtown-mayhem:arcade-progress";
const SMOKE_URL = "/?smoke=1";
const PERF_SMOKE_URL = "/?smoke=1&perfFull=1";
const STABLE_VISUAL_NOW = 1_710_000_000_000;
const SMOKE_PERFORMANCE_SETTINGS = {
  graphicsQuality: "performance",
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
  drawCalls: 4_550,
  visibleMeshes: 3_020,
  visibleMaterials: 340,
  programs: 32,
  geometries: 1_300,
  textures: 42
};
const PERF_SMOKE_BUDGET = {
  maxFrameMs: 360,
  shotMaxFrameMs: 280,
  slowRatioPercent: 35,
  maxPostShotDrawCalls: 5_200,
  maxPostShotTextures: 50,
  maxProgramsCreatedAfterWarmup: 2,
  maxDroppedSubsteps: 8,
  maxVisiblePooledVfxObjects: 0
};

interface RenderStats {
  frame: number;
  levelName: string;
  rendererBackend: "webgl2" | "webgl";
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
  visiblePooledVfxObjects: number;
  fragmentInstanceBuckets: number;
  fragmentInstanceVisibleBuckets: number;
  fragmentInstanceWarmupBuckets: number;
  fragmentInstanceOverflowBuckets: number;
}

interface RenderWarmupState {
  phase: "idle" | "warming" | "ready" | "failed";
}

type CannonVisualState = "loading" | "ready" | "fallback";

interface PerfLogPayload {
  href: string;
  reason: string;
  summary: {
    frameCount: number;
    slowFrameCount: number;
    slowRatioPercent: number;
    maxFrame: { totalMs: number } | null;
    shotMax: { totalMs: number; droppedSubstepsInFrame: number };
    shotTotals: { droppedSubsteps: number };
  };
  stats: RenderStats;
  warmup: RenderWarmupState;
  report?: {
    counterTotals: Record<string, number>;
  };
}

declare global {
  interface Window {
    __DOWNTOWN_MAYHEM_DEBUG__?: {
      getRenderStats(): RenderStats;
      getPerfReport(): unknown;
      getRenderWarmupState(): RenderWarmupState;
      getCannonVisualState(): CannonVisualState;
      setPerfEnabled(enabled: boolean): void;
      clearPerfReport(): void;
      flushPerfLog(reason?: string): void;
      freezeForCapture(): RenderStats;
      resume(): void;
    };
  }
}

test("renders a playable mobile portrait city trial inside the initial body-count budget", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, MOBILE_PORTRAIT_VIEWPORT);

  await expect(page.locator(".hud")).toBeVisible();
  await expect(fireButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Heavy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Impulse" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ignite" })).toHaveCount(0);
  await expectRenderableCanvas(page);
  await expectBodyCountWithinBudget(page);
  await expect(page.evaluate(isHudWithinViewport)).resolves.toBe(true);
  await expect(page.evaluate(mobilePlayLayoutFailures)).resolves.toEqual([]);
  await expect(page.locator(".hud__rotate-phone")).toHaveCount(0);
  await expect(page.locator(".hud__command [data-action='level']")).toHaveCount(0);
  await expect(page.locator(".hud__command [data-action='clear']")).toHaveCount(0);
  await clickUi(fireButton(page));
  await expect(page.locator(".hud")).toHaveClass(/is-post-shot/);
  expect(consoleErrors).toEqual([]);
});

test("renders a playable mobile landscape city trial inside the initial body-count budget", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, MOBILE_LANDSCAPE_VIEWPORT);

  await expect(page.locator(".hud")).toBeVisible();
  await expect(fireButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Heavy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Impulse" })).toBeVisible();
  await expectRenderableCanvas(page);
  await expectBodyCountWithinBudget(page);
  await expect(page.evaluate(isHudWithinViewport)).resolves.toBe(true);
  await expect(page.evaluate(mobilePlayLayoutFailures)).resolves.toEqual([]);
  await clickUi(page.getByRole("button", { name: "Menu" }));
  await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "menu");
  expect(consoleErrors).toEqual([]);
});

test("switches mobile portrait to a frictionless post-shot turn prompt", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, MOBILE_PORTRAIT_VIEWPORT);
  await expectRenderableCanvas(page);

  await clickUi(fireButton(page));
  await expect(page.locator(".hud")).toHaveClass(/is-post-shot/);
  await expect(page.locator(".hud__command")).toBeHidden();
  const turnPrompt = page.locator("[data-action='turn-finish']");
  await expect(turnPrompt).toBeVisible();
  await expect(turnPrompt).toContainText(/Watching mayhem|Tap to score/);
  await expect(page.evaluate(mobilePostShotLayoutFailures)).resolves.toEqual([]);

  expect(consoleErrors).toEqual([]);
});

test("lets mobile tap the post-shot prompt to reveal the score", async ({ page }) => {
  test.skip(!RUN_FULL_SIMULATION_SMOKE, "Set RUN_FULL_SIMULATION_SMOKE=true to run the full mobile score flow.");
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, MOBILE_PORTRAIT_VIEWPORT);
  await expectRenderableCanvas(page);

  await clickUi(fireButton(page));
  const turnPrompt = page.locator("[data-action='turn-finish']");
  await expect(turnPrompt).toBeVisible();
  await expect(turnPrompt).toBeEnabled({ timeout: SCORE_REVEAL_TIMEOUT_MS });
  await expect(turnPrompt).toContainText("Tap to score");
  await clickUi(turnPrompt);
  await expectFinalScore(page, "Normal Shell");

  expect(consoleErrors).toEqual([]);
});

test("shows a clear three-level selector without free play", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await useSmokePerformanceSettings(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(SMOKE_URL);

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
  await expectLevelReady(page, "Hazard Junction");
  await expectBodyCountWithinBudget(page);
  expect(consoleErrors).toEqual([]);
});

test("arms the RC crash run before launching on mobile", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await useSmokePerformanceSettings(page);
  await page.setViewportSize(MOBILE_PORTRAIT_VIEWPORT);
  await page.goto(SMOKE_URL);

  await clickUi(page.locator("[data-mode='plane']"));
  await clickUi(levelCard(page, "Hazard Junction"));
  await expectLevelReady(page, "Hazard Junction");
  await expectRenderableCanvas(page);
  await expect(page.locator(".hud")).toHaveClass(/is-plane-mode/);
  await expect(page.locator(".hud [data-role='mode-label']")).toHaveText("RC Crash Run");
  await expect(page.locator(".hud [data-role='loadout-label']")).toHaveText("Vehicle");
  await expect(page.locator(".hud [data-role='projectile']")).toHaveText("RC Plane");
  await expect(fireButton(page)).toHaveText("START RUN");
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(page.getByRole("button", { name: "Heavy" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "W" })).toHaveCount(0);
  await expect(page.locator(".hud__plane-boost")).toBeHidden();
  await expect(page.evaluate(mobilePlaneReadyLayoutFailures)).resolves.toEqual([]);

  await clickUi(fireButton(page));
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("AIRBORNE");
  await expect(page.locator(".hud")).toHaveClass(/is-plane-flying/);
  await expect(page.locator(".hud__fire")).toBeHidden();
  await expect(page.locator("[data-action='reset']")).toBeVisible();
  await expect(page.locator(".hud__plane-boost")).toBeVisible();
  await expect(page.evaluate(mobilePlaneFlightLayoutFailures)).resolves.toEqual([]);

  await clickUi(page.locator("[data-action='reset']"));
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(page.locator(".hud__plane-boost")).toBeHidden();
  await expect(page.locator(".hud__command")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("keeps the initial city render inside draw-call budgets and visually stable", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await useStableVisualCapture(page);
  await bootTrial(page, { width: 1024, height: 768 });
  await waitForRenderWarmupReady(page);
  await waitForCannonVisualReady(page);
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

test("ignores stale renderer preferences and boots WebGL", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await page.addInitScript(
    ({ key, settings }) => {
      localStorage.setItem(key, JSON.stringify(settings));
    },
    { key: SETTINGS_STORAGE_KEY, settings: { ...SMOKE_PERFORMANCE_SETTINGS, rendererBackend: "legacy-renderer" } }
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(SMOKE_URL);
  await clickUi(page.locator("[data-action='start-arcade']").first());
  await expectLevelReady(page, "Hazard Junction");
  await expectRenderableCanvas(page);
  const stats = await waitForRenderStats(page);

  expect(["webgl2", "webgl"]).toContain(stats.rendererBackend);
  expect(consoleErrors).toEqual([]);
});

test("loads the baked second and third city levels inside their object budgets", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await useSmokePerformanceSettings(page);
  await seedArcadeProgress(page, { "hazard-junction": 2, "breaker-yard": 2 });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(SMOKE_URL);

  for (const levelName of ["Breaker Yard", "Switchback Crush"]) {
    await clickUi(levelCard(page, levelName));
    await expectLevelReady(page, levelName);
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
    await expect(page.locator("[data-role='finish-hint']")).toHaveText("Done watching the run? Press F or Enter, or click Score Now.");
    await expect(page.locator("[data-role='finish-hint']")).toBeVisible();
    await clickUi(finishRunButton);
    await expectFinalScore(page, "Fragmentation Cluster");
    await clickUi(page.locator("[data-action='result-retry']"));
  } else {
    await clickUi(page.locator("[data-action='reset']"));
  }

  await expect(page.locator(".hud [data-role='score']")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderWarmupState().phase), {
      timeout: LEVEL_START_TIMEOUT_MS
    })
    .toBe("ready");
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect(fireButton(page)).toBeEnabled();
  await expectSelectedProjectile(page, "Frag");
  await expectBodyCountWithinBudget(page);
  expect(consoleErrors).toEqual([]);
});

test("uses Space as game input after pointer-clicking Retry", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await bootTrial(page, { width: 1024, height: 768 });
  await expectRenderableCanvas(page);

  const resetButton = page.locator("[data-action='reset']");
  await expect(resetButton).toBeVisible({ timeout: UI_READY_TIMEOUT_MS });
  await resetButton.click({ timeout: UI_READY_TIMEOUT_MS });
  await expect
    .poll(() => page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderWarmupState().phase), {
      timeout: LEVEL_START_TIMEOUT_MS
    })
    .toBe("ready");
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY", { timeout: UI_READY_TIMEOUT_MS });

  await page.keyboard.press("Space");

  await expect(page.locator(".hud [data-role='shots']")).toHaveText("SPENT", { timeout: UI_READY_TIMEOUT_MS });
  await expect(fireButton(page)).toBeDisabled();
  expect(consoleErrors).toEqual([]);
});

test("records post-shot perf budgets", async ({ page }) => {
  test.skip(!RUN_PERF_SMOKE, "Set DOWNTOWN_MAYHEM_PERF_SMOKE=true to run the perf smoke.");
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);
  await rm(perfLogDir(), { force: true, recursive: true });

  await useSmokePerformanceSettings(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(PERF_SMOKE_URL);
  await clickUi(page.locator("[data-action='start-arcade']").first());
  await expectLevelReady(page, "Hazard Junction");
  await expectRenderableCanvas(page);
  await expect(page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getPerfReport())).resolves.toMatchObject({
    enabled: true
  });

  await clickUi(page.getByRole("button", { name: "Frag" }));
  await clickUi(fireButton(page));
  const finishRunButton = page.locator("[data-action='finish-run']");
  await expect(finishRunButton).toBeVisible({ timeout: SCORE_REVEAL_TIMEOUT_MS });
  await clickUi(finishRunButton);
  await expectFinalScore(page, "Fragmentation Cluster");
  await page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.flushPerfLog("perf-smoke-first-shot"));

  const payload = await waitForPerfLog("perf-smoke-first-shot");
  expectPerfBudget(payload, { checkSlowRatio: false });

  await clickUi(page.locator("[data-action='result-retry']"));
  await expect(page.locator(".hud [data-role='score']")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderWarmupState().phase), {
      timeout: LEVEL_START_TIMEOUT_MS
    })
    .toBe("ready");
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY");
  await expect.poll(() => page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderStats().visiblePooledVfxObjects ?? -1)).toBe(0);
  await expect(fireButton(page)).toBeEnabled();

  await clickUi(fireButton(page));
  await expect(finishRunButton).toBeVisible({ timeout: SCORE_REVEAL_TIMEOUT_MS });
  await clickUi(finishRunButton);
  await expectFinalScore(page, "Fragmentation Cluster");
  await page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.flushPerfLog("perf-smoke-post-reset-final"));

  const postResetPayload = await waitForPerfLog("perf-smoke-post-reset-final");
  expectPerfBudget(postResetPayload, { checkSlowRatio: false });
  expect(consoleErrors).toEqual([]);
});

function expectPerfBudget(payload: PerfLogPayload, options: { checkSlowRatio?: boolean } = {}): void {
  expect(payload.href).toContain("perfFull");
  expect(payload.summary.frameCount).toBeGreaterThan(0);
  expect(payload.summary.maxFrame?.totalMs ?? 0).toBeLessThanOrEqual(PERF_SMOKE_BUDGET.maxFrameMs);
  expect(payload.summary.shotMax.totalMs).toBeLessThanOrEqual(PERF_SMOKE_BUDGET.shotMaxFrameMs);
  if (options.checkSlowRatio !== false) {
    expect(payload.summary.slowRatioPercent).toBeLessThanOrEqual(PERF_SMOKE_BUDGET.slowRatioPercent);
  }
  expect(payload.summary.shotTotals.droppedSubsteps).toBeLessThanOrEqual(PERF_SMOKE_BUDGET.maxDroppedSubsteps);
  expect(payload.stats.drawCalls).toBeLessThanOrEqual(PERF_SMOKE_BUDGET.maxPostShotDrawCalls);
  expect(payload.stats.textures).toBeLessThanOrEqual(PERF_SMOKE_BUDGET.maxPostShotTextures);
  expect(payload.warmup.phase).toBe("ready");
  expect(payload.stats.visiblePooledVfxObjects).toBeLessThanOrEqual(PERF_SMOKE_BUDGET.maxVisiblePooledVfxObjects);
  expect(payload.report?.counterTotals["renderer.programsCreatedAfterWarmup"] ?? 0).toBeLessThanOrEqual(
    PERF_SMOKE_BUDGET.maxProgramsCreatedAfterWarmup
  );
}

test("persists real settings and applies the FPS toggle after reload", async ({ page }) => {
  test.setTimeout(LONG_TEST_TIMEOUT_MS);
  const consoleErrors = trackRuntimeErrors(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await useSmokePerformanceSettings(page);
  await page.goto(SMOKE_URL);

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
    antialias: false,
    masterVolume: 0.35,
    cameraShake: 0.2,
    motionEffects: false,
    showFps: false
  });

  await page.reload();
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Performance" })).toHaveAttribute("aria-pressed", "true");
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
  await expectLevelReady(page, "Hazard Junction");
  await expectRenderableCanvas(page);
  await expect(page.evaluate(hasWebglAntialias)).resolves.toBe(false);
  await expect(page.locator(".hud [data-role='fps']")).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

function trackRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !isIgnoredBrowserBackendConsoleError(text)) {
      errors.push(text);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function isIgnoredBrowserBackendConsoleError(text: string): boolean {
  return (
    text.includes("THREE.WebGLProgram: Shader Error") ||
    text.includes("THREE.THREE.WebGLProgram: Shader Error") ||
    text.includes("The AudioContext encountered an error from the audio device or the WebAudio renderer.")
  );
}

async function bootTrial(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await useSmokePerformanceSettings(page);
  await page.setViewportSize(viewport);
  await page.goto(SMOKE_URL);
  const startButton = page.locator("[data-action='start-arcade']").first();
  await expect(startButton).toBeVisible({ timeout: UI_READY_TIMEOUT_MS });
  await clickUi(startButton);
  await expectLevelReady(page, "Hazard Junction");
}

async function expectLevelReady(page: Page, levelName: string): Promise<void> {
  await expect(page.locator(".hud")).toHaveAttribute("data-screen", "play", { timeout: LEVEL_START_TIMEOUT_MS });
  await expect(page.locator(".hud [data-role='chamber']")).toHaveText(levelName, { timeout: UI_READY_TIMEOUT_MS });
  await expect(page.locator(".hud [data-role='shots']")).toHaveText("READY", { timeout: UI_READY_TIMEOUT_MS });
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
  await expect(scorePanel).toHaveAttribute("data-result-state", /three-star|complete|one-star|incomplete/);
  await expect(scorePanel.locator(".hud__result-head")).toContainText(/Mayhem|Needs 2 Stars/);
  await expect(scorePanel.locator(".hud__score-breakdown")).toContainText(shotName);
  await expect(scorePanel.locator(".hud__result-actions .is-primary")).toBeVisible();
  await expect(scorePanel.locator(".hud__total strong")).toHaveText(/\d+/);
  await expect(scorePanel.locator("[data-role='result-total']")).toHaveText(/\d+/);
  await expect(scorePanel.getByText("Object damage", { exact: true })).toBeVisible();
  await expect(scorePanel.getByText("Collateral Chaos", { exact: true })).toBeVisible();
  await expect(scorePanel.getByText("Secondary Hits", { exact: true })).toBeVisible();
}

async function waitForPerfLog(reason?: string): Promise<PerfLogPayload> {
  const latestPath = perfLatestPath();
  let matchedPayload: PerfLogPayload | null = null;
  await expect
    .poll(
      async () => {
        matchedPayload = await findPerfLogPayload(latestPath, reason);
        return Boolean(matchedPayload);
      },
      { timeout: UI_READY_TIMEOUT_MS }
    )
    .toBe(true);
  if (!matchedPayload) {
    throw new Error(`Missing perf log payload${reason ? ` for ${reason}` : ""}`);
  }
  return matchedPayload;
}

async function findPerfLogPayload(latestPath: string, reason?: string): Promise<PerfLogPayload | null> {
  try {
    await access(latestPath);
    const payload = JSON.parse(await readFile(latestPath, "utf8")) as PerfLogPayload;
    if (matchesPerfLogPayload(payload, reason)) {
      return payload;
    }
  } catch {
    // The session jsonl may already contain the target entry even if latest.json
    // is temporarily between writes.
  }

  try {
    const logDir = path.dirname(latestPath);
    const sessionId = (await readFile(path.join(logDir, "latest-session.txt"), "utf8")).trim();
    const lines = (await readFile(path.join(logDir, `${sessionId}.jsonl`), "utf8")).trim().split(/\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const payload = JSON.parse(lines[index]) as PerfLogPayload;
      if (matchesPerfLogPayload(payload, reason)) {
        return payload;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function matchesPerfLogPayload(payload: PerfLogPayload, reason?: string): boolean {
  return payload.href.includes("perfFull") && payload.summary.frameCount > 0 && (!reason || payload.reason === reason);
}

function perfLatestPath(): string {
  return path.join(perfLogDir(), "latest.json");
}

function perfLogDir(): string {
  return path.resolve(process.cwd(), process.env.DOWNTOWN_MAYHEM_PERF_DIR ?? "test-results/perf-logs");
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

async function waitForCannonVisualReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getCannonVisualState() ?? "loading"), {
      timeout: UI_READY_TIMEOUT_MS
    })
    .not.toBe("loading");
}

async function waitForRenderWarmupReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderWarmupState().phase ?? "idle"), {
      timeout: LEVEL_START_TIMEOUT_MS
    })
    .toBe("ready");
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

function mobilePlayLayoutFailures(): string[] {
  const failures: string[] = [];
  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const coveredPlayAreaFailures = (hudSelectors: string[]): string[] => {
    const covered: string[] = [];
    const samples: Array<[number, number]> = [
      [0.5, 0.34],
      [0.5, 0.46],
      [0.42, 0.5],
      [0.58, 0.5]
    ];
    for (const [xRatio, yRatio] of samples) {
      const x = Math.round(window.innerWidth * xRatio);
      const y = Math.round(window.innerHeight * yRatio);
      const element = document.elementFromPoint(x, y);
      if (element?.closest(hudSelectors.join(","))) {
        covered.push(`play area sample covered at ${Math.round(xRatio * 100)}%/${Math.round(yRatio * 100)}%`);
      }
    }
    return covered;
  };
  const overlappingInteractiveFailures = (): string[] => {
    const overlapping: string[] = [];
    const controls = Array.from(document.querySelectorAll("button"))
      .filter((element): element is HTMLButtonElement => isVisible(element))
      .map((element) => ({
        label: (element.textContent ?? element.getAttribute("aria-label") ?? "button").trim(),
        rect: element.getBoundingClientRect()
      }));

    for (let index = 0; index < controls.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < controls.length; otherIndex += 1) {
        const first = controls[index];
        const second = controls[otherIndex];
        const overlapX = Math.max(0, Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left));
        const overlapY = Math.max(0, Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top));
        if (overlapX > 1 && overlapY > 1) {
          overlapping.push(`controls overlap: ${first.label} / ${second.label}`);
        }
      }
    }
    return overlapping;
  };
  const command = document.querySelector(".hud__command");
  const topbar = document.querySelector(".hud__topbar");
  if (!(command instanceof HTMLElement) || !(topbar instanceof HTMLElement)) {
    return ["missing mobile HUD"];
  }

  const commandRect = command.getBoundingClientRect();
  const topbarRect = topbar.getBoundingClientRect();
  const landscape = window.innerWidth > window.innerHeight;
  const maxDockHeight = landscape ? 124 : 176;
  if (Math.ceil(commandRect.height) > maxDockHeight) {
    failures.push(`mobile play dock too tall: ${Math.ceil(commandRect.height)}px`);
  }

  if (command.scrollHeight > command.clientHeight + 1) {
    failures.push("play command panel scrolls before primary controls fit");
  }

  if (topbarRect.height > 54) {
    failures.push(`top bar too tall: ${Math.ceil(topbarRect.height)}px`);
  }

  if (topbarRect.bottom > commandRect.top - 160) {
    failures.push("HUD leaves too little visible play area");
  }

  failures.push(...coveredPlayAreaFailures([".hud__command", ".hud__topbar", ".hud__turn-prompt", ".hud__results", ".hud__plane-touch"]));

  const targetChecks: Array<[string, string, number, number]> = [
    ["fire", ".hud__fire", 44, 44],
    ["projectile", ".hud__projectile", 44, 44],
    ["utility", ".hud__utility button", 44, 44],
    ["menu", "[data-action='menu']", 44, 44]
  ];

  for (const [name, selector, minWidth, minHeight] of targetChecks) {
    for (const element of Array.from(document.querySelectorAll(selector)).filter(isVisible)) {
      const rect = element.getBoundingClientRect();
      if (rect.width < minWidth || rect.height < minHeight) {
        failures.push(`${name} target too small: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
  }

  for (const element of Array.from(document.querySelectorAll("button")).filter(isVisible)) {
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
      failures.push(`button text clips: ${(element.textContent ?? "").trim()}`);
    }
  }

  failures.push(...overlappingInteractiveFailures());
  return failures;
}

function mobilePlaneReadyLayoutFailures(): string[] {
  const failures: string[] = [];
  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const coveredPlayAreaFailures = (hudSelectors: string[]): string[] => {
    const covered: string[] = [];
    for (const [xRatio, yRatio] of [
      [0.5, 0.34],
      [0.5, 0.46],
      [0.42, 0.5],
      [0.58, 0.5]
    ] as Array<[number, number]>) {
      const element = document.elementFromPoint(Math.round(window.innerWidth * xRatio), Math.round(window.innerHeight * yRatio));
      if (element?.closest(hudSelectors.join(","))) {
        covered.push(`play area sample covered at ${Math.round(xRatio * 100)}%/${Math.round(yRatio * 100)}%`);
      }
    }
    return covered;
  };
  const command = document.querySelector(".hud__command");
  const topbar = document.querySelector(".hud__topbar");
  const loadoutLabel = document.querySelector("[data-role='loadout-label']");
  const fire = document.querySelector(".hud__fire");
  if (
    !(command instanceof HTMLElement) ||
    !(topbar instanceof HTMLElement) ||
    !(loadoutLabel instanceof HTMLElement) ||
    !(fire instanceof HTMLElement)
  ) {
    return ["missing plane ready HUD"];
  }

  const commandStyle = window.getComputedStyle(command);
  if (commandStyle.display === "none" || commandStyle.visibility === "hidden") {
    failures.push("plane ready command panel is hidden");
  }

  const loadoutStyle = window.getComputedStyle(loadoutLabel);
  if (loadoutStyle.visibility === "hidden" || loadoutLabel.textContent?.trim() !== "Vehicle") {
    failures.push("plane loadout label is not visible as Vehicle");
  }

  if (document.querySelectorAll(".hud__projectile").length > 0 && Array.from(document.querySelectorAll(".hud__projectile")).some(isVisible)) {
    failures.push("plane mode shows cannon projectile buttons");
  }

  const commandRect = command.getBoundingClientRect();
  const topbarRect = topbar.getBoundingClientRect();
  const fireRect = fire.getBoundingClientRect();
  if (Math.ceil(commandRect.height) > 176) {
    failures.push(`plane ready dock too tall: ${Math.ceil(commandRect.height)}px`);
  }
  if (command.scrollHeight > command.clientHeight + 1) {
    failures.push("plane ready command panel scrolls");
  }
  if (topbarRect.bottom > commandRect.top - 16) {
    failures.push("plane ready top bar and command panel leave too little flight view");
  }
  if (fireRect.width < 120 || fireRect.height < 44) {
    failures.push(`plane start target too small: ${Math.round(fireRect.width)}x${Math.round(fireRect.height)}`);
  }

  failures.push(...coveredPlayAreaFailures([".hud__command", ".hud__topbar", ".hud__plane-touch"]));
  return failures;
}

function mobilePlaneFlightLayoutFailures(): string[] {
  const failures: string[] = [];
  const isVisible = (element: Element): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const coveredPlayAreaFailures = (hudSelectors: string[]): string[] => {
    const covered: string[] = [];
    for (const [xRatio, yRatio] of [
      [0.5, 0.34],
      [0.5, 0.46],
      [0.42, 0.5],
      [0.58, 0.5]
    ] as Array<[number, number]>) {
      const element = document.elementFromPoint(Math.round(window.innerWidth * xRatio), Math.round(window.innerHeight * yRatio));
      if (element?.closest(hudSelectors.join(","))) {
        covered.push(`play area sample covered at ${Math.round(xRatio * 100)}%/${Math.round(yRatio * 100)}%`);
      }
    }
    return covered;
  };
  const command = document.querySelector(".hud__command");
  const boost = document.querySelector(".hud__plane-boost");
  const fire = document.querySelector(".hud__fire");
  const retry = document.querySelector("[data-action='reset']");
  if (!(command instanceof HTMLElement) || !(boost instanceof HTMLElement) || !(fire instanceof HTMLElement) || !(retry instanceof HTMLElement)) {
    return ["missing plane flight HUD"];
  }

  if (!isVisible(command)) {
    failures.push("plane compact retry panel is not visible while airborne");
  }
  if (isVisible(fire)) {
    failures.push("plane start button remains visible while airborne");
  }
  if (!isVisible(retry)) {
    failures.push("plane retry button is not visible while airborne");
  }
  if (!isVisible(boost)) {
    failures.push("plane boost button is not visible while airborne");
  }

  const commandRect = command.getBoundingClientRect();
  const boostRect = boost.getBoundingClientRect();
  if (commandRect.width > 220 || commandRect.height > 72) {
    failures.push(`plane compact retry panel too large: ${Math.round(commandRect.width)}x${Math.round(commandRect.height)}`);
  }
  if (commandRect.top > window.innerHeight * 0.24 || commandRect.bottom > window.innerHeight * 0.34) {
    failures.push("plane compact retry panel is not anchored near the top flight area");
  }
  if (boostRect.width < 88 || boostRect.height < 88) {
    failures.push(`plane boost target too small: ${Math.round(boostRect.width)}x${Math.round(boostRect.height)}`);
  }
  if (boostRect.right < window.innerWidth * 0.62 || boostRect.bottom < window.innerHeight * 0.78) {
    failures.push("plane boost target is not anchored to the lower-right flight area");
  }

  failures.push(...coveredPlayAreaFailures([".hud__command", ".hud__topbar", ".hud__plane-touch"]));
  return failures;
}

function mobilePostShotLayoutFailures(): string[] {
  const failures: string[] = [];
  const prompt = document.querySelector("[data-action='turn-finish']");
  const command = document.querySelector(".hud__command");
  const topbar = document.querySelector(".hud__topbar");
  if (!(prompt instanceof HTMLElement) || !(command instanceof HTMLElement) || !(topbar instanceof HTMLElement)) {
    return ["missing post-shot mobile UI"];
  }

  const promptStyle = window.getComputedStyle(prompt);
  const commandStyle = window.getComputedStyle(command);
  if (promptStyle.display === "none" || promptStyle.visibility === "hidden") {
    failures.push("turn prompt is not visible");
  }
  if (commandStyle.display !== "none") {
    failures.push("command panel still visible after shot");
  }

  const promptRect = prompt.getBoundingClientRect();
  const topbarRect = topbar.getBoundingClientRect();
  if (promptRect.width < 320 || promptRect.height < 58) {
    failures.push(`turn prompt target too small: ${Math.round(promptRect.width)}x${Math.round(promptRect.height)}`);
  }
  const viewingSpace = promptRect.top - topbarRect.bottom;
  if (viewingSpace < (window.innerWidth > window.innerHeight ? 180 : 450)) {
    failures.push(`post-shot viewing space too small: ${Math.round(viewingSpace)}px`);
  }
  return failures;
}

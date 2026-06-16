import type { ArcadeLevelProgress, ArcadeResult } from "./arcade";
import type { ArcadeMissionFields } from "./levels";
import type { ProjectileDefinition, ProjectileId } from "./projectile";
import { PROJECTILE_ORDER, PROJECTILES } from "./projectile";
import type { ScoreBreakdown } from "./scoring";
import {
  GRAPHICS_QUALITY_LABELS,
  type GameSettings,
  type GraphicsQuality
} from "./settings";

interface UIState {
  projectileId: ProjectileId;
  projectile: ProjectileDefinition;
  powerScale: number;
  sizeScale: number;
  shotAvailable: boolean;
  bodyCount: number;
  levelName: string;
  levelDescription: string;
  objective: string;
  protectedBrief: string;
  mission: ArcadeMissionFields;
  levelIndex: number;
  levelCount: number;
  levelProgress: ArcadeLevelProgress;
  totalStars: number;
  arcadeResult: ArcadeResult | null;
  settings: GameSettings;
  status: string;
  fps: number;
  score: ScoreBreakdown | null;
}

interface UICallbacks {
  fire(): void;
  reset(): void;
  clearDebris(): void;
  selectProjectile(id: ProjectileId): void;
  nextLevel(): void;
  adjustPower(delta: number): void;
  adjustSize(delta: number): void;
  updateSettings(patch: Partial<GameSettings>): void;
  resetSettings(): void;
}

type UIScreen = "home" | "settings" | "play";
type UIMode = "Arcade" | "Free Play";

export class GameUI {
  private readonly root: HTMLDivElement;
  private readonly modeValue: HTMLSpanElement;
  private readonly projectileValue: HTMLSpanElement;
  private readonly chamberValue: HTMLSpanElement;
  private readonly objectiveValue: HTMLSpanElement;
  private readonly protectedValue: HTMLElement;
  private readonly powerValue: HTMLSpanElement;
  private readonly sizeValue: HTMLSpanElement;
  private readonly shotsValue: HTMLSpanElement;
  private readonly bodyValue: HTMLSpanElement;
  private readonly fpsValue: HTMLElement;
  private readonly statusValue: HTMLDivElement;
  private readonly fireButton: HTMLButtonElement;
  private readonly scorePanel: HTMLDivElement;
  private readonly homeLevelRail: HTMLDivElement;
  private readonly targetScoreValue: HTMLSpanElement;
  private readonly targetDamageValue: HTMLSpanElement;
  private readonly protectedLimitValue: HTMLSpanElement;
  private readonly bonusGoalValue: HTMLSpanElement;
  private readonly settingsSummaryValue: HTMLSpanElement;
  private readonly antialiasInput: HTMLInputElement;
  private readonly masterVolumeInput: HTMLInputElement;
  private readonly masterVolumeValue: HTMLElement;
  private readonly cameraShakeInput: HTMLInputElement;
  private readonly cameraShakeValue: HTMLElement;
  private readonly motionEffectsInput: HTMLInputElement;
  private readonly showFpsInput: HTMLInputElement;
  private readonly projectileButtons = new Map<ProjectileId, HTMLButtonElement>();
  private readonly qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();

  private screen: UIScreen = "home";
  private mode: UIMode = "Arcade";
  private scoreWasVisible = false;
  private renderedScore: ScoreBreakdown | null = null;
  private activeProjectileId: ProjectileId | null = null;
  private currentState: UIState | null = null;

  constructor(private readonly callbacks: UICallbacks) {
    installStyles();

    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.dataset.screen = this.screen;
    this.root.innerHTML = `
      <div class="hud__topbar" aria-live="polite">
        <div class="hud__brand">
          <span class="hud__brand-mark">MBL</span>
          <div>
            <strong>Material Blast Lab</strong>
            <span><span data-role="mode">Arcade</span> / Synthetic containment range</span>
          </div>
        </div>
        <div class="hud__telemetry">
          <span data-role="fps"></span>
          <span><strong data-role="bodies"></strong> bodies</span>
          <button type="button" data-action="menu">Menu</button>
        </div>
      </div>

      <section class="hud__command" aria-label="Mission command">
        <div class="hud__mission">
          <div class="hud__mission-kicker">
            <span>Live Mission</span>
            <strong data-role="shots"></strong>
          </div>
          <strong data-role="chamber"></strong>
          <span data-role="objective"></span>
          <em data-role="protected"></em>
        </div>

        <div class="hud__goal-grid">
          <div><span>Score route</span><strong data-role="target-score"></strong></div>
          <div><span>Core damage</span><strong data-role="target-damage"></strong></div>
          <div><span>Protected cap</span><strong data-role="protected-limit"></strong></div>
          <div><span>Bonus</span><strong data-role="bonus-goal"></strong></div>
        </div>

        <div class="hud__loadout-head">
          <span>Payload</span>
          <strong data-role="projectile"></strong>
        </div>
        <div class="hud__projectiles" data-role="projectiles"></div>

        <div class="hud__steppers">
          <div class="hud__stepper">
            <span>Power</span>
            <button type="button" data-action="power-down" aria-label="Lower power">-</button>
            <strong data-role="power"></strong>
            <button type="button" data-action="power-up" aria-label="Raise power">+</button>
          </div>
          <div class="hud__stepper">
            <span>Size</span>
            <button type="button" data-action="size-down" aria-label="Lower projectile size">-</button>
            <strong data-role="size"></strong>
            <button type="button" data-action="size-up" aria-label="Raise projectile size">+</button>
          </div>
        </div>

        <button class="hud__fire" type="button">FIRE</button>

        <div class="hud__utility">
          <button type="button" data-action="reset">Retry</button>
          <button type="button" data-action="level">Next</button>
          <button type="button" data-action="clear">Clear Debris</button>
        </div>
        <div class="hud__status" data-role="status"></div>
      </section>

      <section class="hud__results" data-role="score" aria-live="polite"></section>

      <section class="hud__home" aria-label="Material Blast Lab menu">
        <div class="hud__hero">
          <div class="hud__hero-copy">
            <span class="hud__eyebrow">DESTRUCTIBLE ARCADE LAB</span>
            <h1>Material Blast Lab</h1>
            <p>Pick a mission, tune one fictional sci-fi payload, fire once, then chase cleaner stars through readable destruction chains.</p>
            <div class="hud__hero-actions">
              <button type="button" data-action="start-arcade">Arcade</button>
              <button type="button" data-action="start-free">Free Play</button>
              <button type="button" data-action="settings">Settings</button>
            </div>
          </div>
          <div class="hud__level-path" data-role="home-levels"></div>
        </div>
      </section>

      <section class="hud__settings" aria-label="Settings">
        <div class="hud__settings-panel">
          <div class="hud__settings-head">
            <button type="button" data-action="settings-back" aria-label="Back to menu">Back</button>
            <button type="button" data-action="settings-defaults">Defaults</button>
          </div>
          <span class="hud__eyebrow">RANGE SETTINGS</span>
          <h2>Feel And Performance</h2>
          <span class="hud__settings-summary" data-role="settings-summary"></span>

          <div class="hud__setting-row hud__setting-row--stacked">
            <span>Graphics</span>
            <div class="hud__segmented" role="group" aria-label="Graphics quality">
              <button type="button" data-quality="performance">Performance</button>
              <button type="button" data-quality="balanced">Balanced</button>
              <button type="button" data-quality="cinematic">Cinematic</button>
            </div>
          </div>

          <label class="hud__setting-row hud__setting-row--toggle">
            <span>Anti-aliasing</span>
            <input type="checkbox" data-setting="antialias" />
          </label>

          <label class="hud__setting-row">
            <span>Master volume</span>
            <input type="range" data-setting="master-volume" min="0" max="100" step="1" />
            <strong data-role="master-volume"></strong>
          </label>

          <label class="hud__setting-row">
            <span>Camera shake</span>
            <input type="range" data-setting="camera-shake" min="0" max="100" step="1" />
            <strong data-role="camera-shake"></strong>
          </label>

          <label class="hud__setting-row hud__setting-row--toggle">
            <span>Flash + slow-mo</span>
            <input type="checkbox" data-setting="motion-effects" />
          </label>

          <label class="hud__setting-row hud__setting-row--toggle">
            <span>FPS counter</span>
            <input type="checkbox" data-setting="show-fps" />
          </label>
        </div>
      </section>
    `;
    document.body.appendChild(this.root);

    this.modeValue = this.requireElement("[data-role='mode']");
    this.projectileValue = this.requireElement("[data-role='projectile']");
    this.chamberValue = this.requireElement("[data-role='chamber']");
    this.objectiveValue = this.requireElement("[data-role='objective']");
    this.protectedValue = this.requireElement("[data-role='protected']");
    this.powerValue = this.requireElement("[data-role='power']");
    this.sizeValue = this.requireElement("[data-role='size']");
    this.shotsValue = this.requireElement("[data-role='shots']");
    this.bodyValue = this.requireElement("[data-role='bodies']");
    this.fpsValue = this.requireElement("[data-role='fps']");
    this.statusValue = this.requireElement("[data-role='status']");
    this.fireButton = this.requireElement(".hud__fire");
    this.scorePanel = this.requireElement("[data-role='score']");
    this.homeLevelRail = this.requireElement("[data-role='home-levels']");
    this.targetScoreValue = this.requireElement("[data-role='target-score']");
    this.targetDamageValue = this.requireElement("[data-role='target-damage']");
    this.protectedLimitValue = this.requireElement("[data-role='protected-limit']");
    this.bonusGoalValue = this.requireElement("[data-role='bonus-goal']");
    this.settingsSummaryValue = this.requireElement("[data-role='settings-summary']");
    this.antialiasInput = this.requireElement("[data-setting='antialias']");
    this.masterVolumeInput = this.requireElement("[data-setting='master-volume']");
    this.masterVolumeValue = this.requireElement("[data-role='master-volume']");
    this.cameraShakeInput = this.requireElement("[data-setting='camera-shake']");
    this.cameraShakeValue = this.requireElement("[data-role='camera-shake']");
    this.motionEffectsInput = this.requireElement("[data-setting='motion-effects']");
    this.showFpsInput = this.requireElement("[data-setting='show-fps']");

    const projectileRoot = this.requireElement<HTMLDivElement>("[data-role='projectiles']");
    for (const id of PROJECTILE_ORDER) {
      const definition = PROJECTILES[id];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hud__projectile";
      button.setAttribute("aria-label", definition.shortName);
      button.title = `${definition.key}: ${definition.name} - ${definition.description}`;
      button.style.setProperty("--projectile", `#${definition.color.getHexString()}`);
      button.innerHTML = `<span>${definition.shortName}</span><small>${definition.key}</small>`;
      button.addEventListener("click", () => this.callbacks.selectProjectile(id));
      projectileRoot.appendChild(button);
      this.projectileButtons.set(id, button);
    }

    this.fireButton.addEventListener("click", () => this.callbacks.fire());
    this.requireElement<HTMLButtonElement>("[data-action='level']").addEventListener("click", () => this.callbacks.nextLevel());
    this.requireElement<HTMLButtonElement>("[data-action='clear']").addEventListener("click", () => this.callbacks.clearDebris());
    this.requireElement<HTMLButtonElement>("[data-action='reset']").addEventListener("click", () => this.callbacks.reset());
    this.requireElement<HTMLButtonElement>("[data-action='power-down']").addEventListener("click", () => this.callbacks.adjustPower(-0.08));
    this.requireElement<HTMLButtonElement>("[data-action='power-up']").addEventListener("click", () => this.callbacks.adjustPower(0.08));
    this.requireElement<HTMLButtonElement>("[data-action='size-down']").addEventListener("click", () => this.callbacks.adjustSize(-0.08));
    this.requireElement<HTMLButtonElement>("[data-action='size-up']").addEventListener("click", () => this.callbacks.adjustSize(0.08));
    this.requireElement<HTMLButtonElement>("[data-action='menu']").addEventListener("click", () => this.showScreen("home"));
    this.requireElement<HTMLButtonElement>("[data-action='start-arcade']").addEventListener("click", () => this.startMode("Arcade"));
    this.requireElement<HTMLButtonElement>("[data-action='start-free']").addEventListener("click", () => this.startMode("Free Play"));
    this.requireElement<HTMLButtonElement>("[data-action='settings']").addEventListener("click", () => this.showScreen("settings"));
    this.requireElement<HTMLButtonElement>("[data-action='settings-back']").addEventListener("click", () => this.showScreen("home"));
    this.requireElement<HTMLButtonElement>("[data-action='settings-defaults']").addEventListener("click", () => this.callbacks.resetSettings());

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-quality]")) {
      const quality = button.dataset.quality;
      if (isGraphicsQuality(quality)) {
        this.qualityButtons.set(quality, button);
        button.addEventListener("click", () => this.callbacks.updateSettings({ graphicsQuality: quality }));
      }
    }
    this.antialiasInput.addEventListener("change", () =>
      this.callbacks.updateSettings({ antialias: this.antialiasInput.checked })
    );
    this.masterVolumeInput.addEventListener("input", () =>
      this.callbacks.updateSettings({ masterVolume: Number(this.masterVolumeInput.value) / 100 })
    );
    this.cameraShakeInput.addEventListener("input", () =>
      this.callbacks.updateSettings({ cameraShake: Number(this.cameraShakeInput.value) / 100 })
    );
    this.motionEffectsInput.addEventListener("change", () =>
      this.callbacks.updateSettings({ motionEffects: this.motionEffectsInput.checked })
    );
    this.showFpsInput.addEventListener("change", () => this.callbacks.updateSettings({ showFps: this.showFpsInput.checked }));
  }

  update(state: UIState): void {
    this.currentState = state;
    setText(this.modeValue, this.mode);
    setText(this.projectileValue, state.projectile.shortName);
    setTitle(this.projectileValue, state.projectile.name);
    setText(this.chamberValue, state.levelName);
    setTitle(this.chamberValue, state.levelDescription);
    setText(this.objectiveValue, state.objective);
    setText(this.protectedValue, state.protectedBrief);
    setText(this.powerValue, `${Math.round(state.powerScale * 100)}%`);
    setText(this.sizeValue, `${Math.round(state.sizeScale * 100)}%`);
    setText(this.shotsValue, state.shotAvailable ? "READY" : "SPENT");
    setText(this.bodyValue, String(state.bodyCount));
    this.fpsValue.hidden = !state.settings.showFps;
    if (state.settings.showFps) {
      setText(this.fpsValue, `${state.fps} FPS`);
    }
    setText(this.statusValue, state.status);
    setText(this.targetScoreValue, `${state.mission.scoreThresholds.twoStar}+`);
    setText(this.targetDamageValue, String(state.mission.targetDamageThreshold));
    setText(this.protectedLimitValue, `< ${state.mission.cleanBlastLimit}`);
    setText(this.bonusGoalValue, bonusSummary(state.mission));

    const blocked = this.isGameplayBlocked();
    if (this.fireButton.disabled !== (!state.shotAvailable || blocked)) {
      this.fireButton.disabled = !state.shotAvailable || blocked;
    }

    if (this.activeProjectileId !== state.projectileId) {
      for (const [id, button] of this.projectileButtons) {
        const active = id === state.projectileId;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      this.activeProjectileId = state.projectileId;
    }

    this.renderHomeLevels(state);
    this.renderSettings(state.settings);
    this.root.classList.toggle("has-results", Boolean(state.score));

    if (state.score) {
      const shouldRevealScore = !this.scoreWasVisible;
      this.scorePanel.classList.add("is-visible");
      if (this.renderedScore !== state.score) {
        this.scorePanel.innerHTML = renderScore(state);
        this.bindResultActions();
        this.renderedScore = state.score;
      }
      this.scoreWasVisible = true;
      if (shouldRevealScore) {
        this.scorePanel.scrollTo({ top: 0, behavior: "instant" });
      }
    } else if (this.scoreWasVisible || this.renderedScore) {
      this.scoreWasVisible = false;
      this.renderedScore = null;
      this.scorePanel.classList.remove("is-visible");
      this.scorePanel.innerHTML = "";
    }
  }

  isGameplayBlocked(): boolean {
    return this.screen !== "play";
  }

  dispose(): void {
    this.root.remove();
  }

  private startMode(mode: UIMode): void {
    this.mode = mode;
    this.showScreen("play");
  }

  private showScreen(screen: UIScreen): void {
    this.screen = screen;
    this.root.dataset.screen = screen;
    if (this.currentState) {
      this.update(this.currentState);
    }
  }

  private renderHomeLevels(state: UIState): void {
    const progress = state.levelProgress;
    const html = `
      <button type="button" class="hud__level-card is-current" data-action="start-arcade">
        <span>${String(state.levelIndex + 1).padStart(2, "0")} / ACTIVE / ${state.totalStars} TOTAL STARS</span>
        <strong>${escapeHtml(state.levelName)}</strong>
        <em>${starText(progress.stars)} / best ${progress.bestScore} / attempts ${progress.attempts}</em>
      </button>
      <button type="button" class="hud__level-card is-locked" disabled>
        <span>${String(Math.min(state.levelIndex + 2, state.levelCount)).padStart(2, "0")} / CAMPAIGN</span>
        <strong>${state.levelIndex + 1 < state.levelCount ? "Next unlocked mission" : "Campaign loop"}</strong>
        <em>${state.levelIndex + 1 < state.levelCount ? "Complete the current run" : "Replay for cleaner stars"}</em>
      </button>
      <button type="button" class="hud__level-card is-locked" disabled>
        <span>FREE PLAY</span>
        <strong>Sandbox controls</strong>
        <em>All current tuning remains available</em>
      </button>
    `;
    if (this.homeLevelRail.innerHTML !== html) {
      this.homeLevelRail.innerHTML = html;
      this.homeLevelRail.querySelector<HTMLButtonElement>("[data-action='start-arcade']")?.addEventListener("click", () => this.startMode("Arcade"));
    }
  }

  private renderSettings(settings: GameSettings): void {
    const volume = percent(settings.masterVolume);
    const shake = percent(settings.cameraShake);
    this.root.dataset.quality = settings.graphicsQuality;
    setText(
      this.settingsSummaryValue,
      `${GRAPHICS_QUALITY_LABELS[settings.graphicsQuality]} / AA ${settings.antialias ? "on" : "off"} / ${volume}% volume / ${shake}% shake`
    );

    for (const [quality, button] of this.qualityButtons) {
      const active = quality === settings.graphicsQuality;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    this.antialiasInput.checked = settings.antialias;
    setRangeValue(this.masterVolumeInput, volume);
    setText(this.masterVolumeValue, `${volume}%`);
    setRangeValue(this.cameraShakeInput, shake);
    setText(this.cameraShakeValue, `${shake}%`);
    this.motionEffectsInput.checked = settings.motionEffects;
    this.showFpsInput.checked = settings.showFps;
  }

  private bindResultActions(): void {
    this.scorePanel.querySelector<HTMLButtonElement>("[data-action='result-retry']")?.addEventListener("click", () => this.callbacks.reset());
    this.scorePanel.querySelector<HTMLButtonElement>("[data-action='result-next']")?.addEventListener("click", () => this.callbacks.nextLevel());
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing UI element ${selector}`);
    }
    return element;
  }
}

function renderScore(state: UIState): string {
  const score = state.score;
  if (!score) {
    return "";
  }
  const result = state.arcadeResult;
  const stars = result?.stars ?? 0;
  const resultLabel = result?.completed ? (stars >= 3 ? "Perfect Run" : "Mission Complete") : "Mission Failed";
  const bonusValue = bonusMetricValue(score, state.mission.bonusThreshold.metric);
  const goals = [
    {
      label: "Target core",
      value: `${score.targetDamage} / ${state.mission.targetDamageThreshold}`,
      passed: score.targetDamage >= state.mission.targetDamageThreshold
    },
    {
      label: "Containment",
      value: `${score.protectedPenalty} / ${state.mission.protectedDamageLimit}`,
      passed: score.protectedPenalty <= state.mission.protectedDamageLimit
    },
    {
      label: "Score route",
      value: `${score.totalScore} / ${state.mission.scoreThresholds.twoStar}`,
      passed: score.totalScore >= state.mission.scoreThresholds.twoStar
    },
    {
      label: state.mission.bonusObjective,
      value: `${bonusValue} / ${state.mission.bonusThreshold.minimum}`,
      passed: result?.bonusCompleted ?? false
    }
  ];

  return `
    <div class="hud__result-head">
      <span>${resultLabel}</span>
      <strong>${escapeHtml(score.containmentRating)}</strong>
    </div>
    <div class="hud__stars" aria-label="${stars} stars">${renderStars(stars)}</div>
    <div class="hud__total">
      <span>Total Score</span>
      <strong>${score.totalScore}</strong>
      <em>Best ${state.levelProgress.bestScore}</em>
    </div>
    <div class="hud__objective-list">
      ${goals
        .map(
          (goal) => `
            <div class="${goal.passed ? "is-passed" : "is-missed"}">
              <span>${escapeHtml(goal.label)}</span>
              <strong>${escapeHtml(goal.value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
    <div class="hud__score-breakdown">
      <div><span>Payload</span><strong>${escapeHtml(score.shotName)}</strong></div>
      <div><span>City Chaos</span><strong>${score.cityChaos}</strong></div>
      <div><span>Contamination Purge</span><strong>${score.contaminationPurge}</strong></div>
      <div><span>Chain Hits</span><strong>${score.chainReactionCount}${score.maxChainCombo > 1 ? ` / x${score.maxChainCombo}` : ""}</strong></div>
      <div><span>Motion Bonus</span><strong>${score.remainingDebrisMotion}</strong></div>
      <div><span>Protected Penalty</span><strong class="is-penalty">-${score.protectedPenalty}</strong></div>
    </div>
    <div class="hud__result-actions">
      <button type="button" data-action="result-retry">Retry</button>
      <button type="button" data-action="result-next">Next Level</button>
    </div>
  `;
}

function bonusSummary(mission: ArcadeMissionFields): string {
  return `${mission.bonusThreshold.minimum}+ ${metricLabel(mission.bonusThreshold.metric)}`;
}

function bonusMetricValue(score: ScoreBreakdown, metric: ArcadeMissionFields["bonusThreshold"]["metric"]): number {
  return score[metric];
}

function metricLabel(metric: ArcadeMissionFields["bonusThreshold"]["metric"]): string {
  switch (metric) {
    case "targetDamage":
      return "target";
    case "cityChaos":
      return "chaos";
    case "contaminationPurge":
      return "purge";
    case "chainReactionBonus":
      return "chain";
    case "remainingDebrisMotion":
      return "motion";
    case "chainReactionCount":
      return "hits";
    case "maxChainCombo":
      return "combo";
  }
}

function renderStars(stars: number): string {
  return [0, 1, 2]
    .map((index) => `<span class="${index < stars ? "is-earned" : ""}">*</span>`)
    .join("");
}

function starText(stars: number): string {
  return `${stars}/3 stars`;
}

function percent(value: number): number {
  return Math.round(THREEClamp01(value) * 100);
}

function THREEClamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function setRangeValue(input: HTMLInputElement, value: number): void {
  const next = String(value);
  if (input.value !== next) {
    input.value = next;
  }
}

function isGraphicsQuality(value: string | undefined): value is GraphicsQuality {
  return value === "performance" || value === "balanced" || value === "cinematic";
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function setTitle(element: HTMLElement, value: string): void {
  if (element.title !== value) {
    element.title = value;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let stylesInstalled = false;

function installStyles(): void {
  if (stylesInstalled) {
    return;
  }
  stylesInstalled = true;
  const style = document.createElement("style");
  style.textContent = `
    :root {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #f4f8fb;
      background: #07090d;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body,
    #app {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
    }

    button {
      font: inherit;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: #07090d;
      cursor: crosshair;
      touch-action: none;
    }

    .hud {
      position: fixed;
      inset: 0;
      z-index: 5;
      overflow: hidden;
      pointer-events: none;
      color: #f4f8fb;
    }

    .hud [hidden] {
      display: none !important;
    }

    .hud::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(5, 8, 12, 0.72), rgba(5, 8, 12, 0.2) 42%, rgba(5, 8, 12, 0.56)),
        linear-gradient(0deg, rgba(5, 8, 12, 0.7), transparent 42%, rgba(5, 8, 12, 0.28));
      opacity: 0.42;
      transition: opacity 180ms ease;
    }

    .hud[data-screen="play"]::before {
      opacity: 0.28;
    }

    .hud__topbar,
    .hud__command,
    .hud__results,
    .hud__home,
    .hud__settings {
      pointer-events: auto;
    }

    .hud__topbar {
      position: absolute;
      top: 16px;
      left: 16px;
      right: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 56px;
      padding: 10px 12px;
      border: 1px solid rgba(183, 232, 255, 0.17);
      border-radius: 8px;
      background: rgba(6, 10, 15, 0.68);
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.34);
      backdrop-filter: blur(14px);
    }

    .hud__brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .hud__brand-mark {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 36px;
      height: 36px;
      border: 1px solid rgba(255, 200, 93, 0.42);
      border-radius: 7px;
      color: #ffd36d;
      background: rgba(255, 166, 41, 0.13);
      font-size: 12px;
      font-weight: 900;
    }

    .hud__brand strong,
    .hud__hero h1,
    .hud__settings h2 {
      display: block;
      margin: 0;
      font-weight: 900;
      line-height: 1;
    }

    .hud__brand strong {
      font-size: 16px;
    }

    .hud__brand span,
    .hud__telemetry,
    .hud__mission-kicker,
    .hud__eyebrow,
    .hud__loadout-head,
    .hud__goal-grid span,
    .hud__total span,
    .hud__score-breakdown span,
    .hud__objective-list span,
    .hud__setting-row span {
      color: #9db6c4;
      font-size: 11px;
      line-height: 1.2;
    }

    .hud__telemetry {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex: 0 0 auto;
      white-space: nowrap;
    }

    .hud__telemetry span,
    .hud__telemetry button {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid rgba(157, 248, 255, 0.18);
      border-radius: 7px;
      color: #bdf8ff;
      background: rgba(157, 248, 255, 0.07);
      font-size: 11px;
      font-weight: 800;
    }

    .hud__telemetry strong {
      margin-right: 4px;
    }

    .hud__telemetry button {
      cursor: pointer;
    }

    .hud__command {
      position: absolute;
      left: 16px;
      bottom: 16px;
      display: grid;
      gap: 10px;
      width: min(446px, calc(100vw - 32px));
      max-height: calc(100svh - 104px);
      overflow: auto;
      padding: 12px;
      border: 1px solid rgba(183, 232, 255, 0.18);
      border-radius: 8px;
      background: rgba(7, 11, 17, 0.82);
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(16px);
      transition: opacity 160ms ease, transform 160ms ease;
      scrollbar-width: thin;
    }

    .hud[data-screen="home"] .hud__command,
    .hud[data-screen="settings"] .hud__command,
    .hud.has-results .hud__command {
      opacity: 0;
      transform: translateY(10px);
      display: none;
      pointer-events: none;
    }

    .hud__mission {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .hud__mission-kicker,
    .hud__loadout-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      text-transform: uppercase;
    }

    .hud__mission-kicker strong {
      color: #79f0ff;
      font-size: 11px;
      font-weight: 900;
    }

    .hud__mission > strong {
      min-width: 0;
      overflow: hidden;
      color: #ffffff;
      font-size: 18px;
      line-height: 1.05;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__mission > span,
    .hud__mission > em {
      color: #c3d5df;
      font-size: 12px;
      font-style: normal;
      line-height: 1.32;
    }

    .hud__mission > em {
      color: #8ddfff;
    }

    .hud__goal-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
    }

    .hud__goal-grid div {
      min-width: 0;
      padding: 8px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.045);
    }

    .hud__goal-grid strong {
      display: block;
      margin-top: 3px;
      overflow: hidden;
      color: #f7fbff;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__loadout-head strong {
      color: #ffffff;
      font-size: 13px;
    }

    .hud__projectiles {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 7px;
      min-width: 0;
    }

    .hud__projectile {
      display: grid;
      align-content: center;
      gap: 2px;
      min-width: 0;
      width: 100%;
      min-height: 54px;
      padding: 7px 5px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 7px;
      color: #f8fdff;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--projectile), #ffffff 4%), color-mix(in srgb, var(--projectile), #000000 34%));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
      cursor: pointer;
      overflow: hidden;
      text-align: center;
    }

    .hud__projectile span,
    .hud__projectile small {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__projectile span {
      font-size: 12px;
      font-weight: 900;
    }

    .hud__projectile small {
      color: rgba(255, 255, 255, 0.72);
      font-size: 9px;
      font-weight: 700;
    }

    .hud__projectile.is-active {
      border-color: #ffffff;
      outline: 2px solid rgba(121, 240, 255, 0.84);
      outline-offset: 2px;
    }

    .hud__steppers {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      min-width: 0;
    }

    .hud__stepper {
      display: grid;
      grid-template-columns: minmax(42px, 1fr) 36px minmax(44px, auto) 36px;
      align-items: center;
      gap: 5px;
      min-width: 0;
      padding: 6px;
      border: 1px solid rgba(183, 232, 255, 0.12);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.055);
      color: #a9c4d1;
      font-size: 12px;
    }

    .hud__stepper span,
    .hud__stepper strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__stepper strong {
      color: #ffffff;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .hud__fire,
    .hud__utility button,
    .hud__stepper button,
    .hud__hero-actions button,
    .hud__result-actions button,
    .hud__level-card,
    .hud__settings-panel button {
      min-height: 40px;
      border: 1px solid rgba(185, 245, 255, 0.2);
      border-radius: 7px;
      color: #f8fdff;
      background: rgba(255, 255, 255, 0.08);
      font-weight: 900;
      cursor: pointer;
    }

    .hud__fire,
    .hud__hero-actions button:first-child,
    .hud__result-actions button:last-child {
      color: #051016;
      background: linear-gradient(180deg, #92f2ff, #55d4f1);
      border-color: rgba(183, 255, 255, 0.78);
      box-shadow: 0 10px 24px rgba(61, 215, 240, 0.24);
    }

    .hud__fire {
      min-height: 54px;
      font-size: 16px;
    }

    .hud__fire:disabled {
      color: rgba(255, 255, 255, 0.38);
      background: rgba(255, 255, 255, 0.07);
      border-color: rgba(255, 255, 255, 0.08);
      box-shadow: none;
      cursor: default;
    }

    .hud__utility,
    .hud__result-actions,
    .hud__hero-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
      min-width: 0;
    }

    .hud__utility button,
    .hud__result-actions button,
    .hud__hero-actions button {
      min-width: 0;
      overflow: hidden;
      padding: 0 8px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__status {
      min-height: 32px;
      padding: 8px;
      border-left: 3px solid #ffbf47;
      color: #d5edf5;
      background: rgba(255, 191, 71, 0.08);
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.25;
    }

    .hud__results {
      position: absolute;
      right: 16px;
      bottom: 16px;
      display: none;
      width: min(420px, calc(100vw - 32px));
      max-height: calc(100svh - 104px);
      overflow: auto;
      padding: 14px;
      border: 1px solid rgba(255, 211, 109, 0.26);
      border-radius: 8px;
      background: rgba(8, 10, 13, 0.9);
      box-shadow: 0 18px 58px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(18px);
      scrollbar-width: thin;
    }

    .hud__results.is-visible {
      display: grid;
      gap: 12px;
    }

    .hud__result-head {
      display: grid;
      gap: 5px;
    }

    .hud__result-head span,
    .hud__total span {
      color: #ffcf69;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__result-head strong {
      color: #ffffff;
      font-size: 24px;
      line-height: 1;
    }

    .hud__stars {
      display: flex;
      gap: 8px;
      min-height: 42px;
    }

    .hud__stars span {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 7px;
      color: rgba(255, 255, 255, 0.24);
      background: rgba(255, 255, 255, 0.06);
      font-size: 24px;
      font-weight: 900;
    }

    .hud__stars span.is-earned {
      color: #111008;
      border-color: rgba(255, 222, 122, 0.9);
      background: linear-gradient(180deg, #ffe98d, #ffb93d);
    }

    .hud__total {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 2px 10px;
      align-items: end;
      padding: 10px;
      border-radius: 7px;
      background: rgba(121, 240, 255, 0.08);
    }

    .hud__total strong {
      grid-row: span 2;
      color: #96f4ff;
      font-size: 34px;
      line-height: 0.95;
      font-variant-numeric: tabular-nums;
    }

    .hud__total em {
      color: #b5c6cf;
      font-size: 11px;
      font-style: normal;
    }

    .hud__objective-list,
    .hud__score-breakdown {
      display: grid;
      gap: 6px;
    }

    .hud__objective-list div,
    .hud__score-breakdown div,
    .hud__setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 32px;
      padding: 7px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.055);
    }

    .hud__setting-row input {
      flex: 1 1 auto;
      min-width: 90px;
      accent-color: #79f0ff;
    }

    .hud__objective-list div {
      border-left: 3px solid #ff7c9f;
    }

    .hud__objective-list div.is-passed {
      border-left-color: #72f0a5;
    }

    .hud__objective-list strong,
    .hud__score-breakdown strong,
    .hud__setting-row strong {
      min-width: 0;
      overflow: hidden;
      color: #ffffff;
      font-size: 12px;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__score-breakdown .is-penalty {
      color: #ff8aa3;
    }

    .hud__home,
    .hud__settings {
      position: absolute;
      inset: 0;
      display: none;
      align-items: end;
      padding: 94px 24px 28px;
      background: linear-gradient(90deg, rgba(4, 6, 9, 0.88), rgba(4, 6, 9, 0.24) 58%, rgba(4, 6, 9, 0.62));
    }

    .hud[data-screen="home"] .hud__home,
    .hud[data-screen="settings"] .hud__settings {
      display: flex;
    }

    .hud[data-screen="home"] .hud__topbar,
    .hud[data-screen="settings"] .hud__topbar {
      background: rgba(6, 10, 15, 0.44);
    }

    .hud__hero {
      display: grid;
      grid-template-columns: minmax(320px, 560px) minmax(260px, 420px);
      align-items: end;
      gap: 34px;
      width: min(1040px, 100%);
    }

    .hud__hero-copy {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .hud__eyebrow {
      color: #ffcf69;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__hero h1 {
      max-width: 780px;
      color: #ffffff;
      font-size: 56px;
    }

    .hud__hero p {
      max-width: 560px;
      margin: 0;
      color: #d7e7ef;
      font-size: 16px;
      line-height: 1.45;
    }

    .hud__level-path {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .hud__level-card {
      display: grid;
      gap: 4px;
      min-width: 0;
      padding: 12px;
      text-align: left;
      background: rgba(7, 11, 17, 0.76);
      border-color: rgba(183, 232, 255, 0.16);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
    }

    .hud__level-card span,
    .hud__level-card em {
      overflow: hidden;
      color: #9db6c4;
      font-size: 10px;
      font-style: normal;
      font-weight: 900;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .hud__level-card strong {
      overflow: hidden;
      color: #ffffff;
      font-size: 15px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__level-card.is-current {
      border-color: rgba(121, 240, 255, 0.56);
      background: rgba(16, 50, 58, 0.72);
    }

    .hud__level-card.is-locked {
      color: #aebbc3;
      opacity: 0.62;
      cursor: default;
    }

    .hud__settings {
      justify-content: center;
      align-items: center;
      padding: 24px;
    }

    .hud__settings-panel {
      display: grid;
      gap: 10px;
      width: min(520px, calc(100vw - 32px));
      padding: 16px;
      border: 1px solid rgba(183, 232, 255, 0.18);
      border-radius: 8px;
      background: rgba(7, 11, 17, 0.88);
      box-shadow: 0 18px 58px rgba(0, 0, 0, 0.46);
      backdrop-filter: blur(18px);
    }

    .hud__settings-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .hud__settings-panel button {
      min-height: 34px;
      padding: 0 12px;
    }

    .hud__settings-summary {
      color: #b8d3de;
      font-size: 12px;
      line-height: 1.35;
    }

    .hud__setting-row--stacked {
      display: grid;
      align-items: stretch;
      justify-content: stretch;
      gap: 8px;
    }

    .hud__segmented {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      min-width: 0;
    }

    .hud__segmented button {
      width: 100%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__segmented button.is-active {
      color: #061016;
      border-color: rgba(183, 255, 255, 0.82);
      background: linear-gradient(180deg, #92f2ff, #55d4f1);
      box-shadow: 0 8px 20px rgba(61, 215, 240, 0.18);
    }

    .hud__setting-row--toggle input {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      min-width: 22px;
    }

    .screen-flash {
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at center, rgba(255, 255, 255, 0.72), rgba(110, 230, 255, 0.18) 32%, transparent 64%);
      mix-blend-mode: screen;
      z-index: 2;
    }

    @media (max-width: 840px) {
      .hud__topbar {
        left: 10px;
        right: 10px;
        top: 10px;
      }

      .hud__telemetry span:nth-child(2) {
        display: none;
      }

      .hud__command,
      .hud__results {
        left: 10px;
        right: 10px;
        bottom: 10px;
        width: auto;
        max-height: min(50svh, 430px);
      }

      .hud__results {
        max-height: min(58svh, 500px);
      }

      .hud__home {
        align-items: end;
        padding: 82px 14px 16px;
      }

      .hud__hero {
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
      }

      .hud__hero h1 {
        font-size: 34px;
      }

      .hud__hero p {
        font-size: 13px;
      }

      .hud__hero-actions {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .hud__hero-actions button:last-child {
        grid-column: 1 / -1;
      }

      .hud__level-path {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 520px) {
      .hud::before {
        opacity: 0.48;
      }

      .hud__topbar {
        min-height: 48px;
        padding: 7px;
      }

      .hud__brand {
        gap: 7px;
      }

      .hud__brand-mark {
        width: 30px;
        height: 30px;
        font-size: 10px;
      }

      .hud__brand strong {
        font-size: 14px;
      }

      .hud__brand span {
        display: none;
      }

      .hud__telemetry {
        gap: 5px;
      }

      .hud__telemetry span,
      .hud__telemetry button {
        min-height: 28px;
        padding: 0 7px;
        font-size: 10px;
      }

      .hud__command {
        gap: 7px;
        max-height: min(46svh, 380px);
        padding: 8px;
      }

      .hud__mission {
        gap: 3px;
      }

      .hud__mission > strong {
        font-size: 15px;
      }

      .hud__mission > span,
      .hud__mission > em,
      .hud__status {
        font-size: 10px;
      }

      .hud__mission > em {
        display: none;
      }

      .hud__goal-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .hud__goal-grid div {
        padding: 6px;
      }

      .hud__goal-grid span {
        font-size: 9px;
      }

      .hud__projectiles {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
      }

      .hud__projectile {
        min-height: 38px;
        padding: 4px;
      }

      .hud__projectile span {
        font-size: 10px;
      }

      .hud__projectile small {
        display: none;
      }

      .hud__steppers {
        gap: 5px;
      }

      .hud__stepper {
        grid-template-columns: minmax(34px, 0.8fr) 30px minmax(40px, 1fr) 30px;
        gap: 3px;
        padding: 4px;
        font-size: 10px;
      }

      .hud__fire {
        min-height: 42px;
        font-size: 14px;
      }

      .hud__utility {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
      }

      .hud__utility button,
      .hud__stepper button,
      .hud__hero-actions button,
      .hud__result-actions button {
        min-height: 32px;
        font-size: 10px;
      }

      .hud__status {
        min-height: 0;
        padding: 6px;
      }

      .hud__home {
        padding: 70px 10px 12px;
      }

      .hud__hero-copy {
        gap: 10px;
      }

      .hud__hero h1 {
        font-size: 30px;
      }

      .hud__hero p {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      .hud__level-path {
        grid-template-columns: minmax(0, 1fr);
        gap: 6px;
      }

      .hud__level-card {
        padding: 8px;
      }

      .hud__level-card:nth-child(n + 3) {
        display: none;
      }

      .hud__results {
        max-height: min(70svh, 560px);
        padding: 10px;
      }

      .hud__settings {
        padding: 64px 10px 12px;
      }

      .hud__settings-panel {
        gap: 8px;
        max-height: calc(100svh - 76px);
        overflow: auto;
        padding: 10px;
      }

      .hud__settings h2 {
        font-size: 22px;
      }

      .hud__setting-row {
        gap: 8px;
        padding: 7px;
      }

      .hud__setting-row:not(.hud__setting-row--toggle):not(.hud__setting-row--stacked) {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(112px, 1.6fr) 42px;
      }

      .hud__segmented {
        grid-template-columns: minmax(0, 1fr);
      }

      .hud__segmented button {
        min-height: 30px;
        font-size: 10px;
      }

      .hud__result-head strong {
        font-size: 20px;
      }

      .hud__stars span {
        width: 34px;
        height: 34px;
        font-size: 20px;
      }

      .hud__total strong {
        font-size: 28px;
      }
    }
  `;
  document.head.appendChild(style);
}

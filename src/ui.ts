import type { ArcadeLevelProgress, ArcadeResult } from "./arcade";
import type { ArcadeMissionFields } from "./levels";
import type { ProjectileDefinition, ProjectileId } from "./projectile";
import { PROJECTILE_ORDER, PROJECTILES } from "./projectile";
import type { ScoreBreakdown } from "./scoring";
import {
  GRAPHICS_QUALITY_LABELS,
  RENDERER_BACKEND_LABELS,
  type GameSettings,
  type GraphicsQuality,
  type RendererBackendPreference
} from "./settings";

interface UIState {
  projectileId: ProjectileId;
  projectile: ProjectileDefinition;
  shotAvailable: boolean;
  canFinishRun: boolean;
  bodyCount: number;
  levelName: string;
  levelDescription: string;
  objective: string;
  chaosBrief: string;
  mission: ArcadeMissionFields;
  levelIndex: number;
  levelCount: number;
  levels: UILevelOption[];
  levelProgress: ArcadeLevelProgress;
  totalStars: number;
  arcadeResult: ArcadeResult | null;
  settings: GameSettings;
  status: string;
  fps: number;
  score: ScoreBreakdown | null;
}

interface UILevelOption {
  index: number;
  name: string;
  description: string;
  objective: string;
  progress: ArcadeLevelProgress;
  locked: boolean;
}

interface UICallbacks {
  fire(): void;
  reset(): void;
  clearDebris(): void;
  finishRun(): void;
  openMainMenu(): void;
  selectProjectile(id: ProjectileId): void;
  selectLevel(index: number): boolean;
  nextLevel(): void;
  updateSettings(patch: Partial<GameSettings>): void;
  resetSettings(): void;
}

type UIScreen = "home" | "settings" | "play";

export class GameUI {
  private readonly root: HTMLDivElement;
  private readonly projectileValue: HTMLSpanElement;
  private readonly chamberValue: HTMLSpanElement;
  private readonly objectiveValue: HTMLSpanElement;
  private readonly chaosBriefValue: HTMLElement;
  private readonly shotsValue: HTMLSpanElement;
  private readonly bodyValue: HTMLSpanElement;
  private readonly fpsValue: HTMLElement;
  private readonly statusValue: HTMLDivElement;
  private readonly fireButton: HTMLButtonElement;
  private readonly finishButton: HTMLButtonElement;
  private readonly finishHint: HTMLDivElement;
  private readonly turnPrompt: HTMLButtonElement;
  private readonly turnPromptTitle: HTMLElement;
  private readonly turnPromptHint: HTMLElement;
  private readonly scorePanel: HTMLDivElement;
  private readonly homeLevelRail: HTMLDivElement;
  private readonly targetScoreValue: HTMLSpanElement;
  private readonly targetDamageValue: HTMLSpanElement;
  private readonly threeStarValue: HTMLSpanElement;
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
  private readonly rendererBackendButtons = new Map<RendererBackendPreference, HTMLButtonElement>();

  private screen: UIScreen = "home";
  private scoreWasVisible = false;
  private renderedScore: ScoreBreakdown | null = null;
  private activeProjectileId: ProjectileId | null = null;
  private currentState: UIState | null = null;
  private renderedHomeKey = "";
  private renderedSettingsKey = "";

  constructor(private readonly callbacks: UICallbacks) {
    installStyles();

    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.dataset.screen = this.screen;
    this.root.innerHTML = `
      <div class="hud__topbar" aria-live="polite">
        <div class="hud__brand">
          <span class="hud__brand-mark">DM</span>
          <div>
            <strong>Downtown Mayhem</strong>
            <span>Object destruction range</span>
          </div>
        </div>
        <div class="hud__telemetry">
          <span data-role="fps"></span>
          <span><strong data-role="bodies"></strong> objects</span>
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
          <em data-role="chaos-brief"></em>
        </div>

        <div class="hud__goal-grid">
          <div><span>2-star unlock</span><strong data-role="target-score"></strong></div>
          <div><span>Object damage</span><strong data-role="target-damage"></strong></div>
          <div><span>3-star route</span><strong data-role="three-star"></strong></div>
          <div><span>Bonus</span><strong data-role="bonus-goal"></strong></div>
        </div>

        <div class="hud__loadout-head">
          <span>Payload</span>
          <strong data-role="projectile"></strong>
        </div>
        <div class="hud__projectiles" data-role="projectiles"></div>

        <button class="hud__fire" type="button">FIRE</button>

        <div class="hud__utility">
          <button type="button" data-action="finish-run" hidden>Score Now</button>
          <button type="button" data-action="reset">Retry</button>
        </div>
        <div class="hud__finish-hint" data-role="finish-hint" hidden>Done watching? Press F or Enter, or click Score Now.</div>
        <div class="hud__status" data-role="status"></div>
      </section>

      <button class="hud__turn-prompt" type="button" data-action="turn-finish" hidden>
        <span>Turn in progress</span>
        <strong data-role="turn-prompt-title">Watching mayhem</strong>
        <em data-role="turn-prompt-hint">Score unlocks when the chain reactions settle.</em>
      </button>

      <section class="hud__results" data-role="score" aria-live="polite"></section>

      <section class="hud__home" aria-label="Downtown Mayhem menu">
        <div class="hud__hero">
          <div class="hud__hero-copy">
            <span class="hud__eyebrow">DESTRUCTIBLE OBJECT ARCADE</span>
            <h1>Downtown Mayhem</h1>
            <p>Select a district, choose a payload, fire once, then chase a high Mayhem Score.</p>
            <div class="hud__hero-actions">
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

          <div class="hud__setting-row hud__setting-row--stacked">
            <span>Renderer</span>
            <div class="hud__segmented" role="group" aria-label="Renderer backend">
              <button type="button" data-renderer-backend="auto">Auto</button>
              <button type="button" data-renderer-backend="webgpu">WebGPU</button>
              <button type="button" data-renderer-backend="webgl">WebGL</button>
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

    this.projectileValue = this.requireElement("[data-role='projectile']");
    this.chamberValue = this.requireElement("[data-role='chamber']");
    this.objectiveValue = this.requireElement("[data-role='objective']");
    this.chaosBriefValue = this.requireElement("[data-role='chaos-brief']");
    this.shotsValue = this.requireElement("[data-role='shots']");
    this.bodyValue = this.requireElement("[data-role='bodies']");
    this.fpsValue = this.requireElement("[data-role='fps']");
    this.statusValue = this.requireElement("[data-role='status']");
    this.fireButton = this.requireElement(".hud__fire");
    this.finishButton = this.requireElement("[data-action='finish-run']");
    this.finishHint = this.requireElement("[data-role='finish-hint']");
    this.turnPrompt = this.requireElement("[data-action='turn-finish']");
    this.turnPromptTitle = this.requireElement("[data-role='turn-prompt-title']");
    this.turnPromptHint = this.requireElement("[data-role='turn-prompt-hint']");
    this.scorePanel = this.requireElement("[data-role='score']");
    this.homeLevelRail = this.requireElement("[data-role='home-levels']");
    this.targetScoreValue = this.requireElement("[data-role='target-score']");
    this.targetDamageValue = this.requireElement("[data-role='target-damage']");
    this.threeStarValue = this.requireElement("[data-role='three-star']");
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
    this.finishButton.addEventListener("click", () => this.callbacks.finishRun());
    this.turnPrompt.addEventListener("click", () => {
      if (!this.turnPrompt.disabled) {
        this.callbacks.finishRun();
      }
    });
    this.requireElement<HTMLButtonElement>("[data-action='reset']").addEventListener("click", () => this.callbacks.reset());
    this.requireElement<HTMLButtonElement>("[data-action='menu']").addEventListener("click", () => this.callbacks.openMainMenu());
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
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-renderer-backend]")) {
      const rendererBackend = button.dataset.rendererBackend;
      if (isRendererBackendPreference(rendererBackend)) {
        this.rendererBackendButtons.set(rendererBackend, button);
        button.addEventListener("click", () => this.callbacks.updateSettings({ rendererBackend }));
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
    setText(this.projectileValue, state.projectile.shortName);
    setTitle(this.projectileValue, state.projectile.name);
    setText(this.chamberValue, state.levelName);
    setTitle(this.chamberValue, state.levelDescription);
    setText(this.objectiveValue, state.objective);
    setText(this.chaosBriefValue, state.chaosBrief);
    setText(this.shotsValue, state.shotAvailable ? "READY" : "SPENT");
    setText(this.bodyValue, String(state.bodyCount));
    const fpsHidden = !state.settings.showFps;
    if (this.fpsValue.hidden !== fpsHidden) {
      this.fpsValue.hidden = fpsHidden;
    }
    if (state.settings.showFps) {
      setText(this.fpsValue, `${state.fps} FPS`);
    }
    setText(this.statusValue, state.status);
    setText(this.targetScoreValue, `${formatScoreNumber(state.mission.scoreThresholds.twoStar)}+`);
    setText(this.targetDamageValue, formatScoreNumber(state.mission.targetDamageThreshold));
    setText(this.threeStarValue, `${formatScoreNumber(state.mission.scoreThresholds.threeStar)}+`);
    setText(this.bonusGoalValue, bonusSummary(state.mission));

    const blocked = this.isGameplayBlocked();
    if (this.fireButton.disabled !== (!state.shotAvailable || blocked)) {
      this.fireButton.disabled = !state.shotAvailable || blocked;
    }
    const finishHidden = !state.canFinishRun || Boolean(state.score);
    if (this.finishButton.hidden !== finishHidden) {
      this.finishButton.hidden = finishHidden;
    }
    if (this.finishHint.hidden !== finishHidden) {
      this.finishHint.hidden = finishHidden;
    }
    if (this.finishButton.disabled !== (finishHidden || blocked)) {
      this.finishButton.disabled = finishHidden || blocked;
    }
    const postShot = !state.shotAvailable && !state.score;
    const turnPromptHidden = !postShot || this.screen !== "play";
    if (this.turnPrompt.hidden !== turnPromptHidden) {
      this.turnPrompt.hidden = turnPromptHidden;
    }
    const turnPromptDisabled = !state.canFinishRun || blocked;
    if (this.turnPrompt.disabled !== turnPromptDisabled) {
      this.turnPrompt.disabled = turnPromptDisabled;
    }
    setText(this.turnPromptTitle, state.canFinishRun ? "Tap to score" : "Watching mayhem");
    setText(
      this.turnPromptHint,
      state.canFinishRun ? "End the turn and show the result." : "Score unlocks when the chain reactions settle."
    );
    this.root.classList.toggle("is-post-shot", postShot);
    this.root.classList.toggle("can-finish-run", state.canFinishRun && !state.score);
    this.root.classList.toggle("has-shot-available", state.shotAvailable && !state.score);

    if (this.activeProjectileId !== state.projectileId) {
      for (const [id, button] of this.projectileButtons) {
        const active = id === state.projectileId;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      this.activeProjectileId = state.projectileId;
    }

    const homeKey = homeRenderKey(state);
    if (this.renderedHomeKey !== homeKey) {
      this.renderHomeLevels(state);
      this.renderedHomeKey = homeKey;
    }
    const settingsKey = settingsRenderKey(state.settings);
    if (this.renderedSettingsKey !== settingsKey) {
      this.renderSettings(state.settings);
      this.renderedSettingsKey = settingsKey;
    }
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

  showPlayScreen(): void {
    this.showScreen("play");
  }

  hideScorePanel(): void {
    this.scoreWasVisible = false;
    this.renderedScore = null;
    this.scorePanel.classList.remove("is-visible");
    this.scorePanel.innerHTML = "";
    this.root.classList.remove("has-results");
  }

  showHomeScreen(): void {
    this.showScreen("home");
  }

  dispose(): void {
    this.root.remove();
  }

  private startLevel(levelIndex: number): void {
    if (this.callbacks.selectLevel(levelIndex)) {
      this.showScreen("play");
    }
  }

  private showScreen(screen: UIScreen): void {
    this.screen = screen;
    this.root.dataset.screen = screen;
    if (this.currentState) {
      this.update(this.currentState);
    }
  }

  private renderHomeLevels(state: UIState): void {
    const html = state.levels
      .map((level) => {
        const active = level.index === state.levelIndex;
        const locked = level.locked;
        const progressText = locked
          ? "LOCKED / get 2 stars on previous level"
          : `${active ? "ACTIVE" : "LEVEL"} / ${starText(level.progress.stars)}`;
        return `
          <button type="button" class="hud__level-card${active ? " is-current" : ""}${locked ? " is-locked" : ""}" data-action="start-arcade" data-level-index="${level.index}" ${locked ? "disabled" : ""}>
            <span>${String(level.index + 1).padStart(2, "0")} / ${progressText}</span>
            <strong>${escapeHtml(level.name)}</strong>
            <em>${escapeHtml(level.objective)}</em>
          </button>
        `;
      })
      .join("");
    if (this.homeLevelRail.innerHTML !== html) {
      this.homeLevelRail.innerHTML = html;
      for (const button of this.homeLevelRail.querySelectorAll<HTMLButtonElement>("[data-action='start-arcade']")) {
        button.addEventListener("click", () => this.startLevel(Number(button.dataset.levelIndex ?? 0)));
      }
    }
  }

  private renderSettings(settings: GameSettings): void {
    const volume = percent(settings.masterVolume);
    const shake = percent(settings.cameraShake);
    this.root.dataset.quality = settings.graphicsQuality;
    setText(
      this.settingsSummaryValue,
      `${GRAPHICS_QUALITY_LABELS[settings.graphicsQuality]} / ${RENDERER_BACKEND_LABELS[settings.rendererBackend]} renderer / AA ${settings.antialias ? "on" : "off"} / ${volume}% volume / ${shake}% shake`
    );

    for (const [quality, button] of this.qualityButtons) {
      const active = quality === settings.graphicsQuality;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const [rendererBackend, button] of this.rendererBackendButtons) {
      const active = rendererBackend === settings.rendererBackend;
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

function homeRenderKey(state: UIState): string {
  return [
    state.levelIndex,
    state.levelCount,
    state.totalStars,
    ...state.levels.flatMap((level) => [
      level.index,
      level.name,
      level.objective,
      Number(level.locked),
      level.progress.stars,
      level.progress.bestScore,
      level.progress.attempts
    ])
  ].join("|");
}

function settingsRenderKey(settings: GameSettings): string {
  return [
    settings.graphicsQuality,
    settings.rendererBackend,
    Number(settings.antialias),
    settings.masterVolume.toFixed(3),
    settings.cameraShake.toFixed(3),
    Number(settings.motionEffects),
    Number(settings.showFps)
  ].join("|");
}

function formatScoreNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function renderScore(state: UIState): string {
  const score = state.score;
  if (!score) {
    return "";
  }
  const result = state.arcadeResult;
  const stars = result?.stars ?? 0;
  const resultLabel = result?.completed ? (stars >= 3 ? "Maximum Mayhem" : "Mayhem Complete") : "Needs 2 Stars";
  const bonusValue = bonusMetricValue(score, state.mission.bonusThreshold.metric);
  const goals = [
    {
      label: "Object damage",
      value: `${formatScoreNumber(score.targetDamage)} / ${formatScoreNumber(state.mission.targetDamageThreshold)}`,
      passed: score.targetDamage >= state.mission.targetDamageThreshold
    },
    {
      label: "1-star score",
      value: `${formatScoreNumber(score.totalScore)} / ${formatScoreNumber(state.mission.scoreThresholds.oneStar)}`,
      passed: score.totalScore >= state.mission.scoreThresholds.oneStar
    },
    {
      label: "2-star unlock",
      value: `${formatScoreNumber(score.totalScore)} / ${formatScoreNumber(state.mission.scoreThresholds.twoStar)}`,
      passed: score.totalScore >= state.mission.scoreThresholds.twoStar
    },
    {
      label: "3-star route",
      value: `${formatScoreNumber(score.totalScore)} / ${formatScoreNumber(state.mission.scoreThresholds.threeStar)}`,
      passed: score.totalScore >= state.mission.scoreThresholds.threeStar
    },
    {
      label: state.mission.bonusObjective,
      value: `${formatScoreNumber(bonusValue)} / ${formatScoreNumber(state.mission.bonusThreshold.minimum)}`,
      passed: result?.bonusCompleted ?? false
    }
  ];

  return `
      <div class="hud__result-head">
      <span>${resultLabel}</span>
      <strong>${escapeHtml(score.mayhemRating)}</strong>
    </div>
    <div class="hud__stars" aria-label="${stars} stars">${renderStars(stars)}</div>
    <div class="hud__total">
      <span>Mayhem Score</span>
      <strong>${formatScoreNumber(score.totalScore)}</strong>
      <em>Best ${formatScoreNumber(state.levelProgress.bestScore)}</em>
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
      <div><span>Collateral Chaos</span><strong>${formatScoreNumber(score.collateralChaos)}</strong></div>
      <div><span>Chain Bonus</span><strong>${formatScoreNumber(score.chainReactionBonus)}</strong></div>
      <div><span>Chain Hits</span><strong>${score.chainReactionCount}${score.maxChainCombo > 1 ? ` / x${score.maxChainCombo}` : ""}</strong></div>
      <div><span>Motion Bonus</span><strong>${formatScoreNumber(score.remainingDebrisMotion)}</strong></div>
    </div>
    <div class="hud__result-actions">
      <button type="button" data-action="result-retry">Retry</button>
      <button type="button" data-action="result-next">Next Level</button>
    </div>
  `;
}

function bonusSummary(mission: ArcadeMissionFields): string {
  return `${formatScoreNumber(mission.bonusThreshold.minimum)}+ ${metricLabel(mission.bonusThreshold.metric)}`;
}

function bonusMetricValue(score: ScoreBreakdown, metric: ArcadeMissionFields["bonusThreshold"]["metric"]): number {
  return score[metric];
}

function metricLabel(metric: ArcadeMissionFields["bonusThreshold"]["metric"]): string {
  switch (metric) {
    case "targetDamage":
      return "target";
    case "collateralChaos":
      return "collateral";
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

function isRendererBackendPreference(value: string | undefined): value is RendererBackendPreference {
  return value === "auto" || value === "webgpu" || value === "webgl";
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
      --hud-edge: 16px;
      --hud-edge-mobile: 10px;
      --hud-safe-top: max(var(--hud-edge), env(safe-area-inset-top));
      --hud-safe-right: max(var(--hud-edge), env(safe-area-inset-right));
      --hud-safe-bottom: max(var(--hud-edge), env(safe-area-inset-bottom));
      --hud-safe-left: max(var(--hud-edge), env(safe-area-inset-left));
      --hud-safe-top-mobile: max(var(--hud-edge-mobile), env(safe-area-inset-top));
      --hud-safe-right-mobile: max(var(--hud-edge-mobile), env(safe-area-inset-right));
      --hud-safe-bottom-mobile: max(var(--hud-edge-mobile), env(safe-area-inset-bottom));
      --hud-safe-left-mobile: max(var(--hud-edge-mobile), env(safe-area-inset-left));
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
      -webkit-user-select: none;
      user-select: none;
    }

    input,
    textarea,
    [contenteditable="true"] {
      -webkit-user-select: text;
      user-select: text;
    }

    button {
      font: inherit;
      -webkit-user-select: none;
      user-select: none;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: #07090d;
      cursor: none;
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
      top: var(--hud-safe-top);
      left: var(--hud-safe-left);
      right: var(--hud-safe-right);
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
      left: var(--hud-safe-left);
      bottom: var(--hud-safe-bottom);
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
      grid-template-columns: repeat(4, minmax(0, 1fr));
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

    .hud__fire,
    .hud__utility button,
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

    .hud__utility {
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    }

    .hud__hero-actions {
      grid-template-columns: minmax(0, 160px);
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

    .hud__finish-hint {
      min-height: 14px;
      color: #bfe9f2;
      font-size: 10px;
      line-height: 1.25;
      text-align: left;
      opacity: 0.82;
    }

    .hud__turn-prompt {
      position: absolute;
      left: var(--hud-safe-left);
      right: var(--hud-safe-right);
      bottom: var(--hud-safe-bottom);
      display: none;
      justify-items: start;
      gap: 3px;
      width: min(420px, calc(100vw - 32px));
      min-height: 72px;
      padding: 12px 14px;
      border: 1px solid rgba(183, 255, 255, 0.7);
      border-radius: 8px;
      color: #051016;
      background:
        linear-gradient(180deg, rgba(170, 250, 255, 0.96), rgba(83, 214, 237, 0.94)),
        rgba(121, 240, 255, 0.92);
      box-shadow: 0 18px 42px rgba(20, 170, 210, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.58);
      cursor: pointer;
      pointer-events: auto;
      text-align: left;
      z-index: 6;
    }

    .hud__turn-prompt span,
    .hud__turn-prompt em {
      color: rgba(5, 16, 22, 0.68);
      font-size: 10px;
      font-style: normal;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .hud__turn-prompt strong {
      color: #051016;
      font-size: 20px;
      line-height: 1;
    }

    .hud__turn-prompt em {
      color: rgba(5, 16, 22, 0.74);
      font-size: 11px;
      text-transform: none;
    }

    .hud__turn-prompt:disabled {
      color: #d7f9ff;
      background: rgba(7, 11, 17, 0.72);
      border-color: rgba(185, 245, 255, 0.18);
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32);
      cursor: default;
    }

    .hud__turn-prompt:disabled strong,
    .hud__turn-prompt:disabled span,
    .hud__turn-prompt:disabled em {
      color: rgba(230, 250, 255, 0.76);
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
      right: var(--hud-safe-right);
      bottom: var(--hud-safe-bottom);
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
      align-items: flex-start;
      border-left: 3px solid #ff7c9f;
    }

    .hud__objective-list span {
      min-width: 0;
      white-space: normal;
    }

    .hud__objective-list div.is-passed {
      border-left-color: #72f0a5;
    }

    .hud__objective-list strong,
    .hud__score-breakdown strong,
    .hud__setting-row strong {
      flex: 0 0 auto;
      min-width: max-content;
      overflow: visible;
      color: #ffffff;
      font-size: 12px;
      text-align: right;
      text-overflow: clip;
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
      overflow: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
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
        left: var(--hud-safe-left-mobile);
        right: var(--hud-safe-right-mobile);
        top: var(--hud-safe-top-mobile);
      }

      .hud__telemetry span:nth-child(2) {
        display: none;
      }

      .hud__command,
      .hud__results {
        left: var(--hud-safe-left-mobile);
        right: var(--hud-safe-right-mobile);
        bottom: var(--hud-safe-bottom-mobile);
        width: auto;
        max-height: min(50svh, 430px);
      }

      .hud.is-post-shot[data-screen="play"] .hud__command {
        display: none;
        pointer-events: none;
      }

      .hud.is-post-shot[data-screen="play"] .hud__turn-prompt:not([hidden]) {
        display: grid;
        left: var(--hud-safe-left-mobile);
        right: var(--hud-safe-right-mobile);
        bottom: var(--hud-safe-bottom-mobile);
        width: auto;
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
        grid-template-columns: minmax(0, 150px);
      }

      .hud__level-path {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 520px) {
      .hud::before {
        opacity: 0.48;
      }

      .hud[data-screen="play"]::before {
        opacity: 0.34;
      }

      .hud__topbar {
        min-height: 52px;
        padding: 7px 8px;
      }

      .hud.is-post-shot[data-screen="play"] .hud__topbar {
        left: auto;
        width: auto;
        gap: 0;
        min-height: 42px;
        padding: 5px 7px;
        background: rgba(7, 11, 17, 0.58);
        backdrop-filter: blur(12px);
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
        min-height: 38px;
        padding: 0 9px;
        font-size: 10px;
      }

      .hud.is-post-shot[data-screen="play"] .hud__brand-mark,
      .hud.is-post-shot[data-screen="play"] .hud__brand strong,
      .hud.is-post-shot[data-screen="play"] .hud__telemetry span {
        display: none;
      }

      .hud__command {
        gap: 6px;
        max-height: none;
        padding: 8px;
        overflow: visible;
      }

      .hud__mission {
        gap: 2px;
      }

      .hud__mission > strong {
        font-size: 14px;
      }

      .hud__mission > span,
      .hud__mission > em,
      .hud__status {
        font-size: 10px;
      }

      .hud__mission > span {
        display: none;
      }

      .hud__mission > em {
        display: none;
      }

      .hud__goal-grid {
        display: none;
      }

      .hud__goal-grid::-webkit-scrollbar,
      .hud__projectiles::-webkit-scrollbar {
        display: none;
      }

      .hud__goal-grid div {
        min-height: 42px;
        padding: 6px;
        scroll-snap-align: start;
      }

      .hud__goal-grid span {
        font-size: 9px;
      }

      .hud__projectiles {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 4px;
      }

      .hud__projectile {
        min-height: 44px;
        padding: 2px;
      }

      .hud__projectile span {
        font-size: 9px;
        line-height: 1.05;
      }

      .hud__projectile small {
        display: none;
      }

      .hud__fire {
        min-height: 50px;
        font-size: 14px;
        order: 20;
        position: sticky;
        bottom: 0;
        z-index: 1;
      }

      .hud__utility {
        grid-template-columns: minmax(0, 1fr);
        gap: 5px;
        order: 19;
      }

      .hud.has-shot-available[data-screen="play"] .hud__utility {
        display: none;
      }

      .hud__utility button,
      .hud__hero-actions button,
      .hud__result-actions button {
        min-height: 40px;
        font-size: 10px;
      }

      .hud__finish-hint {
        font-size: 9px;
        line-height: 1.15;
      }

      .hud__turn-prompt {
        min-height: 68px;
        padding: 11px 12px;
      }

      .hud__turn-prompt strong {
        font-size: 18px;
      }

      .hud__turn-prompt span,
      .hud__turn-prompt em {
        font-size: 10px;
      }

      .hud__loadout-head {
        display: none;
      }

      .hud__status {
        display: none;
      }

      .hud__home {
        align-items: end;
        padding: calc(70px + env(safe-area-inset-top)) var(--hud-safe-right-mobile) var(--hud-safe-bottom-mobile) var(--hud-safe-left-mobile);
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

      .hud__results {
        max-height: min(74svh, 560px);
        padding: 10px;
      }

      .hud.has-results .hud__topbar {
        display: none;
      }

      .hud.has-results .hud__results {
        inset: auto var(--hud-safe-right-mobile) var(--hud-safe-bottom-mobile) var(--hud-safe-left-mobile);
        max-height: min(82svh, 640px);
        border-radius: 8px;
      }

      .hud__settings {
        padding: calc(64px + env(safe-area-inset-top)) var(--hud-safe-right-mobile) var(--hud-safe-bottom-mobile) var(--hud-safe-left-mobile);
      }

      .hud__settings-panel {
        gap: 8px;
        max-height: calc(100svh - 76px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
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

    @media (max-width: 520px) and (max-height: 700px) {
      .hud__command {
        max-height: min(334px, calc(100svh - 72px));
      }

      .hud__goal-grid {
        display: none;
      }
    }

    @media (max-width: 840px) and (max-height: 520px) {
      .hud__command {
        left: auto;
        width: min(390px, calc(52vw - var(--hud-edge-mobile)));
        max-height: calc(100svh - var(--hud-safe-top-mobile) - var(--hud-safe-bottom-mobile));
      }

      .hud__home {
        align-items: start;
      }
    }
  `;
  document.head.appendChild(style);
}

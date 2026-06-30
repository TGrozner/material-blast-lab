import type { ArcadeContractObjectiveResult, ArcadeLevelProgress, ArcadeResult } from "./arcade";
import type { ArcadeMissionFields } from "./levels";
import type { DailyResultMeta, RunFeedback } from "./mayhemFeatures";
import type { ProjectileDefinition, ProjectileId } from "./projectile";
import { LATE_GAME_PROJECTILE_ORDER, PROJECTILES } from "./projectile";
import type { ScoreBreakdown } from "./scoring";
import {
  COMFORT_GAME_SETTINGS,
  GRAPHICS_QUALITY_LABELS,
  type GameSettings,
  type GraphicsQuality
} from "./settings";

export interface UIResultMeta {
  previousBestScore: number;
  previousStars: number;
  newBest: boolean;
  starsGained: number;
  dailyResult?: DailyResultMeta;
  justUnlockedLevelName?: string;
  justUnlockedPayloadName?: string;
}

export interface UILiveMastery {
  scoreLabel: string;
  scoreValue: string;
  scoreProgress: number;
  bonusLabel: string;
  bonusValue: string;
  bonusProgress: number;
  contractLabel: string;
  contractValue: string;
  contractProgress: number;
  contractCompleted: boolean;
  signals: string[];
}

interface UIState {
  projectileId: ProjectileId;
  projectile: ProjectileDefinition;
  availableProjectiles: readonly ProjectileId[];
  shotAvailable: boolean;
  canFinishRun: boolean;
  bodyCount: number;
  levelName: string;
  levelDescription: string;
  objective: string;
  chaosBrief: string;
  levelSignal: string;
  mission: ArcadeMissionFields;
  levelIndex: number;
  levelCount: number;
  levels: UILevelOption[];
  levelProgress: ArcadeLevelProgress;
  totalStars: number;
  arcadeResult: ArcadeResult | null;
  resultMeta: UIResultMeta | null;
  runFeedback: RunFeedback | null;
  loadoutLocked: boolean;
  settings: GameSettings;
  status: string;
  fps: number;
  liveScore: ScoreBreakdown | null;
  liveMastery: UILiveMastery | null;
  score: ScoreBreakdown | null;
}

export interface UILevelOption {
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
  focusReplayMoment(index: number): void;
  updateSettings(patch: Partial<GameSettings>): void;
  resetSettings(): void;
}

type UIScreen = "home" | "settings" | "play";

export class GameUI {
  private readonly root: HTMLDivElement;
  private readonly modeLabelValue: HTMLSpanElement;
  private readonly loadoutLabelValue: HTMLSpanElement;
  private readonly projectileValue: HTMLSpanElement;
  private readonly chamberValue: HTMLSpanElement;
  private readonly objectiveValue: HTMLSpanElement;
  private readonly chaosBriefValue: HTMLElement;
  private readonly levelSignalValue: HTMLElement;
  private readonly shotsValue: HTMLSpanElement;
  private readonly bodyValue: HTMLSpanElement;
  private readonly fpsValue: HTMLElement;
  private readonly statusValue: HTMLDivElement;
  private readonly fireButton: HTMLButtonElement;
  private readonly finishButton: HTMLButtonElement;
  private readonly finishHint: HTMLDivElement;
  private readonly liveScorePanel: HTMLDivElement;
  private readonly liveScoreValue: HTMLElement;
  private readonly liveScoreRailValue: HTMLElement;
  private readonly liveMasteryValue: HTMLElement;
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

  private screen: UIScreen = "home";
  private scoreWasVisible = false;
  private renderedScore: ScoreBreakdown | null = null;
  private currentState: UIState | null = null;
  private renderedHomeKey = "";
  private renderedSettingsKey = "";
  private scoreCountAnimation = 0;
  private displayedLiveScore = 0;

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
          <button class="hud__menu-button" type="button" data-action="menu" aria-label="Menu">
            <span class="hud__menu-icon" aria-hidden="true"><i></i></span>
            <span class="hud__menu-label">Menu</span>
          </button>
        </div>
      </div>

      <section class="hud__command" aria-label="Mission command">
        <div class="hud__mission">
          <div class="hud__mission-kicker">
            <span data-role="mode-label">Cannon Trial</span>
            <strong data-role="shots"></strong>
          </div>
          <strong data-role="chamber"></strong>
          <span data-role="objective"></span>
          <em data-role="chaos-brief"></em>
          <small data-role="level-signal"></small>
        </div>

        <div class="hud__goal-grid">
          <div><span>2-star unlock</span><strong data-role="target-score"></strong></div>
          <div><span>Object damage</span><strong data-role="target-damage"></strong></div>
          <div><span>3-star score</span><strong data-role="three-star"></strong></div>
          <div><span>Bonus</span><strong data-role="bonus-goal"></strong></div>
        </div>

        <div class="hud__loadout-head">
          <span data-role="loadout-label">Payload</span>
          <strong data-role="projectile"></strong>
        </div>
        <div class="hud__projectiles" data-role="projectiles"></div>

        <button class="hud__fire" type="button">FIRE</button>

        <div class="hud__utility">
          <button type="button" data-action="finish-run" hidden>Score Now</button>
          <button type="button" data-action="reset">Retry</button>
        </div>
        <div class="hud__live-score" data-role="live-score" hidden>
          <span>Running Mayhem</span>
          <strong data-role="live-score-value">0</strong>
          <div><i data-role="live-score-rail"></i></div>
          <small data-role="live-mastery"></small>
        </div>
        <div class="hud__finish-hint" data-role="finish-hint" hidden>Done watching the run? Press F or Enter, or click Score Now.</div>
        <div class="hud__status" data-role="status"></div>
      </section>

      <button class="hud__turn-prompt" type="button" data-action="turn-finish" hidden>
        <span>Turn in progress</span>
        <strong data-role="turn-prompt-title">Watching mayhem</strong>
        <em data-role="turn-prompt-hint">Score unlocks when the chain reactions settle.</em>
      </button>

      <section class="hud__results" data-role="score" aria-live="polite" aria-label="Run result" tabindex="-1"></section>

      <section class="hud__home" aria-label="Downtown Mayhem menu">
        <div class="hud__hero">
          <div class="hud__hero-copy">
            <span class="hud__eyebrow">DESTRUCTIBLE OBJECT ARCADE</span>
            <h1>Downtown Mayhem</h1>
            <p>Select a district, choose a one-run mode, then chase a high Mayhem Score.</p>
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
            <button type="button" data-action="settings-comfort">Comfort</button>
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

    this.modeLabelValue = this.requireElement("[data-role='mode-label']");
    this.loadoutLabelValue = this.requireElement("[data-role='loadout-label']");
    this.projectileValue = this.requireElement("[data-role='projectile']");
    this.chamberValue = this.requireElement("[data-role='chamber']");
    this.objectiveValue = this.requireElement("[data-role='objective']");
    this.chaosBriefValue = this.requireElement("[data-role='chaos-brief']");
    this.levelSignalValue = this.requireElement("[data-role='level-signal']");
    this.shotsValue = this.requireElement("[data-role='shots']");
    this.bodyValue = this.requireElement("[data-role='bodies']");
    this.fpsValue = this.requireElement("[data-role='fps']");
    this.statusValue = this.requireElement("[data-role='status']");
    this.fireButton = this.requireElement(".hud__fire");
    this.finishButton = this.requireElement("[data-action='finish-run']");
    this.finishHint = this.requireElement("[data-role='finish-hint']");
    this.liveScorePanel = this.requireElement("[data-role='live-score']");
    this.liveScoreValue = this.requireElement("[data-role='live-score-value']");
    this.liveScoreRailValue = this.requireElement("[data-role='live-score-rail']");
    this.liveMasteryValue = this.requireElement("[data-role='live-mastery']");
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
    for (const id of LATE_GAME_PROJECTILE_ORDER) {
      const definition = PROJECTILES[id];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hud__projectile";
      button.hidden = true;
      button.setAttribute("aria-label", definition.shortName);
      button.title = `${definition.key}: ${definition.name} - ${definition.role}. ${definition.usageTip}`;
      button.style.setProperty("--projectile", `#${definition.color.getHexString()}`);
      button.innerHTML = `<span>${definition.shortName}</span><small>${definition.key} / ${escapeHtml(definition.role)}</small>`;
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
    this.requireElement<HTMLButtonElement>("[data-action='settings-comfort']").addEventListener("click", () =>
      this.callbacks.updateSettings({ ...COMFORT_GAME_SETTINGS })
    );
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
    setText(this.modeLabelValue, "Cannon Trial");
    setText(this.loadoutLabelValue, "Payload");
    setText(this.projectileValue, state.projectile.shortName);
    setTitle(this.projectileValue, state.projectile.name);
    setText(this.chamberValue, state.levelName);
    setTitle(this.chamberValue, state.levelDescription);
    setText(this.objectiveValue, state.objective);
    setText(this.chaosBriefValue, state.chaosBrief);
    setText(this.levelSignalValue, state.levelSignal);
    setText(this.shotsValue, state.shotAvailable ? "READY" : "SPENT");
    setText(this.bodyValue, String(state.bodyCount));
    const fpsHidden = !state.settings.showFps;
    if (this.fpsValue.hidden !== fpsHidden) {
      this.fpsValue.hidden = fpsHidden;
    }
    if (state.settings.showFps) {
      setText(this.fpsValue, `${state.fps} FPS`);
    }
    const statusHidden = state.status.trim().length === 0;
    if (this.statusValue.hidden !== statusHidden) {
      this.statusValue.hidden = statusHidden;
    }
    setText(this.statusValue, state.status);
    setText(this.fireButton, fireButtonLabel(state));
    setText(this.targetScoreValue, `${formatScoreNumber(state.mission.scoreThresholds.twoStar)}+`);
    setText(this.targetDamageValue, formatScoreNumber(state.mission.targetDamageThreshold));
    setText(this.threeStarValue, `${formatScoreNumber(state.mission.scoreThresholds.threeStar)}+`);
    setText(this.bonusGoalValue, bonusSummary(state.mission));

    const blocked = this.isGameplayBlocked();
    if (this.fireButton.hidden) {
      this.fireButton.hidden = false;
    }
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
    setText(this.finishHint, "Done watching the run? Press F or Enter, or click Score Now.");
    if (this.finishButton.disabled !== (finishHidden || blocked)) {
      this.finishButton.disabled = finishHidden || blocked;
    }
    const postShot = !state.shotAvailable && !state.score;
    const showLiveScore = postShot && this.screen === "play" && Boolean(state.liveScore);
    if (this.liveScorePanel.hidden !== !showLiveScore) {
      this.liveScorePanel.hidden = !showLiveScore;
    }
    if (showLiveScore && state.liveScore) {
      this.updateLiveScore(state.liveScore, state.mission.scoreThresholds, state.liveMastery);
    } else if (!state.score && this.displayedLiveScore !== 0) {
      this.displayedLiveScore = 0;
      setText(this.liveScoreValue, "0");
      this.liveScoreRailValue.style.width = "0%";
      setText(this.liveMasteryValue, "");
      this.liveScorePanel.classList.remove("is-surging");
    }
    const turnPromptHidden = !postShot || this.screen !== "play";
    if (this.turnPrompt.hidden !== turnPromptHidden) {
      this.turnPrompt.hidden = turnPromptHidden;
    }
    const turnPromptDisabled = !state.canFinishRun || blocked;
    if (this.turnPrompt.disabled !== turnPromptDisabled) {
      this.turnPrompt.disabled = turnPromptDisabled;
    }
    setText(this.turnPrompt.querySelector("span") ?? this.turnPrompt, state.canFinishRun ? "Score ready" : "Post-shot scoring");
    setText(this.turnPromptTitle, state.canFinishRun ? "Tap to reveal result" : "Watching chain reactions");
    setText(
      this.turnPromptHint,
      state.liveScore && state.liveScore.totalScore > 0
        ? `${formatScoreNumber(state.liveScore.totalScore)} running Mayhem; score locks when debris settles.`
        : state.canFinishRun
          ? "End the turn and show stars, contract, and retry recipe."
          : "Score unlocks after the spectacle phase settles."
    );
    this.root.classList.toggle("is-post-shot", postShot);
    this.root.classList.toggle("can-finish-run", state.canFinishRun && !state.score);
    this.root.classList.toggle("has-shot-available", state.shotAvailable && !state.score);

    for (const [id, button] of this.projectileButtons) {
      const active = id === state.projectileId;
      const visible = state.availableProjectiles.includes(id) || active;
      if (button.hidden !== !visible) {
        button.hidden = !visible;
      }
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const [id, button] of this.projectileButtons) {
      const locked = state.loadoutLocked;
      button.disabled = locked;
      button.title = locked
        ? "Daily and weekly contracts use a fixed payload."
        : `${PROJECTILES[id].key}: ${PROJECTILES[id].name} - ${PROJECTILES[id].role}. ${PROJECTILES[id].usageTip}`;
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
      this.scorePanel.dataset.resultState = resultStateKey(state);
      this.scorePanel.dataset.newBest = String(Boolean(state.resultMeta?.newBest));
      this.scorePanel.setAttribute("aria-label", resultPanelLabel(state));
      if (this.renderedScore !== state.score) {
        this.scorePanel.innerHTML = renderScore(state);
        this.bindResultActions();
        this.renderedScore = state.score;
      }
      this.scoreWasVisible = true;
      if (shouldRevealScore) {
        this.scorePanel.classList.add("is-ceremony-enter");
        this.scorePanel.scrollTo({ top: 0, behavior: "instant" });
        this.scorePanel.focus({ preventScroll: true });
        this.startScoreCountUp(state.score.totalScore);
        window.setTimeout(() => this.scorePanel.classList.remove("is-ceremony-enter"), 1200);
      }
    } else if (this.scoreWasVisible || this.renderedScore) {
      this.scoreWasVisible = false;
      this.renderedScore = null;
      this.scorePanel.classList.remove("is-visible");
      this.scorePanel.classList.remove("is-ceremony-enter");
      delete this.scorePanel.dataset.resultState;
      delete this.scorePanel.dataset.newBest;
      this.scorePanel.setAttribute("aria-label", "Run result");
      this.scorePanel.innerHTML = "";
      this.stopScoreCountUp();
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
    this.scorePanel.classList.remove("is-ceremony-enter");
    delete this.scorePanel.dataset.resultState;
    delete this.scorePanel.dataset.newBest;
    this.scorePanel.setAttribute("aria-label", "Run result");
    this.scorePanel.innerHTML = "";
    this.root.classList.remove("has-results");
    this.stopScoreCountUp();
  }

  showHomeScreen(): void {
    this.showScreen("home");
  }

  dispose(): void {
    this.stopScoreCountUp();
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
        const previous = state.levels[level.index - 1];
        const missingPreviousStars = previous ? Math.max(0, 2 - previous.progress.stars) : 0;
        const progressText = locked
          ? `LOCKED / ${missingPreviousStars} more ${missingPreviousStars === 1 ? "star" : "stars"} needed`
          : `${active ? "ACTIVE" : "LEVEL"} / ${starText(level.progress.stars)}`;
        const detailText = locked
          ? `${previous ? previous.name : "Previous district"} needs 2 stars to unlock this card.`
          : `${formatScoreNumber(level.progress.attempts)} attempts / Best ${formatScoreNumber(level.progress.bestScore)}`;
        const masteryText = locked ? "District Mastery hidden" : districtMasteryText(level.progress);
        const ariaLabel = locked
          ? `${level.name}, locked. Earn ${missingPreviousStars} more ${missingPreviousStars === 1 ? "star" : "stars"} on ${previous?.name ?? "the previous district"}.`
          : `${level.name}, ${level.objective}. ${level.description}. ${detailText}. ${masteryText}.`;
        return `
          <button type="button" class="hud__level-card${active ? " is-current" : ""}${locked ? " is-locked" : ""}" data-action="start-arcade" data-level-index="${level.index}" aria-label="${escapeHtml(ariaLabel)}" ${locked ? "disabled" : ""}>
            <span>${String(level.index + 1).padStart(2, "0")} / ${progressText}</span>
            <strong>${escapeHtml(level.name)}</strong>
            <em>${escapeHtml(level.objective)}</em>
            <small>${escapeHtml(level.description)}</small>
            <small>${escapeHtml(detailText)}</small>
            <small>${escapeHtml(masteryText)}</small>
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
      `${GRAPHICS_QUALITY_LABELS[settings.graphicsQuality]} / WebGL renderer / AA ${settings.antialias ? "on" : "off"} / ${volume}% volume / ${shake}% shake`
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
    this.scorePanel.querySelector<HTMLButtonElement>("[data-action='result-menu']")?.addEventListener("click", () => this.callbacks.openMainMenu());
    for (const button of this.scorePanel.querySelectorAll<HTMLButtonElement>("[data-action='replay-focus']")) {
      button.addEventListener("click", () => this.callbacks.focusReplayMoment(Number(button.dataset.replayIndex ?? -1)));
    }
  }

  private startScoreCountUp(totalScore: number): void {
    this.stopScoreCountUp();
    const value = this.scorePanel.querySelector<HTMLElement>("[data-role='result-total']");
    if (!value) {
      return;
    }
    const startedAt = performance.now();
    const durationMs = 900;
    const tick = (now: number): void => {
      const progress = THREEClamp01((now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setText(value, formatScoreNumber(initialScore + (totalScore - initialScore) * eased));
      if (progress < 1) {
        this.scoreCountAnimation = window.requestAnimationFrame(tick);
      } else {
        this.scoreCountAnimation = 0;
        setText(value, formatScoreNumber(totalScore));
      }
    };
    const initialScore = Math.min(this.displayedLiveScore, totalScore);
    setText(value, formatScoreNumber(initialScore));
    this.scoreCountAnimation = window.requestAnimationFrame(tick);
  }

  private updateLiveScore(score: ScoreBreakdown, thresholds: ArcadeMissionFields["scoreThresholds"], mastery: UILiveMastery | null): void {
    const target = Math.max(0, score.totalScore);
    const previous = this.displayedLiveScore;
    const next =
      previous <= 0
        ? target
        : previous + (target - previous) * (target > previous ? 0.22 : 0.36);
    this.displayedLiveScore = Math.abs(target - next) < 8 ? target : next;
    setText(this.liveScoreValue, formatScoreNumber(this.displayedLiveScore));
    const nextThreshold =
      target < thresholds.oneStar
        ? thresholds.oneStar
        : target < thresholds.twoStar
          ? thresholds.twoStar
          : target < thresholds.threeStar
            ? thresholds.threeStar
            : Math.max(thresholds.threeStar, target);
    const progress = nextThreshold <= 0 ? 1 : THREEClamp01(target / nextThreshold);
    this.liveScoreRailValue.style.width = `${Math.round((mastery?.scoreProgress ?? progress) * 100)}%`;
    setText(this.liveMasteryValue, mastery ? liveMasteryText(mastery) : "");
    if (target > previous + 250) {
      this.liveScorePanel.classList.remove("is-surging");
      void this.liveScorePanel.offsetWidth;
      this.liveScorePanel.classList.add("is-surging");
    }
  }

  private stopScoreCountUp(): void {
    if (this.scoreCountAnimation !== 0) {
      window.cancelAnimationFrame(this.scoreCountAnimation);
      this.scoreCountAnimation = 0;
    }
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
      level.progress.attempts,
      level.progress.threeStarCleared ? 1 : 0,
      level.progress.bestProjectileId ?? "none",
      level.progress.bestCombo
    ])
  ].join("|");
}

function settingsRenderKey(settings: GameSettings): string {
  return [
    settings.graphicsQuality,
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
  const districtRating = districtMayhemRating(state, score);
  const callouts = resultCallouts(state, score);
  const primaryAction = primaryResultAction(state);
  const hasNextDistrict = canStartNextDistrict(state);
  const bonusValue = bonusMetricValue(score, state.mission.bonusThreshold.metric);
  const hotspots = score.damageHotspots.slice(0, 4);
  const contractObjectives = result?.contract?.objectives ?? [];
  const feedback = state.runFeedback;
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
      label: "3-star score",
      value: `${formatScoreNumber(score.totalScore)} / ${formatScoreNumber(state.mission.scoreThresholds.threeStar)}`,
      passed: score.totalScore >= state.mission.scoreThresholds.threeStar
    },
    {
      label: "Bonus goal",
      value: `${formatScoreNumber(bonusValue)} / ${formatScoreNumber(state.mission.bonusThreshold.minimum)}`,
      passed: result?.bonusCompleted ?? false,
      hint: bonusGoalHint(state, score)
    }
  ];

  return `
      <div class="hud__result-head">
      <span>${resultLabel}</span>
      <strong>${escapeHtml(districtRating)}</strong>
      <em>${escapeHtml(score.mayhemRating)} global rating</em>
    </div>
    <div class="hud__stars" aria-label="${stars} stars">${renderStars(stars)}</div>
    ${renderResultCeremony(state, score)}
    ${callouts.length > 0 ? `<div class="hud__result-callouts">${callouts.map(renderResultCallout).join("")}</div>` : ""}
    <div class="hud__total">
      <span>Mayhem Score</span>
      <strong data-role="result-total">${formatScoreNumber(score.totalScore)}</strong>
      <em>${bestScoreLabel(state)}</em>
    </div>
    ${renderProgressionSummary(state, score)}
    ${renderShareCard(state, score)}
    ${state.resultMeta?.dailyResult ? renderDailyResultSummary(state.resultMeta.dailyResult) : ""}
    ${feedback ? renderRunCoach(feedback) : ""}
    <div class="hud__objective-list">
      ${goals
        .map(
          (goal) => `
            <div class="${goal.passed ? "is-passed" : "is-missed"}">
              <span>${escapeHtml(goal.label)}</span>
              <strong>${escapeHtml(goal.value)}</strong>
              ${"hint" in goal && goal.hint ? `<em>${escapeHtml(goal.hint)}</em>` : ""}
            </div>
          `
        )
        .join("")}
    </div>
    ${contractObjectives.length > 0 ? renderContractObjectives(result?.contract?.completed ?? false, contractObjectives) : ""}
    <div class="hud__score-breakdown">
      <div><span>Payload</span><strong>${escapeHtml(score.shotName)}</strong></div>
      <div><span>Collateral Chaos</span><strong>${formatScoreNumber(score.collateralChaos)}</strong></div>
      <div><span>Chain Score</span><strong>${formatScoreNumber(score.chainReactionBonus)}</strong></div>
      <div><span>Secondary Hits</span><strong>${formatScoreNumber(score.chainReactionCount)}</strong></div>
      ${score.maxChainCombo > 1 ? `<div><span>Best Chain</span><strong>${formatScoreNumber(score.maxChainCombo)}</strong></div>` : ""}
      ${score.weakPointBreakCount > 0 ? `<div><span>Weak Points</span><strong>${score.weakPointBreakCount}</strong></div>` : ""}
      ${score.bossBreakCount > 0 ? `<div><span>Boss Breaks</span><strong>${score.bossBreakCount}</strong></div>` : ""}
      <div><span>Motion Bonus</span><strong>${formatScoreNumber(score.remainingDebrisMotion)}</strong></div>
    </div>
    <div class="hud__damage-hotspots">
      <div class="hud__damage-hotspots-head"><span>Top Damage</span><strong>${hotspots.length > 0 ? `${hotspots.length} zones` : "None"}</strong></div>
      ${
        hotspots.length > 0
          ? hotspots.map(renderDamageHotspot).join("")
          : `<div class="hud__damage-hotspot"><span><strong>No major location</strong><em>Direct hit or debris did not register a dominant zone</em></span><b>0</b></div>`
      }
    </div>
    <div class="hud__result-actions">
      <button type="button" data-action="result-menu" aria-label="Return to district menu">Menu</button>
      ${primaryAction === "retry" ? `<button class="is-primary" type="button" data-action="result-retry" aria-label="${result?.completed ? "Retry this district for three stars" : "Retry this run with the coach recipe"}">${result?.completed ? "Retry For 3 Stars" : "Retry Run"}</button>` : `<button type="button" data-action="result-retry" aria-label="Retry this district">Retry</button>`}
      ${hasNextDistrict ? (primaryAction === "next" ? `<button class="is-primary" type="button" data-action="result-next" aria-label="Start the next unlocked district">Next District</button>` : `<button type="button" data-action="result-next" aria-label="Start the next unlocked district">Next District</button>`) : ""}
    </div>
  `;
}

function renderResultCeremony(state: UIState, score: ScoreBreakdown): string {
  const result = state.arcadeResult;
  const stars = result?.stars ?? 0;
  const replayMoment = state.runFeedback?.replayMoment;
  const topSource = state.runFeedback?.topSources[0];
  const signature = replayMoment?.label ?? topSource?.label ?? score.shotName;
  const signaturePoints = replayMoment?.points ?? topSource?.points ?? score.targetDamage;
  const title = stars >= 3 ? "Perfect BOOM" : result?.completed ? "Mission BOOM" : "Almost BOOM";
  const chase = nextStarGap(state, score);
  const chaseLabel = chase > 0 ? `${formatScoreNumber(chase)} to next star` : "Star gate cleared";
  return `
    <div class="hud__result-ceremony" data-role="result-boom">
      <div>
        <span>${escapeHtml(title)}</span>
        <strong>BOOM</strong>
        <em>${escapeHtml(signature)} / ${formatScoreNumber(signaturePoints)} pts</em>
      </div>
      <div class="hud__result-ceremony-stats">
        <span>${formatScoreNumber(score.chainReactionCount)} hits</span>
        <span>${formatScoreNumber(score.targetDamage)} object</span>
        <span>${escapeHtml(chaseLabel)}</span>
      </div>
    </div>
  `;
}

function renderProgressionSummary(state: UIState, score: ScoreBreakdown): string {
  const currentProgress = state.levels[state.levelIndex]?.progress ?? state.levelProgress;
  const stars = state.arcadeResult?.stars ?? currentProgress.stars;
  const starsGained = state.resultMeta?.starsGained ?? 0;
  const unlockedDistricts = state.levels.filter((level) => !level.locked).length;
  const nextDistrict = state.levels[state.levelIndex + 1];
  const nextStar = nextStarGap(state, score);
  const unlockLine = progressionUnlockLine(state, currentProgress.stars, nextDistrict);
  const starLine =
    stars >= 3
      ? "Three-star district secured"
      : nextStar > 0
        ? `${formatScoreNumber(nextStar)} Mayhem to improve`
        : "Next star target cleared";
  return `
    <div class="hud__progression-card" data-role="progression-summary">
      <div class="hud__progression-head">
        <span>Progression</span>
        <strong>${state.totalStars}/${state.levelCount * 3} campaign stars</strong>
      </div>
      <div class="hud__progression-grid">
        <div>
          <span>This district</span>
          <strong>${stars}/3 stars${starsGained > 0 ? ` / +${starsGained}` : ""}</strong>
        </div>
        <div>
          <span>Gate state</span>
          <strong>${escapeHtml(unlockLine)}</strong>
        </div>
        <div>
          <span>Open districts</span>
          <strong>${unlockedDistricts}/${state.levelCount}</strong>
        </div>
        <div>
          <span>Next chase</span>
          <strong>${escapeHtml(starLine)}</strong>
        </div>
      </div>
    </div>
  `;
}

function progressionUnlockLine(state: UIState, currentStars: number, nextDistrict: UILevelOption | undefined): string {
  if (state.resultMeta?.justUnlockedPayloadName) {
    return `New payload unlocked: ${state.resultMeta.justUnlockedPayloadName}`;
  }
  if (state.resultMeta?.justUnlockedLevelName) {
    return `Unlocked ${state.resultMeta.justUnlockedLevelName}`;
  }
  if (!nextDistrict) {
    return "Final district reached";
  }
  if (!nextDistrict.locked) {
    return `${nextDistrict.name} ready`;
  }
  const missing = Math.max(0, 2 - currentStars);
  return `${missing} more ${missing === 1 ? "star" : "stars"} for ${nextDistrict.name}`;
}

function renderShareCard(state: UIState, score: ScoreBreakdown): string {
  const feedback = state.runFeedback;
  const shareText = state.resultMeta?.dailyResult?.shareText ?? resultShareText(state, score);
  const replayMoment = feedback?.replayMoment;
  const topSource = feedback?.topSources[0];
  return `
    <div class="hud__share-card" data-role="share-card">
      <div class="hud__share-head">
        <span>Share Card</span>
        <strong>${escapeHtml(state.levelName)} / ${state.arcadeResult?.stars ?? 0}/3</strong>
      </div>
      <code data-role="result-share">${escapeHtml(shareText)}</code>
      <div class="hud__replay-grid" data-role="replay-summary">
        <div>
          <span>Replay Summary</span>
          <strong>${escapeHtml(score.shotName)}</strong>
        </div>
        <div>
          <span>Best moment</span>
          <strong>${replayMoment ? `${escapeHtml(replayMoment.label)} / ${formatScoreNumber(replayMoment.points)}` : "No signature moment yet"}</strong>
        </div>
        <div>
          <span>Best source</span>
          <strong>${topSource ? `${escapeHtml(topSource.label)} / ${formatScoreNumber(topSource.points)}` : "No dominant source"}</strong>
        </div>
        <div>
          <span>Best combo</span>
          <strong>${score.maxChainCombo > 1 ? `x${formatScoreNumber(score.maxChainCombo)} chain` : "No combo chain"}</strong>
        </div>
      </div>
      ${renderReplayTimeline(feedback)}
    </div>
  `;
}

function renderReplayTimeline(feedback: RunFeedback | null): string {
  const timeline = feedback?.replayTimeline.slice(0, 4) ?? [];
  if (timeline.length === 0) {
    return "";
  }
  return `
    <div class="hud__replay-timeline" data-role="replay-timeline" aria-label="Replay timeline">
      ${timeline
        .map(
          (moment, index) => `
            <button type="button" data-action="replay-focus" data-replay-index="${index}" aria-label="Focus replay moment ${escapeHtml(moment.label)}">
              <span>${escapeHtml(replayKindLabel(moment.kind))}</span>
              <strong>${escapeHtml(moment.label)}</strong>
              <em>${formatScoreNumber(moment.points)}</em>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function replayKindLabel(kind: RunFeedback["replayTimeline"][number]["kind"]): string {
  switch (kind) {
    case "impact":
      return "Impact";
    case "boss":
      return "Boss break";
    case "ignition":
      return "Ignition Chain";
    case "chain":
      return "Chain";
    case "source":
      return "Best source";
  }
}

function resultShareText(state: UIState, score: ScoreBreakdown): string {
  const stars = state.arcadeResult?.stars ?? 0;
  const replay = state.runFeedback?.replayMoment;
  const contract = contractShareLine(state.arcadeResult?.contract ?? null);
  return [
    `Downtown Mayhem ${state.levelName}`,
    `${stars}/3 stars`,
    `${formatScoreNumber(score.totalScore)} Mayhem`,
    score.shotName,
    replay ? `${replay.label} ${formatScoreNumber(replay.points)}` : null,
    contract
  ]
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}

function contractShareLine(contract: ArcadeResult["contract"]): string | null {
  if (!contract || contract.objectives.length === 0) {
    return null;
  }
  const completed = contract.objectives.filter((objective) => objective.completed).length;
  return contract.completed ? "contract complete" : `contract ${completed}/${contract.objectives.length}`;
}

function resultPanelLabel(state: UIState): string {
  const score = state.score;
  const result = state.arcadeResult;
  if (!score) {
    return "Run result";
  }
  const stars = result?.stars ?? 0;
  const status = result?.completed ? (stars >= 3 ? "three star result" : "district complete") : "needs two stars";
  return `${state.levelName} ${status}, ${stars} stars, ${formatScoreNumber(score.totalScore)} Mayhem Score.`;
}

function resultStateKey(state: UIState): string {
  const stars = state.arcadeResult?.stars ?? 0;
  if (stars >= 3) {
    return "three-star";
  }
  if (state.arcadeResult?.completed) {
    return "complete";
  }
  if (stars >= 1) {
    return "one-star";
  }
  return "incomplete";
}

function districtMayhemRating(state: UIState, score: ScoreBreakdown): string {
  const result = state.arcadeResult;
  if ((result?.stars ?? 0) >= 3) {
    return "MAXIMUM MAYHEM";
  }
  if (result?.completed) {
    return "DISTRICT WRECKER";
  }
  if (score.totalScore >= state.mission.scoreThresholds.oneStar) {
    return "SPARK SHOW";
  }
  return "SPARK SHOW";
}

function resultCallouts(state: UIState, score: ScoreBreakdown): Array<{ className: string; label: string; value: string }> {
  const callouts: Array<{ className: string; label: string; value: string }> = [];
  const meta = state.resultMeta;
  if (meta?.newBest) {
    callouts.push({
      className: "is-new-best",
      label: "New best",
      value: `${formatScoreNumber(meta.previousBestScore)} -> ${formatScoreNumber(score.totalScore)}`
    });
  }
  if (meta && meta.starsGained > 0) {
    callouts.push({
      className: "is-stars-gained",
      label: "Stars gained",
      value: `+${meta.starsGained}`
    });
  }
  if (meta?.dailyResult) {
    callouts.push({
      className: meta.dailyResult.newBest ? "is-daily-best" : "is-daily",
      label: meta.dailyResult.newBest ? "Daily best" : "Daily run",
      value: `${formatScoreNumber(meta.dailyResult.bestScore)} / ${meta.dailyResult.bestStars}/3`
    });
  }
  if (meta?.justUnlockedLevelName) {
    callouts.push({
      className: "is-unlock",
      label: "Unlocked",
      value: meta.justUnlockedLevelName
    });
  }
  if (meta?.justUnlockedPayloadName) {
    callouts.push({
      className: "is-unlock",
      label: "New payload unlocked",
      value: meta.justUnlockedPayloadName
    });
  }
  if (state.arcadeResult?.bonusCompleted) {
    callouts.push({
      className: "is-bonus-complete",
      label: "Bonus goal",
      value: "Complete"
    });
  }
  if (state.arcadeResult?.contract) {
    const completed = state.arcadeResult.contract.objectives.filter((objective) => objective.completed).length;
    const total = state.arcadeResult.contract.objectives.length;
    callouts.push({
      className: state.arcadeResult.contract.completed ? "is-contract-complete" : "is-contract-missed",
      label: "Run contract",
      value: state.arcadeResult.contract.completed ? "Complete" : `${completed}/${total}`
    });
  }
  if (score.bossBreakCount > 0) {
    callouts.push({
      className: "is-boss-break",
      label: "Boss breaks",
      value: String(score.bossBreakCount)
    });
  }
  if (score.weakPointBreakCount > 0) {
    callouts.push({
      className: "is-weakpoint-break",
      label: "Weak points",
      value: String(score.weakPointBreakCount)
    });
  }
  if (score.chainReactionCount >= 20) {
    callouts.push({
      className: "is-chain-combo",
      label: "Secondary hits",
      value: formatScoreNumber(score.chainReactionCount)
    });
  }
  return callouts;
}

function renderResultCallout(callout: { className: string; label: string; value: string }): string {
  return `<div class="${callout.className}"><span>${escapeHtml(callout.label)}</span><strong>${escapeHtml(callout.value)}</strong></div>`;
}

function renderRunCoach(feedback: RunFeedback): string {
  const topSources = feedback.topSources.slice(0, 3);
  const nearMisses = feedback.nearMisses.slice(0, 3);
  const recipe = retryRecipe(feedback, topSources, nearMisses);
  const actionSteps = coachActionSteps(feedback, topSources, nearMisses);
  return `
    <div class="hud__run-coach" data-role="run-coach" aria-label="Run Coach retry recipe">
      <div class="hud__run-coach-head">
        <span>Run Coach</span>
        <strong>${escapeHtml(feedback.variant.label)}</strong>
      </div>
      <div class="hud__coach-steps" aria-label="Next run plan">
        <span>Next run plan</span>
        ${actionSteps
          .map(
            (step, index) => `
              <div class="hud__coach-step">
                <em>${index + 1}</em>
                <span>${escapeHtml(step.label)}</span>
                <strong>${escapeHtml(step.value)}</strong>
              </div>
            `
          )
          .join("")}
      </div>
      <div class="hud__run-coach-grid">
        <div class="hud__run-coach-recipe">
          <span>Retry recipe</span>
          <strong>${escapeHtml(recipe)}</strong>
        </div>
        <div>
          <span>Best sources</span>
          <strong>${topSources.length > 0 ? escapeHtml(topSources.map((source) => `${source.label} ${formatScoreNumber(source.points)}`).join(" / ")) : "No strong source"}</strong>
        </div>
        <div>
          <span>Retry target</span>
          <strong>${escapeHtml(nearMisses[0] ?? feedback.projectileObjective?.label ?? feedback.variant.description)}</strong>
        </div>
        <div>
          <span>Replay moment</span>
          <strong>${feedback.replayMoment ? `${escapeHtml(feedback.replayMoment.label)} / ${formatScoreNumber(feedback.replayMoment.points)}` : "No signature moment yet"}</strong>
        </div>
      </div>
    </div>
  `;
}

function coachActionSteps(
  feedback: RunFeedback,
  topSources: readonly { label: string; points: number }[],
  nearMisses: readonly string[]
): Array<{ label: string; value: string }> {
  const missedContract = feedback.contractResult?.objectives.find((objective) => !objective.completed);
  const opener = cleanCoachHint(nearMisses[0] ?? feedback.projectileObjective?.label ?? feedback.variant.description);
  const amplifier = topSources[0]
    ? `Repeat ${topSources[0].label} for ${formatScoreNumber(topSources[0].points)}+ points.`
    : feedback.replayMoment
      ? `Recreate ${feedback.replayMoment.label} before debris settles.`
      : "Create one clear target break before chasing side hits.";
  const closer = missedContract
    ? `${missedContract.label}: ${formatContractValue(missedContract.value)} / ${formatContractValue(missedContract.target)}.`
    : feedback.replayMoment
      ? `Bank the run after ${feedback.replayMoment.label} resolves.`
      : (feedback.contract?.summary ?? "Bank the run once Score Now appears.");
  return [
    { label: "Open", value: opener },
    { label: "Amplify", value: amplifier },
    { label: "Lock", value: closer }
  ];
}

function cleanCoachHint(value: string): string {
  return value
    .replace(/^Retry route:\s*/i, "")
    .replace(/^Aim plan:\s*/i, "")
    .replace(/^Bonus route:\s*/i, "")
    .replace(/^Contract route:\s*/i, "");
}

function retryRecipe(
  feedback: RunFeedback,
  topSources: readonly { label: string; points: number }[],
  nearMisses: readonly string[]
): string {
  const firstTarget = nearMisses[0] ?? feedback.projectileObjective?.label ?? feedback.contract?.summary ?? feedback.variant.description;
  const source = topSources[0]?.label;
  const replay = feedback.replayMoment?.label;
  const parts = [`Open with ${firstTarget}`];
  if (source) {
    parts.push(`repeat the ${source} angle`);
  }
  if (replay) {
    parts.push(`protect the ${replay} moment`);
  }
  return `${parts.join("; ")}.`;
}

function renderDailyResultSummary(result: DailyResultMeta): string {
  const bestLabel = result.newBest
    ? `New daily best from ${formatScoreNumber(result.previousBestScore)}`
    : `Daily best ${formatScoreNumber(result.bestScore)}`;
  return `
    <div class="hud__daily-result" data-role="daily-result">
      <div class="hud__daily-result-head">
        <span>Daily Contract</span>
        <strong>${escapeHtml(bestLabel)}</strong>
      </div>
      <div class="hud__daily-result-grid">
        <div>
          <span>Attempts</span>
          <strong>${formatScoreNumber(result.attempts)}</strong>
        </div>
        <div>
          <span>Best stars</span>
          <strong>${result.bestStars}/3</strong>
        </div>
        <div>
          <span>Contract</span>
          <strong>${result.contractCompleted ? "Complete" : "Missed"}</strong>
        </div>
      </div>
      <code data-role="daily-share">${escapeHtml(result.shareText)}</code>
      <small>Replay today from the Daily Contract card in the menu.</small>
    </div>
  `;
}

function renderContractObjectives(completed: boolean, objectives: readonly ArcadeContractObjectiveResult[]): string {
  const completedCount = objectives.filter((objective) => objective.completed).length;
  return `
    <div class="hud__contract-list" aria-label="Run contract objectives">
      <div class="hud__contract-head">
        <span>Run Contract</span>
        <strong>${completed ? "Complete" : `${completedCount}/${objectives.length}`}</strong>
      </div>
      ${objectives.map(renderContractObjective).join("")}
    </div>
  `;
}

function liveMasteryText(mastery: UILiveMastery): string {
  const contractState = mastery.contractCompleted ? "done" : `${Math.round(mastery.contractProgress * 100)}%`;
  const signals = mastery.signals.length > 0 ? ` / ${mastery.signals.join(" / ")}` : "";
  return `${mastery.bonusLabel}: ${mastery.bonusValue} / ${mastery.contractLabel}: ${mastery.contractValue} (${contractState})${signals}`;
}

function renderContractObjective(objective: ArcadeContractObjectiveResult): string {
  return `
    <div class="hud__contract-objective ${objective.completed ? "is-passed" : "is-missed"}">
      <span>${escapeHtml(objective.label)}</span>
      <strong>${escapeHtml(formatContractValue(objective.value))} / ${escapeHtml(formatContractValue(objective.target))}</strong>
    </div>
  `;
}

function formatContractValue(value: number | string): string {
  return typeof value === "number" ? formatScoreNumber(value) : value;
}

function renderDamageHotspot(hotspot: ScoreBreakdown["damageHotspots"][number]): string {
  return `
    <div class="hud__damage-hotspot">
      <span>
        <strong>${escapeHtml(hotspot.label)}</strong>
        <em>${escapeHtml(damageHotspotDetail(hotspot))}</em>
      </span>
      <b>${formatScoreNumber(hotspot.points)}</b>
    </div>
  `;
}

function damageHotspotDetail(hotspot: ScoreBreakdown["damageHotspots"][number]): string {
  const parts = [];
  if (hotspot.targetDamage > 0) {
    parts.push(`${formatScoreNumber(hotspot.targetDamage)} object`);
  }
  if (hotspot.collateralDamage > 0) {
    parts.push(`${formatScoreNumber(hotspot.collateralDamage)} chaos`);
  }
  parts.push(`${formatScoreNumber(hotspot.hits)} ${hotspot.hits === 1 ? "hit" : "hits"}`);
  return parts.join(" / ");
}

function bestScoreLabel(state: UIState): string {
  const previous = state.resultMeta?.previousBestScore ?? state.levelProgress.bestScore;
  const current = state.levelProgress.bestScore;
  if (state.resultMeta?.newBest) {
    return `Previous best ${formatScoreNumber(previous)}`;
  }
  return `Best ${formatScoreNumber(current)}`;
}

function primaryResultAction(state: UIState): "next" | "retry" {
  if (state.arcadeResult?.completed && canStartNextDistrict(state)) {
    return "next";
  }
  return "retry";
}

function canStartNextDistrict(state: UIState): boolean {
  const next = state.levels[state.levelIndex + 1];
  return Boolean(next && !next.locked);
}

function bonusGoalHint(state: UIState, score: ScoreBreakdown): string {
  const metric = state.mission.bonusThreshold.metric;
  const value = bonusMetricValue(score, metric);
  const minimum = state.mission.bonusThreshold.minimum;
  if (value >= minimum) {
    return "Bonus goal complete";
  }
  return `Need ${formatScoreNumber(minimum - value)} more ${metricUnit(metric)}`;
}

function nextStarGap(state: UIState, score: ScoreBreakdown): number {
  const thresholds = [
    state.mission.scoreThresholds.oneStar,
    state.mission.scoreThresholds.twoStar,
    state.mission.scoreThresholds.threeStar
  ];
  const target = thresholds.find((threshold) => score.totalScore < threshold);
  return target ? Math.max(0, target - score.totalScore) : 0;
}

function fireButtonLabel(_state: UIState): string {
  return "FIRE";
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

function metricUnit(metric: ArcadeMissionFields["bonusThreshold"]["metric"]): string {
  switch (metric) {
    case "targetDamage":
      return "object damage";
    case "collateralChaos":
      return "collateral chaos";
    case "chainReactionBonus":
      return "chain score";
    case "remainingDebrisMotion":
      return "motion score";
    case "chainReactionCount":
      return "secondary hits";
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

function districtMasteryText(progress: ArcadeLevelProgress): string {
  const projectile = progress.bestProjectileId ? PROJECTILES[progress.bestProjectileId].shortName : "No payload best";
  const combo = progress.bestCombo > 0 ? `x${formatScoreNumber(progress.bestCombo)} combo` : "no combo best";
  const badge = progress.threeStarCleared ? "3-star badge" : "3-star badge open";
  return `District Mastery: ${badge} / ${projectile} / ${combo}`;
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
      cursor: default;
      touch-action: none;
    }

    canvas.is-cannon-aim {
      cursor: crosshair;
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

    .hud__telemetry > span,
    .hud__telemetry > button {
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

    .hud__menu-button {
      justify-content: center;
      gap: 8px;
    }

    .hud__menu-icon {
      position: relative;
      display: none;
      width: 20px;
      height: 16px;
      color: #d9fbff;
    }

    .hud__menu-icon::before,
    .hud__menu-icon::after,
    .hud__menu-icon i {
      content: "";
      position: absolute;
      left: 0;
      width: 100%;
      height: 3px;
      border-radius: 999px;
      background: #d9fbff;
      box-shadow: 0 0 12px rgba(189, 248, 255, 0.32);
    }

    .hud__menu-icon::before {
      top: 0;
    }

    .hud__menu-icon i {
      top: 6.5px;
    }

    .hud__menu-icon::after {
      bottom: 0;
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
    .hud__mission > em,
    .hud__mission > small {
      color: #c3d5df;
      font-size: 12px;
      font-style: normal;
      line-height: 1.32;
    }

    .hud__mission > em {
      color: #8ddfff;
    }

    .hud__mission > small {
      color: #ffd36d;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
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
    .hud__result-actions button.is-primary {
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

    .hud__live-score {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 5px 12px;
      align-items: end;
      min-height: 58px;
      padding: 10px;
      border: 1px solid rgba(121, 240, 255, 0.26);
      border-radius: 7px;
      background:
        linear-gradient(90deg, rgba(121, 240, 255, 0.13), rgba(255, 207, 105, 0.1)),
        rgba(7, 11, 17, 0.76);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    .hud__live-score span {
      color: #9db6c4;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__live-score strong {
      color: #96f4ff;
      font-size: 25px;
      line-height: 0.95;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 0 18px rgba(121, 240, 255, 0.22);
    }

    .hud__live-score div {
      grid-column: 1 / -1;
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
    }

    .hud__live-score i {
      display: block;
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #72f0a5, #79f0ff, #ffd36d);
      box-shadow: 0 0 16px rgba(121, 240, 255, 0.45);
      transition: width 140ms ease-out;
    }

    .hud__live-score small {
      grid-column: 1 / -1;
      min-width: 0;
      overflow: hidden;
      color: #c9f8ff;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__live-score.is-surging strong {
      animation: liveScoreSurge 280ms ease-out both;
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
      animation: resultPanelIn 180ms ease-out both;
    }

    .hud__results.is-ceremony-enter {
      animation: resultPanelIn 220ms ease-out both, resultPanelGlow 980ms ease-out both;
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

    .hud__result-head em {
      color: #9db6c4;
      font-size: 11px;
      font-style: normal;
      line-height: 1.2;
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
      animation: starPop 360ms ease-out both;
    }

    .hud__stars span.is-earned:nth-child(2) {
      animation-delay: 110ms;
    }

    .hud__stars span.is-earned:nth-child(3) {
      animation-delay: 220ms;
    }

    .hud__result-ceremony {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid rgba(255, 139, 86, 0.3);
      border-radius: 7px;
      background: linear-gradient(180deg, rgba(255, 139, 86, 0.16), rgba(121, 240, 255, 0.08));
    }

    .hud__result-ceremony div:first-child {
      display: grid;
      gap: 3px;
    }

    .hud__result-ceremony span,
    .hud__progression-head span,
    .hud__progression-grid span,
    .hud__share-head span,
    .hud__replay-grid span,
    .hud__coach-steps > span,
    .hud__coach-step span {
      color: #9db6c4;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__result-ceremony strong {
      color: #fff0b8;
      font-size: 34px;
      line-height: 0.9;
      letter-spacing: 0;
    }

    .hud__result-ceremony em {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #ffffff;
      font-size: 12px;
      font-style: normal;
      font-weight: 800;
      line-height: 1.25;
    }

    .hud__result-ceremony-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .hud__result-ceremony-stats span {
      min-width: 0;
      padding: 6px;
      border-radius: 6px;
      color: #ffffff;
      background: rgba(0, 0, 0, 0.18);
      overflow-wrap: anywhere;
      text-transform: none;
    }

    .hud__result-callouts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
      gap: 7px;
    }

    .hud__result-callouts div {
      min-width: 0;
      padding: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.06);
    }

    .hud__result-callouts .is-new-best {
      border-color: rgba(255, 226, 126, 0.62);
      background: rgba(255, 202, 76, 0.12);
    }

    .hud__result-callouts .is-unlock {
      border-color: rgba(114, 240, 165, 0.58);
      background: rgba(114, 240, 165, 0.1);
    }

    .hud__result-callouts .is-contract-complete {
      border-color: rgba(114, 240, 165, 0.58);
      background: rgba(114, 240, 165, 0.1);
    }

    .hud__result-callouts .is-daily,
    .hud__result-callouts .is-daily-best {
      border-color: rgba(255, 226, 126, 0.62);
      background: rgba(255, 202, 76, 0.12);
    }

    .hud__result-callouts .is-contract-missed {
      border-color: rgba(255, 124, 159, 0.54);
      background: rgba(255, 124, 159, 0.1);
    }

    .hud__result-callouts .is-boss-break {
      border-color: rgba(255, 112, 88, 0.62);
      background: rgba(255, 92, 64, 0.12);
    }

    .hud__result-callouts .is-weakpoint-break,
    .hud__result-callouts .is-chain-combo {
      border-color: rgba(120, 234, 255, 0.54);
      background: rgba(88, 208, 255, 0.1);
    }

    .hud__result-callouts span,
    .hud__result-callouts strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__result-callouts span {
      color: #9db6c4;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__result-callouts strong {
      margin-top: 3px;
      color: #ffffff;
      font-size: 12px;
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
      animation: scorePulse 720ms ease-out both;
    }

    .hud__total em {
      color: #b5c6cf;
      font-size: 11px;
      font-style: normal;
    }

    .hud__daily-result,
    .hud__progression-card,
    .hud__share-card,
    .hud__run-coach,
    .hud__objective-list,
    .hud__contract-list,
    .hud__score-breakdown,
    .hud__damage-hotspots {
      display: grid;
      gap: 6px;
    }

    .hud__daily-result-head,
    .hud__progression-head,
    .hud__share-head,
    .hud__daily-result-grid div,
    .hud__progression-grid div,
    .hud__replay-grid div,
    .hud__run-coach-head,
    .hud__run-coach-grid div,
    .hud__objective-list div,
    .hud__contract-head,
    .hud__contract-objective,
    .hud__score-breakdown div,
    .hud__damage-hotspot,
    .hud__damage-hotspots-head,
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
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: flex-start;
      border-left: 3px solid #ff7c9f;
    }

    .hud__run-coach {
      padding: 8px;
      border: 1px solid rgba(121, 240, 255, 0.18);
      border-radius: 7px;
      background: rgba(121, 240, 255, 0.055);
    }

    .hud__progression-card {
      padding: 8px;
      border: 1px solid rgba(114, 240, 165, 0.18);
      border-radius: 7px;
      background: rgba(114, 240, 165, 0.055);
    }

    .hud__share-card {
      padding: 8px;
      border: 1px solid rgba(255, 207, 105, 0.2);
      border-radius: 7px;
      background: rgba(255, 207, 105, 0.055);
    }

    .hud__replay-timeline {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .hud__replay-timeline button {
      display: grid;
      gap: 3px;
      min-height: 56px;
      padding: 7px 8px;
      border: 1px solid rgba(255, 207, 105, 0.24);
      border-radius: 6px;
      color: #f8fdff;
      background: rgba(255, 255, 255, 0.06);
      text-align: left;
      cursor: pointer;
    }

    .hud__replay-timeline button:hover,
    .hud__replay-timeline button:focus-visible {
      border-color: rgba(255, 224, 139, 0.82);
      background: rgba(255, 207, 105, 0.13);
      outline: none;
    }

    .hud__replay-timeline span,
    .hud__replay-timeline em {
      color: #9db6c4;
      font-size: 10px;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__replay-timeline strong {
      overflow: hidden;
      color: #ffffff;
      font-size: 12px;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__daily-result {
      padding: 8px;
      border: 1px solid rgba(255, 207, 105, 0.22);
      border-radius: 7px;
      background: rgba(255, 207, 105, 0.07);
    }

    .hud__daily-result-head {
      min-height: 28px;
      background: rgba(255, 207, 105, 0.1);
    }

    .hud__progression-head {
      min-height: 28px;
      background: rgba(114, 240, 165, 0.08);
    }

    .hud__share-head {
      min-height: 28px;
      background: rgba(255, 207, 105, 0.08);
    }

    .hud__run-coach-head {
      min-height: 28px;
      background: rgba(121, 240, 255, 0.08);
    }

    .hud__daily-result-head span,
    .hud__daily-result-grid span,
    .hud__run-coach-head span,
    .hud__run-coach-grid span {
      color: #9db6c4;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__daily-result-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .hud__progression-grid,
    .hud__replay-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .hud__run-coach-grid {
      display: grid;
      gap: 6px;
    }

    .hud__daily-result-grid div,
    .hud__progression-grid div,
    .hud__replay-grid div {
      display: grid;
      align-content: start;
      gap: 2px;
    }

    .hud__run-coach-grid div {
      display: grid;
      grid-template-columns: 0.38fr minmax(0, 1fr);
      align-items: start;
    }

    .hud__daily-result strong,
    .hud__progression-card strong,
    .hud__share-card strong,
    .hud__run-coach strong {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #ffffff;
      font-size: 12px;
      line-height: 1.25;
    }

    .hud__daily-result code,
    .hud__share-card code {
      display: block;
      min-width: 0;
      padding: 7px 8px;
      border-radius: 6px;
      color: #ffe08b;
      background: rgba(0, 0, 0, 0.22);
      font: 800 11px/1.35 var(--hud-font);
      white-space: normal;
      overflow-wrap: anywhere;
      user-select: text;
    }

    .hud__coach-steps {
      display: grid;
      gap: 6px;
      padding: 7px;
      border-radius: 6px;
      background: rgba(121, 240, 255, 0.05);
    }

    .hud__coach-step {
      display: grid;
      grid-template-columns: 24px 0.34fr minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      min-width: 0;
    }

    .hud__coach-step em {
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: #061419;
      background: #79f0ff;
      font-size: 11px;
      font-style: normal;
      font-weight: 900;
    }

    .hud__coach-step strong {
      font-size: 11px;
    }

    .hud__daily-result small {
      color: #ffe08b;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.3;
    }

    .hud__contract-head {
      min-height: 28px;
      border: 1px solid rgba(255, 207, 105, 0.22);
      background: rgba(255, 207, 105, 0.08);
    }

    .hud__contract-head span {
      color: #ffcf69;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__contract-objective {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: flex-start;
      border-left: 3px solid #ff7c9f;
    }

    .hud__objective-list span,
    .hud__contract-objective span {
      min-width: 0;
      white-space: normal;
    }

    .hud__objective-list em {
      grid-column: 1 / -1;
      color: #9db6c4;
      font-size: 10px;
      font-style: normal;
      line-height: 1.2;
    }

    .hud__objective-list div.is-passed,
    .hud__contract-objective.is-passed {
      border-left-color: #72f0a5;
    }

    .hud__objective-list strong,
    .hud__contract-head strong,
    .hud__contract-objective strong,
    .hud__score-breakdown strong,
    .hud__damage-hotspots-head strong,
    .hud__damage-hotspot b,
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

    .hud__damage-hotspots {
      padding-top: 2px;
    }

    .hud__damage-hotspots-head {
      min-height: 28px;
      border: 1px solid rgba(121, 240, 255, 0.16);
      background: rgba(121, 240, 255, 0.07);
    }

    .hud__damage-hotspots-head span {
      color: #ffcf69;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .hud__damage-hotspot {
      align-items: flex-start;
      border-left: 3px solid rgba(121, 240, 255, 0.56);
    }

    .hud__damage-hotspot span {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .hud__damage-hotspot span strong {
      overflow: hidden;
      color: #ffffff;
      font-size: 12px;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__damage-hotspot span em {
      overflow: hidden;
      color: #9db6c4;
      font-size: 10px;
      font-style: normal;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__damage-hotspot b {
      color: #96f4ff;
      font-variant-numeric: tabular-nums;
    }

    @keyframes resultPanelIn {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes resultPanelGlow {
      0% {
        box-shadow: 0 18px 58px rgba(0, 0, 0, 0.5), 0 0 0 rgba(255, 211, 109, 0);
      }
      30% {
        box-shadow: 0 18px 58px rgba(0, 0, 0, 0.5), 0 0 34px rgba(255, 211, 109, 0.24);
      }
      100% {
        box-shadow: 0 18px 58px rgba(0, 0, 0, 0.5), 0 0 0 rgba(255, 211, 109, 0);
      }
    }

    @keyframes starPop {
      0% {
        transform: scale(0.78);
        filter: brightness(0.85);
      }
      65% {
        transform: scale(1.12);
        filter: brightness(1.18);
      }
      100% {
        transform: scale(1);
        filter: brightness(1);
      }
    }

    @keyframes scorePulse {
      0% {
        transform: scale(0.96);
      }
      55% {
        transform: scale(1.035);
      }
      100% {
        transform: scale(1);
      }
    }

    @keyframes liveScoreSurge {
      0% {
        transform: translateY(1px) scale(0.98);
        filter: brightness(0.92);
      }
      62% {
        transform: translateY(-1px) scale(1.045);
        filter: brightness(1.2);
      }
      100% {
        transform: translateY(0) scale(1);
        filter: brightness(1);
      }
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
    .hud__level-card em,
    .hud__level-card small {
      overflow: hidden;
      color: #9db6c4;
      font-size: 10px;
      font-style: normal;
      font-weight: 900;
      text-overflow: ellipsis;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .hud__level-card em,
    .hud__level-card small {
      display: block;
      line-height: 1.25;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .hud__level-card strong {
      overflow: hidden;
      color: #ffffff;
      font-size: 15px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__level-card small {
      color: #8ddfff;
      font-weight: 800;
      text-transform: none;
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
      min-height: 44px;
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
      width: 28px;
      height: 28px;
      min-width: 28px;
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

      .hud__telemetry > span:nth-child(2) {
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

      .hud__telemetry > span,
      .hud__telemetry > button {
        min-height: 44px;
        padding: 0 9px;
        font-size: 12px;
      }

      .hud.is-post-shot[data-screen="play"] .hud__brand-mark,
      .hud.is-post-shot[data-screen="play"] .hud__brand strong,
      .hud.is-post-shot[data-screen="play"] .hud__telemetry > span {
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
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        font-size: 12px;
        line-height: 1.05;
      }

      .hud__projectile small {
        display: none;
      }

      .hud__fire {
        min-height: 50px;
        font-size: 16px;
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
        min-height: 44px;
        font-size: 12px;
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
        min-height: 44px;
        font-size: 12px;
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

    @media (max-width: 920px) {
      .hud[data-screen="play"]::before {
        opacity: 0.18;
      }

      .hud__topbar {
        left: var(--hud-safe-left-mobile);
        right: var(--hud-safe-right-mobile);
        top: var(--hud-safe-top-mobile);
        gap: 6px;
        min-height: 40px;
        padding: 0 4px;
        border-color: rgba(183, 232, 255, 0.12);
        background: rgba(6, 10, 15, 0.5);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
        backdrop-filter: blur(10px);
      }

      .hud__brand {
        gap: 0;
      }

      .hud__brand-mark {
        width: 30px;
        height: 30px;
        font-size: 10px;
      }

      .hud__brand strong,
      .hud__brand span,
      .hud__telemetry > span {
        display: none;
      }

      .hud__telemetry {
        gap: 5px;
      }

      .hud__telemetry button {
        min-width: 50px;
        min-height: 44px;
        padding: 0 9px;
        font-size: 10px;
      }

      .hud[data-screen="play"] .hud__topbar {
        left: auto;
        right: var(--hud-safe-right-mobile);
        width: auto;
        min-height: 48px;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
        backdrop-filter: none;
      }

      .hud[data-screen="play"] .hud__brand,
      .hud[data-screen="play"] .hud__telemetry > span {
        display: none;
      }

      .hud[data-screen="play"] .hud__telemetry {
        gap: 0;
      }

      .hud[data-screen="play"] .hud__menu-button {
        width: 48px;
        min-width: 48px;
        height: 48px;
        min-height: 48px;
        padding: 0;
        border-color: rgba(189, 248, 255, 0.24);
        border-radius: 8px;
        color: #d9fbff;
        background: rgba(5, 9, 14, 0.58);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(12px);
      }

      .hud[data-screen="play"] .hud__menu-button:active {
        transform: translateY(1px);
      }

      .hud[data-screen="play"] .hud__menu-icon {
        display: block;
      }

      .hud[data-screen="play"] .hud__menu-label {
        display: none;
      }

      .hud__command {
        left: var(--hud-safe-left-mobile);
        right: var(--hud-safe-right-mobile);
        bottom: var(--hud-safe-bottom-mobile);
        width: auto;
        max-height: none;
        overflow: visible;
        gap: 6px;
        padding: 8px;
        border-color: rgba(183, 232, 255, 0.13);
        background: rgba(7, 11, 17, 0.68);
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.34);
        backdrop-filter: blur(12px);
      }

      .hud__mission {
        display: grid;
        gap: 2px;
      }

      .hud__mission > strong {
        font-size: 13px;
      }

      .hud__mission-kicker,
      .hud__mission > span,
      .hud__goal-grid,
      .hud__loadout-head,
      .hud__projectile small,
      .hud__finish-hint,
      .hud__status {
        display: none;
      }

      .hud[data-screen="play"] .hud__mission > em {
        display: block;
        overflow: hidden;
        color: #9deeff;
        font-size: 11px;
        line-height: 1.18;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hud__projectiles {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 5px;
      }

      .hud__projectile {
        min-height: 44px;
        padding: 3px;
      }

      .hud__projectile span {
        font-size: 12px;
        line-height: 1;
      }

      .hud__fire {
        min-height: 52px;
        font-size: 16px;
      }

      .hud.has-shot-available[data-screen="play"] .hud__utility {
        display: none;
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
        min-height: 64px;
        padding: 10px 12px;
      }

      .hud__turn-prompt strong {
        font-size: 18px;
      }

      .hud__turn-prompt span,
      .hud__turn-prompt em {
        font-size: 10px;
      }

      .hud__results {
        left: var(--hud-safe-left-mobile);
        right: var(--hud-safe-right-mobile);
        bottom: var(--hud-safe-bottom-mobile);
        width: auto;
        max-height: min(78svh, 640px);
        padding: 10px;
      }

    }

    @media (max-width: 520px) and (orientation: portrait) {
      .hud__command {
        gap: 5px;
      }

      .hud__fire {
        min-height: 54px;
      }
    }

    @media (max-width: 920px) and (max-height: 520px) and (orientation: landscape) {
      .hud__topbar {
        min-height: 38px;
      }

      .hud__command {
        display: grid;
        grid-template-columns: minmax(104px, 0.7fr) minmax(230px, 1.5fr) minmax(104px, 0.7fr);
        align-items: stretch;
        gap: 6px;
        padding: 7px;
      }

      .hud__mission {
        align-content: center;
      }

      .hud__projectile {
        min-height: 44px;
      }

      .hud__fire {
        min-height: 44px;
      }

      .hud.is-post-shot[data-screen="play"] .hud__turn-prompt:not([hidden]) {
        min-height: 58px;
      }
    }

  `;
  document.head.appendChild(style);
}

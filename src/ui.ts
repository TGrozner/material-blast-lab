import type { ProjectileDefinition, ProjectileId } from "./projectile";
import { PROJECTILE_ORDER, PROJECTILES } from "./projectile";
import type { ScoreBreakdown } from "./scoring";

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
}

export class GameUI {
  private readonly root: HTMLDivElement;
  private readonly projectileValue: HTMLSpanElement;
  private readonly chamberValue: HTMLSpanElement;
  private readonly powerValue: HTMLSpanElement;
  private readonly sizeValue: HTMLSpanElement;
  private readonly shotsValue: HTMLSpanElement;
  private readonly bodyValue: HTMLSpanElement;
  private readonly fpsValue: HTMLElement;
  private readonly statusValue: HTMLDivElement;
  private readonly fireButton: HTMLButtonElement;
  private readonly scorePanel: HTMLDivElement;
  private readonly projectileButtons = new Map<ProjectileId, HTMLButtonElement>();
  private scoreWasVisible = false;

  constructor(private readonly callbacks: UICallbacks) {
    installStyles();

    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud__title">
        <span>Material Blast Lab</span>
        <small><span>Siege Battery</span><strong data-role="fps"></strong></small>
      </div>
      <div class="hud__mission">
        <strong data-role="chamber"></strong>
        <span data-role="objective"></span>
        <em data-role="protected"></em>
      </div>
      <div class="hud__row"><span>Projectile</span><strong data-role="projectile"></strong></div>
      <div class="hud__row"><span>Shot</span><strong data-role="shots"></strong></div>
      <div class="hud__row"><span>Debris</span><strong data-role="bodies"></strong></div>
      <div class="hud__projectiles" data-role="projectiles"></div>
      <button class="hud__fire" type="button">FIRE</button>
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
      <div class="hud__buttons">
        <button type="button" data-action="level">Rebuild</button>
        <button type="button" data-action="clear">Clear Debris</button>
        <button type="button" data-action="reset">Retry</button>
      </div>
      <div class="hud__status" data-role="status"></div>
      <div class="hud__score" data-role="score"></div>
    `;
    document.body.appendChild(this.root);

    this.projectileValue = this.requireElement("[data-role='projectile']");
    this.chamberValue = this.requireElement("[data-role='chamber']");
    this.powerValue = this.requireElement("[data-role='power']");
    this.sizeValue = this.requireElement("[data-role='size']");
    this.shotsValue = this.requireElement("[data-role='shots']");
    this.bodyValue = this.requireElement("[data-role='bodies']");
    this.fpsValue = this.requireElement("[data-role='fps']");
    this.statusValue = this.requireElement("[data-role='status']");
    this.fireButton = this.requireElement(".hud__fire");
    this.scorePanel = this.requireElement("[data-role='score']");

    const projectileRoot = this.requireElement<HTMLDivElement>("[data-role='projectiles']");
    for (const id of PROJECTILE_ORDER) {
      const definition = PROJECTILES[id];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hud__projectile";
      button.title = `${definition.key}: ${definition.name} - ${definition.description}`;
      button.style.setProperty("--projectile", `#${definition.color.getHexString()}`);
      button.textContent = definition.shortName;
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
  }

  update(state: UIState): void {
    this.projectileValue.textContent = state.projectile.shortName;
    this.projectileValue.title = state.projectile.name;
    this.chamberValue.textContent = state.levelName;
    this.chamberValue.title = state.levelDescription;
    this.requireElement("[data-role='objective']").textContent = state.objective;
    this.requireElement("[data-role='protected']").textContent = state.protectedBrief;
    this.powerValue.textContent = `${Math.round(state.powerScale * 100)}%`;
    this.sizeValue.textContent = `${Math.round(state.sizeScale * 100)}%`;
    this.shotsValue.textContent = state.shotAvailable ? "READY" : "SPENT";
    this.bodyValue.textContent = String(state.bodyCount);
    this.fpsValue.textContent = `${state.fps} FPS`;
    this.statusValue.textContent = state.status;
    this.fireButton.disabled = !state.shotAvailable;

    for (const [id, button] of this.projectileButtons) {
      button.classList.toggle("is-active", id === state.projectileId);
      button.setAttribute("aria-pressed", String(id === state.projectileId));
    }

    if (state.score) {
      const shouldRevealScore = !this.scoreWasVisible;
      this.scorePanel.classList.add("is-visible");
      this.scorePanel.innerHTML = `
        <div class="hud__score-title">${state.score.shotName} - ${state.score.containmentRating}</div>
        <div><span>Target Damage</span><strong>${state.score.targetDamage}</strong></div>
        <div><span>City Chaos</span><strong>${state.score.cityChaos}</strong></div>
        <div><span>Contamination Purge</span><strong>${state.score.contaminationPurge}</strong></div>
        <div><span>Chain Bonus</span><strong>${state.score.chainReactionBonus}</strong></div>
        <div><span>Chain Hits</span><strong>${state.score.chainReactionCount}${state.score.maxChainCombo > 1 ? ` / x${state.score.maxChainCombo}` : ""}</strong></div>
        <div><span>Protected Penalty</span><strong class="is-penalty">-${state.score.protectedPenalty}</strong></div>
        <div><span>Motion Bonus</span><strong>${state.score.remainingDebrisMotion}</strong></div>
        <div class="hud__score-total"><span>Total</span><strong>${state.score.totalScore}</strong></div>
      `;
      this.scoreWasVisible = true;
      if (shouldRevealScore) {
        window.requestAnimationFrame(() => {
          this.root.scrollTo({ top: this.root.scrollHeight, behavior: "smooth" });
        });
      }
    } else {
      this.scoreWasVisible = false;
      this.scorePanel.classList.remove("is-visible");
      this.scorePanel.innerHTML = "";
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing UI element ${selector}`);
    }
    return element;
  }
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
      background: #080b10;
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

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: #080b10;
      cursor: crosshair;
      touch-action: none;
    }

    .hud {
      position: fixed;
      left: 50%;
      bottom: max(12px, env(safe-area-inset-bottom));
      width: min(560px, calc(100vw - 20px));
      max-height: min(56vh, 520px);
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      padding: 12px;
      border: 1px solid rgba(169, 225, 255, 0.18);
      border-radius: 8px;
      background: rgba(8, 12, 18, 0.84);
      box-shadow: 0 14px 42px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(14px);
      transform: translateX(-50%);
      user-select: none;
      z-index: 3;
    }

    .hud__title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .hud__mission {
      display: grid;
      gap: 4px;
      margin-bottom: 9px;
      padding: 9px;
      border: 1px solid rgba(169, 225, 255, 0.12);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.045);
    }

    .hud__mission strong {
      color: #f4f8fb;
      font-size: 13px;
      line-height: 1.1;
    }

    .hud__mission span,
    .hud__mission em {
      color: #a9c4d1;
      font-size: 11px;
      line-height: 1.25;
      font-style: normal;
    }

    .hud__mission em {
      color: #83cfff;
    }

    .hud__title > span {
      font-size: 15px;
      font-weight: 800;
    }

    .hud__title small {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: #8eb0c2;
      font-size: 11px;
      white-space: nowrap;
    }

    .hud__title small strong {
      padding: 2px 6px;
      border: 1px solid rgba(157, 248, 255, 0.22);
      border-radius: 999px;
      color: #9df8ff;
      background: rgba(157, 248, 255, 0.08);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
    }

    .hud__row,
    .hud__score div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 23px;
      color: #9eb5c3;
      font-size: 12px;
      gap: 12px;
    }

    .hud__row strong,
    .hud__score strong {
      min-width: 0;
      max-width: 58%;
      color: #f4f8fb;
      font-size: 13px;
      overflow: hidden;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__projectiles {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 7px;
      margin: 9px 0;
      min-width: 0;
    }

    .hud__projectile {
      min-width: 0;
      width: 100%;
      min-height: 42px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      color: #f8fdff;
      background: linear-gradient(135deg, color-mix(in srgb, var(--projectile), #000 22%), rgba(255, 255, 255, 0.1));
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
      overflow: hidden;
      padding: 0 5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__projectile.is-active {
      outline: 2px solid #bff7ff;
      outline-offset: 2px;
    }

    .hud__steppers {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin-bottom: 8px;
      min-width: 0;
    }

    .hud__stepper {
      display: grid;
      grid-template-columns: minmax(48px, 1fr) 38px minmax(46px, auto) 38px;
      align-items: center;
      gap: 5px;
      min-width: 0;
      padding: 6px;
      border: 1px solid rgba(169, 225, 255, 0.12);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.05);
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
      color: #f4f8fb;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .hud__fire,
    .hud__buttons button,
    .hud__stepper button {
      min-height: 40px;
      border: 1px solid rgba(185, 245, 255, 0.22);
      border-radius: 7px;
      color: #f8fdff;
      background: rgba(255, 255, 255, 0.08);
      font-weight: 800;
      cursor: pointer;
    }

    .hud__fire {
      width: 100%;
      min-height: 48px;
      margin-bottom: 8px;
      color: #071015;
      background: linear-gradient(180deg, #9df8ff, #57d7ff);
      box-shadow: 0 8px 22px rgba(63, 221, 255, 0.22);
    }

    .hud__fire:disabled {
      color: rgba(255, 255, 255, 0.42);
      background: rgba(255, 255, 255, 0.08);
      box-shadow: none;
      cursor: default;
    }

    .hud__buttons {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
      margin-top: 8px;
      min-width: 0;
    }

    .hud__buttons button {
      min-width: 0;
      overflow: hidden;
      padding: 0 7px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hud__status {
      margin-top: 10px;
      color: #95eaff;
      font-size: 12px;
      min-height: 15px;
    }

    .hud__score {
      display: none;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(169, 225, 255, 0.16);
    }

    .hud__score.is-visible {
      display: block;
    }

    .hud__score .hud__score-title {
      display: block;
      min-height: 0;
      margin-bottom: 5px;
      color: #e9fbff;
      font-weight: 800;
      font-size: 12px;
    }

    .hud__score .hud__score-total {
      margin-top: 4px;
      color: #f4f8fb;
      font-weight: 900;
    }

    .hud__score .hud__score-total strong {
      color: #9df8ff;
      font-size: 16px;
    }

    .hud__score .is-penalty {
      color: #ff8b8b;
    }

    .screen-flash {
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at center, rgba(255, 255, 255, 0.72), rgba(110, 230, 255, 0.18) 32%, transparent 64%);
      mix-blend-mode: screen;
      z-index: 2;
    }

    @media (min-width: 900px) {
      .hud {
        left: 16px;
        bottom: 16px;
        transform: none;
        width: 430px;
      }
    }

    @media (max-width: 520px) {
      .hud {
        left: max(8px, env(safe-area-inset-left));
        right: auto;
        bottom: max(8px, env(safe-area-inset-bottom));
        width: min(calc(100vw - 16px), 374px);
        max-width: calc(100vw - 16px);
        max-height: min(34svh, 280px);
        padding: 8px;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
          "title"
          "mission"
          "projectiles"
          "fire"
          "steppers"
          "buttons"
          "score";
        gap: 5px;
        align-items: stretch;
        background: linear-gradient(180deg, rgba(8, 12, 18, 0.72), rgba(8, 12, 18, 0.92));
        transform: none;
        scrollbar-width: thin;
      }

      .hud__title {
        grid-area: title;
        align-items: flex-start;
        flex-direction: column;
        gap: 1px;
        margin: 0;
        min-width: 0;
      }

      .hud__title > span {
        font-size: 14px;
        line-height: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      .hud__title small {
        display: inline-flex;
        max-width: 100%;
      }

      .hud__title small span {
        display: none;
      }

      .hud__mission {
        grid-area: mission;
        gap: 2px;
        margin: 0;
        min-width: 0;
        padding: 0;
        border: 0;
        background: transparent;
      }

      .hud__mission strong {
        overflow: hidden;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hud__mission span {
        display: -webkit-box;
        overflow: hidden;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .hud__mission span,
      .hud__status {
        font-size: 10px;
        line-height: 1.18;
      }

      .hud__mission em,
      .hud__row {
        display: none;
      }

      .hud__projectiles {
        grid-area: projectiles;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
        margin: 0;
      }

      .hud__projectile {
        min-height: 34px;
        font-size: 9px;
        padding: 0 3px;
      }

      .hud__fire {
        grid-area: fire;
        min-width: 0;
        width: 100%;
        min-height: 42px;
        margin: 0;
        font-size: 14px;
      }

      .hud__steppers {
        grid-area: steppers;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5px;
        margin: 0;
      }

      .hud__stepper {
        grid-template-columns: minmax(28px, 0.8fr) 28px minmax(36px, 1fr) 28px;
        gap: 3px;
        padding: 3px;
        font-size: 10px;
      }

      .hud__buttons {
        grid-area: buttons;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
        margin: 0;
      }

      .hud__buttons button,
      .hud__stepper button {
        min-height: 30px;
      }

      .hud__buttons button {
        padding: 0 5px;
        font-size: 10px;
      }

      .hud__status {
        display: none;
      }

      .hud__score {
        grid-area: score;
        max-height: 110px;
        overflow-y: auto;
      }
    }
  `;
  document.head.appendChild(style);
}

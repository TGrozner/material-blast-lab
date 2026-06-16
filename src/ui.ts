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
  status: string;
  score: ScoreBreakdown | null;
}

interface UICallbacks {
  fire(): void;
  reset(): void;
  clearDebris(): void;
  selectProjectile(id: ProjectileId): void;
  nextLevel(): void;
}

export class GameUI {
  private readonly root: HTMLDivElement;
  private readonly projectileValue: HTMLSpanElement;
  private readonly chamberValue: HTMLSpanElement;
  private readonly powerValue: HTMLSpanElement;
  private readonly sizeValue: HTMLSpanElement;
  private readonly shotsValue: HTMLSpanElement;
  private readonly bodyValue: HTMLSpanElement;
  private readonly statusValue: HTMLDivElement;
  private readonly fireButton: HTMLButtonElement;
  private readonly scorePanel: HTMLDivElement;
  private readonly projectileButtons = new Map<ProjectileId, HTMLButtonElement>();

  constructor(private readonly callbacks: UICallbacks) {
    installStyles();

    this.root = document.createElement("div");
    this.root.className = "hud";
    this.root.innerHTML = `
      <div class="hud__title">
        <span>Material Blast Lab</span>
        <small>Cannon Trial</small>
      </div>
      <div class="hud__row"><span>Chamber</span><strong data-role="chamber"></strong></div>
      <div class="hud__row"><span>Projectile</span><strong data-role="projectile"></strong></div>
      <div class="hud__row"><span>Power</span><strong data-role="power"></strong></div>
      <div class="hud__row"><span>Size</span><strong data-role="size"></strong></div>
      <div class="hud__row"><span>Shot</span><strong data-role="shots"></strong></div>
      <div class="hud__row"><span>Bodies</span><strong data-role="bodies"></strong></div>
      <div class="hud__projectiles" data-role="projectiles"></div>
      <button class="hud__fire" type="button">FIRE</button>
      <div class="hud__buttons">
        <button type="button" data-action="level">Next Lab</button>
        <button type="button" data-action="clear">Clear</button>
        <button type="button" data-action="reset">Reset</button>
      </div>
      <div class="hud__controls">
        <span>Mouse aim</span>
        <span>Click / Space fire</span>
        <span>1-5 projectile</span>
        <span>+/- power</span>
        <span>[ ] size</span>
        <span>Tab chamber</span>
        <span>R reset</span>
        <span>C clear debris</span>
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
  }

  update(state: UIState): void {
    this.projectileValue.textContent = state.projectile.name;
    this.chamberValue.textContent = state.levelName;
    this.chamberValue.title = state.levelDescription;
    this.powerValue.textContent = `${Math.round(state.powerScale * 100)}%`;
    this.sizeValue.textContent = `${Math.round(state.sizeScale * 100)}%`;
    this.shotsValue.textContent = state.shotAvailable ? "READY" : "SPENT";
    this.bodyValue.textContent = String(state.bodyCount);
    this.statusValue.textContent = state.status;
    this.fireButton.disabled = !state.shotAvailable;

    for (const [id, button] of this.projectileButtons) {
      button.classList.toggle("is-active", id === state.projectileId);
    }

    if (state.score) {
      this.scorePanel.classList.add("is-visible");
      this.scorePanel.innerHTML = `
        <div class="hud__score-title">${state.score.shotName} Result</div>
        <div><span>Structure Damage</span><strong>${state.score.structureDamage}</strong></div>
        <div><span>Material Chaos</span><strong>${state.score.materialChaos}</strong></div>
        <div><span>Bio-Gel Splash</span><strong>${state.score.bioGelSplash}</strong></div>
        <div><span>Chain Bonus</span><strong>${state.score.chainReactionBonus}</strong></div>
        <div><span>Motion Bonus</span><strong>${state.score.remainingDebrisMotion}</strong></div>
        <div class="hud__score-total"><span>Total</span><strong>${state.score.totalScore}</strong></div>
      `;
    } else {
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
    }

    .hud {
      position: fixed;
      top: 16px;
      left: 16px;
      width: min(350px, calc(100vw - 32px));
      padding: 14px;
      border: 1px solid rgba(169, 225, 255, 0.18);
      border-radius: 8px;
      background: rgba(8, 12, 18, 0.78);
      box-shadow: 0 14px 42px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(14px);
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

    .hud__title span {
      font-size: 15px;
      font-weight: 800;
    }

    .hud__title small {
      color: #8eb0c2;
      font-size: 11px;
      white-space: nowrap;
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
      color: #f4f8fb;
      font-size: 13px;
      text-align: right;
    }

    .hud__projectiles {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 7px;
      margin: 12px 0;
    }

    .hud__projectile {
      min-width: 0;
      height: 30px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      color: #f8fdff;
      background: linear-gradient(135deg, color-mix(in srgb, var(--projectile), #000 22%), rgba(255, 255, 255, 0.1));
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .hud__projectile.is-active {
      outline: 2px solid #bff7ff;
      outline-offset: 2px;
    }

    .hud__fire,
    .hud__buttons button {
      height: 34px;
      border: 1px solid rgba(185, 245, 255, 0.22);
      border-radius: 7px;
      color: #f8fdff;
      background: rgba(255, 255, 255, 0.08);
      font-weight: 800;
      cursor: pointer;
    }

    .hud__fire {
      width: 100%;
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
      grid-template-columns: repeat(3, 1fr);
      gap: 7px;
      margin-top: 8px;
    }

    .hud__controls {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
    }

    .hud__controls span {
      padding: 4px 6px;
      border-radius: 5px;
      color: #b5c8d3;
      background: rgba(255, 255, 255, 0.06);
      font-size: 11px;
      line-height: 1.15;
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

    .screen-flash {
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at center, rgba(255, 255, 255, 0.72), rgba(110, 230, 255, 0.18) 32%, transparent 64%);
      mix-blend-mode: screen;
      z-index: 2;
    }

    @media (max-width: 680px) {
      .hud {
        top: 10px;
        left: 10px;
        width: calc(100vw - 20px);
        padding: 12px;
      }

      .hud__controls span,
      .hud__projectile {
        font-size: 10px;
      }
    }
  `;
  document.head.appendChild(style);
}

import * as THREE from "three";
import type { ScoreEvent } from "./scoring";

interface ScorePopup {
  element: HTMLDivElement;
  position: THREE.Vector3;
  life: number;
  maxLife: number;
  visible: boolean;
}

export class ScorePopupLayer {
  private readonly root: HTMLDivElement;
  private readonly chainMeter: HTMLDivElement;
  private readonly popups: ScorePopup[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly updateViewport = () => this.refreshViewport();
  private chainMeterLife = 0;
  private chainMeterVisible = false;
  private viewportWidth = window.innerWidth;
  private viewportHeight = window.innerHeight;
  private viewportOffsetX = 0;
  private viewportOffsetY = 0;

  constructor() {
    installScorePopupStyles();
    this.refreshViewport();
    this.root = document.createElement("div");
    this.root.className = "score-popups";
    this.chainMeter = document.createElement("div");
    this.chainMeter.className = "chain-meter";
    this.root.appendChild(this.chainMeter);
    document.body.appendChild(this.root);
    window.addEventListener("resize", this.updateViewport);
    window.visualViewport?.addEventListener("resize", this.updateViewport);
    window.visualViewport?.addEventListener("scroll", this.updateViewport);
  }

  push(events: ScoreEvent[]): void {
    const sorted = events.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
    const topChain = sorted.find((event) => event.kind === "chain" && event.combo);
    if (topChain) {
      this.showChainMeter(topChain);
    }

    for (const event of sorted.slice(0, 10)) {
      if (Math.abs(event.points) < 12) {
        continue;
      }
      const element = document.createElement("div");
      const positive = event.points >= 0;
      const comboClass = event.kind === "chain" ? chainPopupClass(event.combo ?? 1) : "";
      element.className = `score-popup score-popup--${event.kind} ${comboClass} ${positive ? "is-positive" : "is-negative"}`;
      element.textContent = `${positive ? "+" : "-"}${Math.abs(event.points)} ${event.label}`;
      this.root.appendChild(element);
      this.popups.push({
        element,
        position: event.position.clone(),
        life: 0,
        maxLife: event.kind === "chain" ? 1.85 + Math.min(0.75, ((event.combo ?? 1) - 1) * 0.18) : 1.35,
        visible: true
      });
    }
  }

  update(deltaSeconds: number, camera: THREE.Camera): void {
    if (this.chainMeterLife > 0) {
      this.chainMeterLife = Math.max(0, this.chainMeterLife - deltaSeconds);
      this.setChainMeterVisible(this.chainMeterLife > 0);
    }

    for (let i = this.popups.length - 1; i >= 0; i -= 1) {
      const popup = this.popups[i];
      popup.life += deltaSeconds;
      const t = popup.life / popup.maxLife;
      if (t >= 1) {
        popup.element.remove();
        this.popups.splice(i, 1);
        continue;
      }

      this.scratch.copy(popup.position).project(camera);
      const onScreen = this.scratch.z > -1 && this.scratch.z < 1;
      if (popup.visible !== onScreen) {
        popup.visible = onScreen;
        popup.element.style.display = onScreen ? "block" : "none";
      }
      if (!onScreen) {
        continue;
      }
      const x = this.viewportOffsetX + (this.scratch.x * 0.5 + 0.5) * this.viewportWidth;
      const y = this.viewportOffsetY + (-this.scratch.y * 0.5 + 0.5) * this.viewportHeight - easeOutCubic(t) * 34;
      const scale = THREE.MathUtils.lerp(0.92, 1.08, Math.min(1, t * 3));
      popup.element.style.opacity = String(Math.max(0, 1 - Math.max(0, t - 0.62) / 0.38));
      popup.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
    }
  }

  clear(): void {
    for (const popup of this.popups) {
      popup.element.remove();
    }
    this.popups.length = 0;
    this.chainMeterLife = 0;
    this.chainMeterVisible = false;
    this.chainMeter.className = "chain-meter";
    this.chainMeter.textContent = "";
  }

  dispose(): void {
    this.clear();
    window.removeEventListener("resize", this.updateViewport);
    window.visualViewport?.removeEventListener("resize", this.updateViewport);
    window.visualViewport?.removeEventListener("scroll", this.updateViewport);
    this.root.remove();
  }

  private showChainMeter(event: ScoreEvent): void {
    const combo = event.combo ?? 1;
    this.chainMeterLife = 2.75;
    this.chainMeter.className = `chain-meter is-visible ${chainPopupClass(combo)}`;
    this.chainMeterVisible = true;
    this.chainMeter.textContent = `${event.label}  +${event.points}`;
  }

  private setChainMeterVisible(visible: boolean): void {
    if (this.chainMeterVisible !== visible) {
      this.chainMeterVisible = visible;
      this.chainMeter.classList.toggle("is-visible", visible);
    }
  }

  private refreshViewport(): void {
    const viewport = window.visualViewport;
    this.viewportWidth = viewport?.width ?? window.innerWidth;
    this.viewportHeight = viewport?.height ?? window.innerHeight;
    this.viewportOffsetX = viewport?.offsetLeft ?? 0;
    this.viewportOffsetY = viewport?.offsetTop ?? 0;
  }
}

let scorePopupStylesInstalled = false;

function installScorePopupStyles(): void {
  if (scorePopupStylesInstalled) {
    return;
  }
  scorePopupStylesInstalled = true;
  const style = document.createElement("style");
  style.textContent = `
    .score-popups {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 4;
      overflow: hidden;
      contain: layout paint;
    }

    .score-popup {
      position: absolute;
      left: 0;
      top: 0;
      padding: 4px 8px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 6px;
      color: #f9fdff;
      background: rgba(6, 10, 14, 0.72);
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: 0;
      white-space: nowrap;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
      will-change: transform, opacity;
    }

    .score-popup--target,
    .score-popup--chain,
    .score-popup--purge,
    .score-popup--chaos {
      border-color: rgba(124, 255, 169, 0.42);
      color: #baffcb;
    }

    .score-popup--chain {
      color: #ffe48f;
      border-color: rgba(255, 218, 92, 0.48);
    }

    .score-popup--combo {
      padding: 5px 10px;
      color: #fff3a8;
      border-color: rgba(255, 225, 108, 0.72);
      background: rgba(42, 29, 7, 0.78);
      font-size: 13px;
    }

    .score-popup--cascade {
      padding: 6px 12px;
      color: #ffffff;
      border-color: rgba(255, 154, 67, 0.82);
      background: rgba(68, 28, 9, 0.84);
      box-shadow: 0 10px 26px rgba(255, 124, 42, 0.22);
      font-size: 14px;
    }

    .chain-meter {
      position: fixed;
      left: 50%;
      top: max(16px, env(safe-area-inset-top));
      min-width: 164px;
      padding: 8px 14px;
      border: 1px solid rgba(255, 226, 126, 0.66);
      border-radius: 7px;
      color: #fff3a8;
      background: rgba(7, 11, 16, 0.76);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0;
      line-height: 1;
      text-align: center;
      text-shadow: 0 1px 7px rgba(0, 0, 0, 0.7);
      transform: translate(-50%, -12px) scale(0.96);
      opacity: 0;
      transition: opacity 120ms ease, transform 160ms ease;
      will-change: transform, opacity;
    }

    .chain-meter.is-visible {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }

    .chain-meter.score-popup--cascade {
      min-width: 210px;
      color: #ffffff;
      border-color: rgba(255, 154, 67, 0.9);
      background: rgba(69, 29, 8, 0.84);
    }

    .score-popup--purge {
      color: #ff9bc4;
      border-color: rgba(255, 110, 178, 0.46);
    }

    .score-popup--protected {
      color: #ff9b9b;
      border-color: rgba(255, 120, 120, 0.5);
    }

    @media (max-width: 520px) {
      .score-popup {
        padding: 4px 6px;
        font-size: 11px;
      }

      .score-popup--cascade {
        font-size: 12px;
      }

      .chain-meter {
        top: 10px;
        max-width: calc(100vw - 24px);
        min-width: 144px;
        padding: 7px 10px;
        font-size: 12px;
      }
    }
  `;
  document.head.appendChild(style);
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function chainPopupClass(combo: number): string {
  if (combo >= 3) {
    return "score-popup--cascade";
  }
  if (combo >= 2) {
    return "score-popup--combo";
  }
  return "";
}

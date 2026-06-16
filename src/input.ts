import * as THREE from "three";
import type { ProjectileId } from "./projectile";

interface InputCallbacks {
  aim(pointer: THREE.Vector2): void;
  fire(): void;
  reset(): void;
  clearDebris(): void;
  adjustPower(delta: number): void;
  adjustSize(delta: number): void;
  selectProjectile(id: ProjectileId): void;
  nextLevel(): void;
}

export class InputController {
  private readonly pointer = new THREE.Vector2(0, 0);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks
  ) {
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("contextmenu", this.preventContextMenu);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.callbacks.aim(this.pointerFromEvent(event));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.callbacks.aim(this.pointerFromEvent(event));
    if (event.button === 0 && event.pointerType === "mouse") {
      this.callbacks.fire();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }
    if (event.target instanceof HTMLElement && ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      this.callbacks.fire();
      return;
    }
    if (event.key === "r" || event.key === "R") {
      this.callbacks.reset();
      return;
    }
    if (event.key === "c" || event.key === "C") {
      this.callbacks.clearDebris();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      this.callbacks.nextLevel();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      this.callbacks.adjustPower(0.08);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      this.callbacks.adjustPower(-0.08);
      return;
    }
    if (event.key === "]") {
      this.callbacks.adjustSize(0.08);
      return;
    }
    if (event.key === "[") {
      this.callbacks.adjustSize(-0.08);
      return;
    }

    const projectileByKey: Record<string, ProjectileId> = {
      "1": "slug",
      "2": "scatter",
      "3": "pulse",
      "4": "gel",
      "5": "gravity"
    };
    const projectile = projectileByKey[event.key];
    if (projectile) {
      this.callbacks.selectProjectile(projectile);
    }
  };

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private pointerFromEvent(event: PointerEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    return this.pointer.clone();
  }
}

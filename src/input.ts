import * as THREE from "three";
import type { AircraftInputState } from "./aircraft";
import type { ProjectileId } from "./projectile";

export type InputMode = "cannon" | "plane";

interface InputCallbacks {
  aim(pointer: THREE.Vector2): void;
  fire(): void;
  reset(): void;
  clearDebris(): void;
  finishRun(): void;
  selectProjectile(id: ProjectileId): void;
  nextLevel(): void;
}

export class InputController {
  private readonly pointer = new THREE.Vector2(0, 0);
  private readonly pressedKeys = new Set<string>();
  private pendingAimFrame: number | null = null;
  private mode: InputMode = "cannon";
  private joystickPointerId: number | null = null;
  private joystickOriginX = 0;
  private joystickOriginY = 0;
  private joystickCurrentX = 0;
  private joystickCurrentY = 0;
  private uiBoostActive = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks
  ) {
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("lostpointercapture", this.onLostPointerCapture);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("contextmenu", this.preventContextMenu);
  }

  dispose(): void {
    if (this.pendingAimFrame !== null) {
      window.cancelAnimationFrame(this.pendingAimFrame);
      this.pendingAimFrame = null;
    }
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
  }

  setMode(mode: InputMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    this.clearTouchFlightInput();
  }

  setPlaneBoost(active: boolean): void {
    this.uiBoostActive = active;
  }

  getPlaneInput(): AircraftInputState {
    const keyboardYaw = keyAxis(this.pressedKeys, ["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]);
    const keyboardPitch = keyAxis(this.pressedKeys, ["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]);
    const touch = this.touchFlightAxis();
    return {
      pitch: THREE.MathUtils.clamp(keyboardPitch + touch.pitch, -1, 1),
      yaw: THREE.MathUtils.clamp(keyboardYaw + touch.yaw, -1, 1),
      boost: this.uiBoostActive || this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight")
    };
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.mode === "plane") {
      this.updateTouchFlightPointer(event);
      return;
    }
    this.pointerFromEvent(event);
    if (this.pendingAimFrame !== null) {
      return;
    }
    this.pendingAimFrame = window.requestAnimationFrame(() => {
      this.pendingAimFrame = null;
      this.callbacks.aim(this.pointer);
    });
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.mode === "plane") {
      this.startTouchFlightPointer(event);
      return;
    }
    if (this.pendingAimFrame !== null) {
      window.cancelAnimationFrame(this.pendingAimFrame);
      this.pendingAimFrame = null;
    }
    this.callbacks.aim(this.pointerFromEvent(event));
    if (event.button === 0) {
      if (event.pointerType === "mouse") {
        this.callbacks.fire();
      }
      this.callbacks.finishRun();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLElement && ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) {
      return;
    }
    this.pressedKeys.add(event.code);
    if (this.mode === "plane" && isFlightKey(event.code)) {
      event.preventDefault();
    }
    if (event.repeat) {
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
    if (event.key === "Enter" || event.key === "f" || event.key === "F") {
      event.preventDefault();
      this.callbacks.finishRun();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      this.callbacks.nextLevel();
      return;
    }

    const projectileByKey: Record<string, ProjectileId> = {
      "1": "slug",
      "2": "scatter",
      "3": "pulse",
      "4": "gravity"
    };
    const projectile = projectileByKey[event.key];
    if (projectile) {
      this.callbacks.selectProjectile(projectile);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.pressedKeys.clear();
    this.clearTouchFlightInput();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.endTouchFlightPointer(event.pointerId);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.endTouchFlightPointer(event.pointerId);
  };

  private readonly onLostPointerCapture = (event: PointerEvent): void => {
    this.endTouchFlightPointer(event.pointerId);
  };

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private pointerFromEvent(event: PointerEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    return this.pointer;
  }

  private startTouchFlightPointer(event: PointerEvent): void {
    if (event.pointerType === "mouse") {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    if (localY < rect.height * 0.42) {
      return;
    }
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    if (this.joystickPointerId !== null) {
      return;
    }
    this.joystickPointerId = event.pointerId;
    this.joystickOriginX = event.clientX;
    this.joystickOriginY = event.clientY;
    this.joystickCurrentX = event.clientX;
    this.joystickCurrentY = event.clientY;
  }

  private updateTouchFlightPointer(event: PointerEvent): void {
    if (event.pointerId !== this.joystickPointerId) {
      return;
    }
    event.preventDefault();
    this.joystickCurrentX = event.clientX;
    this.joystickCurrentY = event.clientY;
  }

  private endTouchFlightPointer(pointerId: number): void {
    if (pointerId === this.joystickPointerId) {
      this.joystickPointerId = null;
    }
  }

  private clearTouchFlightInput(): void {
    this.joystickPointerId = null;
    this.uiBoostActive = false;
  }

  private touchFlightAxis(): { pitch: number; yaw: number } {
    if (this.joystickPointerId === null) {
      return { pitch: 0, yaw: 0 };
    }
    const radius = Math.max(56, Math.min(window.innerWidth, window.innerHeight) * 0.14);
    const yaw = applyDeadzone((this.joystickCurrentX - this.joystickOriginX) / radius, 0.08);
    const pitch = applyDeadzone((this.joystickOriginY - this.joystickCurrentY) / radius, 0.08);
    return {
      pitch: THREE.MathUtils.clamp(pitch, -1, 1),
      yaw: THREE.MathUtils.clamp(yaw, -1, 1)
    };
  }
}

function keyAxis(keys: Set<string>, negativeCodes: string[], positiveCodes: string[]): number {
  const negative = negativeCodes.some((code) => keys.has(code)) ? 1 : 0;
  const positive = positiveCodes.some((code) => keys.has(code)) ? 1 : 0;
  return positive - negative;
}

function isFlightKey(code: string): boolean {
  return (
    code === "KeyW" ||
    code === "KeyA" ||
    code === "KeyS" ||
    code === "KeyD" ||
    code === "ArrowUp" ||
    code === "ArrowDown" ||
    code === "ArrowLeft" ||
    code === "ArrowRight" ||
    code === "ShiftLeft" ||
    code === "ShiftRight" ||
    code === "Space"
  );
}

function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) {
    return 0;
  }
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}

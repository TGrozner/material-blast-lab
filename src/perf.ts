export interface PerfFrameSnapshot {
  frame: number;
  totalMs: number;
  deltaMs: number;
  bodyCount: number;
  dynamicBodyCount: number;
  awakeBodyCount: number;
  debrisBodyCount: number;
  awakeDebrisBodyCount: number;
  activeDebrisCount: number;
  frozenDebrisCount: number;
  pendingSupportReleaseCount: number;
  accountedMs: number;
  unattributedMs: number;
  timings: Record<string, number>;
  counters: Record<string, number>;
}

export interface PerfFrameRuntimeStats {
  bodyCount: number;
  dynamicBodyCount: number;
  awakeBodyCount: number;
  debrisBodyCount: number;
  awakeDebrisBodyCount: number;
  activeDebrisCount: number;
  frozenDebrisCount: number;
  pendingSupportReleaseCount: number;
}

export interface PerfReport {
  enabled: boolean;
  frameCount: number;
  slowFrameCount: number;
  maxFrameMs: number;
  maxFrame: PerfFrameSnapshot | null;
  recentSlowFrames: PerfFrameSnapshot[];
  counterTotals: Record<string, number>;
  counterMax: Record<string, number>;
}

const SLOW_FRAME_MS = 24;
const MAX_SLOW_FRAMES = 80;
const ACCOUNTED_TIMING_NAMES = new Set([
  "game.cannon",
  "physics.traffic",
  "physics.step",
  "game.projectiles",
  "game.processDebrisImpacts",
  "game.updateBurningHazards",
  "game.updatePhase",
  "game.flushWork",
  "vfx.update",
  "game.visualUpdate",
  "game.ui",
  "renderer.render"
]);

class PerfMonitor {
  private enabled = shouldEnablePerfMonitor();
  private frameCount = 0;
  private slowFrameCount = 0;
  private maxFrame: PerfFrameSnapshot | null = null;
  private currentFrame: PerfFrameSnapshot | null = null;
  private frameStartedAt = 0;
  private readonly slowFrames: PerfFrameSnapshot[] = [];
  private slowFrameStart = 0;
  private readonly counterTotals: Record<string, number> = {};
  private readonly counterMax: Record<string, number> = {};

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.currentFrame = null;
    }
  }

  beginFrame(deltaMs: number, runtimeStats: PerfFrameRuntimeStats): void {
    if (!this.enabled) {
      return;
    }
    this.frameStartedAt = performance.now();
    this.currentFrame = {
      frame: this.frameCount,
      totalMs: 0,
      deltaMs,
      bodyCount: runtimeStats.bodyCount,
      dynamicBodyCount: runtimeStats.dynamicBodyCount,
      awakeBodyCount: runtimeStats.awakeBodyCount,
      debrisBodyCount: runtimeStats.debrisBodyCount,
      awakeDebrisBodyCount: runtimeStats.awakeDebrisBodyCount,
      activeDebrisCount: runtimeStats.activeDebrisCount,
      frozenDebrisCount: runtimeStats.frozenDebrisCount,
      pendingSupportReleaseCount: runtimeStats.pendingSupportReleaseCount,
      accountedMs: 0,
      unattributedMs: 0,
      timings: {},
      counters: {}
    };
    this.frameCount += 1;
  }

  timeStart(): number {
    return this.enabled ? performance.now() : 0;
  }

  addTiming(name: string, startedAt: number): void {
    if (!this.enabled || !this.currentFrame || startedAt <= 0) {
      return;
    }
    this.currentFrame.timings[name] = (this.currentFrame.timings[name] ?? 0) + performance.now() - startedAt;
  }

  addCount(name: string, value = 1): void {
    if (!this.enabled || !this.currentFrame) {
      return;
    }
    const frameValue = (this.currentFrame.counters[name] ?? 0) + value;
    this.currentFrame.counters[name] = frameValue;
    this.counterTotals[name] = (this.counterTotals[name] ?? 0) + value;
    this.counterMax[name] = Math.max(this.counterMax[name] ?? 0, frameValue);
  }

  endFrame(): void {
    if (!this.enabled || !this.currentFrame) {
      return;
    }
    this.currentFrame.totalMs = performance.now() - this.frameStartedAt;
    this.currentFrame.accountedMs = sumAccountedTimings(this.currentFrame.timings);
    this.currentFrame.unattributedMs = Math.max(0, this.currentFrame.totalMs - this.currentFrame.accountedMs);
    const frame = cloneFrame(this.currentFrame);
    if (!this.maxFrame || frame.totalMs > this.maxFrame.totalMs) {
      this.maxFrame = frame;
    }
    if (frame.totalMs >= SLOW_FRAME_MS) {
      this.slowFrameCount += 1;
      this.recordSlowFrame(frame);
    }
    this.currentFrame = null;
  }

  report(): PerfReport {
    const recentSlowFrames = this.orderedSlowFrames().map(cloneFrame);
    return {
      enabled: this.enabled,
      frameCount: this.frameCount,
      slowFrameCount: this.slowFrameCount,
      maxFrameMs: this.maxFrame?.totalMs ?? 0,
      maxFrame: this.maxFrame ? cloneFrame(this.maxFrame) : null,
      recentSlowFrames,
      counterTotals: { ...this.counterTotals },
      counterMax: { ...this.counterMax }
    };
  }

  clear(): void {
    this.frameCount = 0;
    this.slowFrameCount = 0;
    this.maxFrame = null;
    this.currentFrame = null;
    this.slowFrames.length = 0;
    this.slowFrameStart = 0;
    clearRecord(this.counterTotals);
    clearRecord(this.counterMax);
  }

  private recordSlowFrame(frame: PerfFrameSnapshot): void {
    if (this.slowFrames.length < MAX_SLOW_FRAMES) {
      this.slowFrames.push(frame);
      return;
    }
    this.slowFrames[this.slowFrameStart] = frame;
    this.slowFrameStart = (this.slowFrameStart + 1) % MAX_SLOW_FRAMES;
  }

  private orderedSlowFrames(): PerfFrameSnapshot[] {
    if (this.slowFrames.length < MAX_SLOW_FRAMES || this.slowFrameStart === 0) {
      return this.slowFrames;
    }
    return this.slowFrames.slice(this.slowFrameStart).concat(this.slowFrames.slice(0, this.slowFrameStart));
  }
}

export const perfMonitor = new PerfMonitor();

function shouldEnablePerfMonitor(): boolean {
  try {
    return shouldEnablePerfFromSearch(globalThis.location?.search ?? "", import.meta.env.DEV);
  } catch {
    return false;
  }
}

export function shouldEnablePerfFromSearch(search: string, diagnosticsAllowed = true): boolean {
  if (!diagnosticsAllowed) {
    return false;
  }
  const params = new URLSearchParams(search);
  return params.has("perf") || params.has("perfFull");
}

function cloneFrame(frame: PerfFrameSnapshot): PerfFrameSnapshot {
  return {
    frame: frame.frame,
    totalMs: round(frame.totalMs),
    deltaMs: round(frame.deltaMs),
    bodyCount: frame.bodyCount,
    dynamicBodyCount: frame.dynamicBodyCount,
    awakeBodyCount: frame.awakeBodyCount,
    debrisBodyCount: frame.debrisBodyCount,
    awakeDebrisBodyCount: frame.awakeDebrisBodyCount,
    activeDebrisCount: frame.activeDebrisCount,
    frozenDebrisCount: frame.frozenDebrisCount,
    pendingSupportReleaseCount: frame.pendingSupportReleaseCount,
    accountedMs: round(frame.accountedMs),
    unattributedMs: round(frame.unattributedMs),
    timings: roundRecord(frame.timings),
    counters: { ...frame.counters }
  };
}

function sumAccountedTimings(record: Record<string, number>): number {
  let total = 0;
  for (const [name, value] of Object.entries(record)) {
    if (ACCOUNTED_TIMING_NAMES.has(name)) {
      total += value;
    }
  }
  return total;
}

function roundRecord(record: Record<string, number>): Record<string, number> {
  const rounded: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    rounded[key] = round(value);
  }
  return rounded;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clearRecord(record: Record<string, number>): void {
  for (const key of Object.keys(record)) {
    delete record[key];
  }
}

export interface PerfFrameSnapshot {
  frame: number;
  totalMs: number;
  deltaMs: number;
  bodyCount: number;
  timings: Record<string, number>;
  counters: Record<string, number>;
}

export interface PerfReport {
  enabled: boolean;
  frameCount: number;
  slowFrameCount: number;
  maxFrameMs: number;
  maxFrame: PerfFrameSnapshot | null;
  recentSlowFrames: PerfFrameSnapshot[];
}

const SLOW_FRAME_MS = 24;
const MAX_SLOW_FRAMES = 80;

class PerfMonitor {
  private enabled = shouldEnablePerfMonitor();
  private frameCount = 0;
  private slowFrameCount = 0;
  private maxFrame: PerfFrameSnapshot | null = null;
  private currentFrame: PerfFrameSnapshot | null = null;
  private frameStartedAt = 0;
  private readonly slowFrames: PerfFrameSnapshot[] = [];

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.currentFrame = null;
    }
  }

  beginFrame(deltaMs: number, bodyCount: number): void {
    if (!this.enabled) {
      return;
    }
    this.frameStartedAt = performance.now();
    this.currentFrame = {
      frame: this.frameCount,
      totalMs: 0,
      deltaMs,
      bodyCount,
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
    this.currentFrame.counters[name] = (this.currentFrame.counters[name] ?? 0) + value;
  }

  endFrame(): void {
    if (!this.enabled || !this.currentFrame) {
      return;
    }
    this.currentFrame.totalMs = performance.now() - this.frameStartedAt;
    const frame = cloneFrame(this.currentFrame);
    if (!this.maxFrame || frame.totalMs > this.maxFrame.totalMs) {
      this.maxFrame = frame;
    }
    if (frame.totalMs >= SLOW_FRAME_MS) {
      this.slowFrameCount += 1;
      this.slowFrames.push(frame);
      while (this.slowFrames.length > MAX_SLOW_FRAMES) {
        this.slowFrames.shift();
      }
    }
    this.currentFrame = null;
  }

  report(): PerfReport {
    return {
      enabled: this.enabled,
      frameCount: this.frameCount,
      slowFrameCount: this.slowFrameCount,
      maxFrameMs: this.maxFrame?.totalMs ?? 0,
      maxFrame: this.maxFrame ? cloneFrame(this.maxFrame) : null,
      recentSlowFrames: this.slowFrames.map(cloneFrame)
    };
  }

  clear(): void {
    this.frameCount = 0;
    this.slowFrameCount = 0;
    this.maxFrame = null;
    this.currentFrame = null;
    this.slowFrames.length = 0;
  }
}

export const perfMonitor = new PerfMonitor();

function shouldEnablePerfMonitor(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").has("perf");
  } catch {
    return false;
  }
}

function cloneFrame(frame: PerfFrameSnapshot): PerfFrameSnapshot {
  return {
    frame: frame.frame,
    totalMs: round(frame.totalMs),
    deltaMs: round(frame.deltaMs),
    bodyCount: frame.bodyCount,
    timings: roundRecord(frame.timings),
    counters: { ...frame.counters }
  };
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

import * as THREE from "three";
import type { ExplosionResult } from "./destruction";
import type { MaterialId } from "./materialCatalog";
import type { ProjectileId } from "./projectile";

type SampleId =
  | "blastCrunchA"
  | "blastCrunchB"
  | "blastCrunchC"
  | "lowBoomA"
  | "lowBoomB"
  | "muzzleA"
  | "muzzleB"
  | "forceField"
  | "metalHeavyA"
  | "metalHeavyB"
  | "metalSci"
  | "glassHeavyA"
  | "glassHeavyB"
  | "woodHeavyA"
  | "woodHeavyB"
  | "plank"
  | "concreteA"
  | "concreteB"
  | "plateHeavyA"
  | "plateHeavyB"
  | "punchHeavy"
  | "bellHeavy";

interface BufferPlayOptions {
  gain: number;
  rate?: number;
  delay?: number;
  pan?: number;
  detune?: number;
  highpass?: number;
  lowpass?: number;
}

interface ImpactOptions {
  point: THREE.Vector3;
  projectileId: ProjectileId;
  result: ExplosionResult;
  powerScale: number;
  sizeScale: number;
  hitMaterialId?: MaterialId;
}

interface ChainImpactOptions {
  point: THREE.Vector3;
  result: ExplosionResult;
  relativeSpeed: number;
  materialId: MaterialId;
}

interface AudioMixSettings {
  master: number;
  sfx: number;
  ui: number;
  rumble: number;
}

type AudioBus = "sfx" | "ui" | "rumble";

const SAMPLE_PATHS: Record<SampleId, string> = {
  blastCrunchA: "audio/kenney-scifi/explosionCrunch_001.ogg",
  blastCrunchB: "audio/kenney-scifi/explosionCrunch_003.ogg",
  blastCrunchC: "audio/kenney-scifi/explosionCrunch_004.ogg",
  lowBoomA: "audio/kenney-scifi/lowFrequency_explosion_000.ogg",
  lowBoomB: "audio/kenney-scifi/lowFrequency_explosion_001.ogg",
  muzzleA: "audio/kenney-scifi/laserLarge_000.ogg",
  muzzleB: "audio/kenney-scifi/laserLarge_002.ogg",
  forceField: "audio/kenney-scifi/forceField_000.ogg",
  metalHeavyA: "audio/kenney-impact/impactMetal_heavy_000.ogg",
  metalHeavyB: "audio/kenney-impact/impactMetal_heavy_003.ogg",
  metalSci: "audio/kenney-scifi/impactMetal_003.ogg",
  glassHeavyA: "audio/kenney-impact/impactGlass_heavy_001.ogg",
  glassHeavyB: "audio/kenney-impact/impactGlass_heavy_003.ogg",
  woodHeavyA: "audio/kenney-impact/impactWood_heavy_000.ogg",
  woodHeavyB: "audio/kenney-impact/impactWood_heavy_004.ogg",
  plank: "audio/kenney-impact/impactPlank_medium_002.ogg",
  concreteA: "audio/kenney-impact/impactMining_000.ogg",
  concreteB: "audio/kenney-impact/impactMining_003.ogg",
  plateHeavyA: "audio/kenney-impact/impactPlate_heavy_000.ogg",
  plateHeavyB: "audio/kenney-impact/impactPlate_heavy_004.ogg",
  punchHeavy: "audio/kenney-impact/impactPunch_heavy_000.ogg",
  bellHeavy: "audio/kenney-impact/impactBell_heavy_001.ogg"
};

const MATERIAL_SAMPLES: Record<MaterialId, SampleId[]> = {
  wood: ["woodHeavyA", "woodHeavyB", "plank"],
  glass: ["glassHeavyA", "glassHeavyB"],
  concrete: ["concreteA", "concreteB", "punchHeavy"],
  metal: ["metalHeavyA", "metalHeavyB", "metalSci", "plateHeavyA"],
  rubber: ["punchHeavy", "plateHeavyB"],
  foam: ["punchHeavy", "plank"]
};

const PROJECTILE_BLASTS: Record<ProjectileId, SampleId[]> = {
  slug: ["blastCrunchA", "lowBoomA", "metalHeavyA"],
  scatter: ["blastCrunchB", "plateHeavyA", "plank"],
  pulse: ["blastCrunchC", "forceField", "lowBoomB"],
  gravity: ["blastCrunchC", "lowBoomA", "bellHeavy"],
  ignite: ["blastCrunchA", "forceField", "lowBoomB"]
};

const SAMPLE_IDS = Object.keys(SAMPLE_PATHS) as SampleId[];
const DEFAULT_MIX: AudioMixSettings = {
  master: 0.88,
  sfx: 0.96,
  ui: 0.8,
  rumble: 0.86
};

export class DestructionAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private rumbleBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private loading: Promise<void> | null = null;
  private readonly buffers = new Map<SampleId, AudioBuffer>();
  private readonly cooldowns = new Map<string, number>();
  private mix: AudioMixSettings = { ...DEFAULT_MIX };

  preload(): void {
    this.ensureAudio();
    void this.loadSamples();
  }

  resume(): void {
    const context = this.ensureAudio();
    if (context?.state === "suspended") {
      void context.resume();
    }
    void this.loadSamples();
  }

  setMasterVolume(value: number): void {
    this.mix.master = THREE.MathUtils.clamp(value, 0, 1);
    this.applyMix();
  }

  playLoadoutPreview(projectileId: ProjectileId, powerScale: number, sizeScale: number): void {
    this.resume();
    const pan = 0;
    const intensity = THREE.MathUtils.clamp(0.7 + powerScale * 0.18 + sizeScale * 0.12, 0.7, 1.25);
    this.playBuffer(this.pick(PROJECTILE_BLASTS[projectileId]), {
      gain: 0.09 * intensity,
      rate: projectileId === "gravity" ? 0.55 : this.randomRange(0.92, 1.14),
      pan,
      highpass: 180,
      lowpass: projectileId === "pulse" ? 5000 : 2800
    });
    this.playUiTick(projectileId === "gravity" ? -0.18 : 0.18);
  }

  playUiTick(pan = 0): void {
    this.resume();
    this.playTone({ frequency: 880, duration: 0.045, gain: 0.028, bus: "ui", pan, type: "triangle" });
  }

  playUiReject(): void {
    this.resume();
    this.playTone({ frequency: 190, duration: 0.08, gain: 0.05, bus: "ui", pan: 0, type: "sawtooth", lowpass: 900 });
    this.playTone({ frequency: 132, duration: 0.1, gain: 0.035, delay: 0.055, bus: "ui", pan: 0, type: "sawtooth", lowpass: 700 });
  }

  playScoreCeremony(totalScore: number, stars: number, completed: boolean): void {
    this.resume();
    const base = completed ? 220 : 146;
    const steps = Math.max(1, stars + 1);
    for (let i = 0; i < steps; i += 1) {
      this.playTone({
        frequency: base * (1 + i * 0.25),
        duration: 0.16,
        delay: i * 0.13,
        gain: 0.065 - i * 0.006,
        bus: "ui",
        pan: THREE.MathUtils.lerp(-0.32, 0.32, steps <= 1 ? 0.5 : i / (steps - 1)),
        type: "triangle"
      });
    }
    const scoreLift = THREE.MathUtils.clamp(totalScore / 3200, 0.25, 1.45);
    this.playRumble(0.12 * scoreLift, 0.72, completed ? 72 : 44, completed ? 34 : 24, 0, 0.05);
    this.playNoiseBurst(completed ? 0.035 : 0.02, completed ? 0.46 : 0.28, 0, 400, completed ? 3600 : 1500, 0.1, "ui");
  }

  playCannonFire(projectileId: ProjectileId, powerScale: number, sizeScale: number): void {
    this.resume();
    const intensity = THREE.MathUtils.clamp(0.72 + powerScale * 0.34 + sizeScale * 0.18, 0.75, 1.55);
    const pan = -0.05 + (Math.random() - 0.5) * 0.1;
    const muzzleSample = projectileId === "gravity" || projectileId === "slug" ? "muzzleA" : "muzzleB";
    this.playBuffer(muzzleSample, {
      gain: 0.34 * intensity,
      rate: this.randomRange(0.76, 0.92),
      pan,
      highpass: 80,
      lowpass: projectileId === "pulse" ? 5400 : 3600
    });
    this.playRumble(0.12 * intensity, 0.24, 78, 38, pan, 0.015);
    this.playNoiseBurst(0.1 * intensity, 0.18, pan, 520, 2600, 0.006);
  }

  playProjectileImpact(options: ImpactOptions): void {
    const pan = this.panFromPoint(options.point);
    const intensity = this.impactIntensity(options.result, options.powerScale, options.sizeScale);
    const blastSamples = PROJECTILE_BLASTS[options.projectileId];
    const materialIds = this.materialIdsFromResult(options.result, options.hitMaterialId);
    this.playBuffer(this.pick(blastSamples), {
      gain: 0.62 * intensity,
      rate: this.randomRange(0.64, 0.84),
      pan,
      lowpass: 3200
    });
    this.playBuffer(this.pick(["lowBoomA", "lowBoomB"]), {
      gain: 0.55 * intensity,
      rate: this.randomRange(0.58, 0.76),
      delay: 0.018,
      pan,
      lowpass: 900
    });
    this.playMaterialHits(materialIds, intensity, pan, 0.05, Math.min(7, 2 + options.result.fracturedBodies));
    this.playRumble(0.33 * intensity, 1.1 + intensity * 0.34, 42, 18, pan, 0.02);
    this.playNoiseBurst(0.18 * intensity, 0.48, pan, 160, 1800, 0.035);

    if (options.result.fracturedBodies >= 4 || options.projectileId === "gravity") {
      this.playDebrisTail(materialIds, intensity, pan);
    }
  }

  playChainImpact(options: ChainImpactOptions): void {
    if (!this.canPlay("chain", 72)) {
      return;
    }
    const pan = this.panFromPoint(options.point);
    const intensity = THREE.MathUtils.clamp(
      0.34 + options.relativeSpeed * 0.055 + options.result.fracturedBodies * 0.12,
      0.38,
      1.28
    );
    this.playBuffer(this.pick(MATERIAL_SAMPLES[options.materialId]), {
      gain: 0.28 * intensity,
      rate: this.randomRange(0.78, 1.12),
      pan,
      highpass: 90,
      lowpass: 4200
    });
    this.playNoiseBurst(0.06 * intensity, 0.16, pan, 420, 3400, 0.012);
  }

  playScatterBurst(point: THREE.Vector3, intensity: number): void {
    const pan = this.panFromPoint(point);
    this.playMaterialHits(["metal", "metal", "glass"], THREE.MathUtils.clamp(intensity, 0.75, 1.8), pan, 0.02, 5);
    this.playNoiseBurst(0.1 * intensity, 0.22, pan, 900, 5200, 0.015);
  }

  playGravityCrush(point: THREE.Vector3, intensity: number): void {
    const pan = this.panFromPoint(point);
    const loudness = THREE.MathUtils.clamp(intensity, 0.75, 2);
    this.playBuffer("bellHeavy", {
      gain: 0.42 * loudness,
      rate: this.randomRange(0.46, 0.58),
      pan,
      lowpass: 1900
    });
    this.playRumble(0.44 * loudness, 1.35, 34, 12, pan, 0.015);
  }

  private async loadSamples(): Promise<void> {
    if (this.loading) {
      return this.loading;
    }
    const context = this.ensureAudio();
    if (!context) {
      return;
    }
    this.loading = Promise.all(
      SAMPLE_IDS.map(async (id) => {
        const response = await fetch(assetUrl(SAMPLE_PATHS[id]));
        if (!response.ok) {
          throw new Error(`Audio asset failed to load: ${SAMPLE_PATHS[id]} (${response.status})`);
        }
        const data = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(data);
        this.buffers.set(id, buffer);
      })
    )
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn(error);
      });
    return this.loading;
  }

  private ensureAudio(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    const context = new AudioContextCtor();
    const master = context.createGain();
    const sfxBus = context.createGain();
    const uiBus = context.createGain();
    const rumbleBus = context.createGain();

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 16;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.24;

    sfxBus.connect(master);
    uiBus.connect(master);
    rumbleBus.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.sfxBus = sfxBus;
    this.uiBus = uiBus;
    this.rumbleBus = rumbleBus;
    this.noiseBuffer = this.createNoiseBuffer(context);
    this.applyMix();
    return context;
  }

  private playBuffer(id: SampleId, options: BufferPlayOptions): void {
    const context = this.ensureAudio();
    const output = this.outputForBus("sfx");
    const buffer = this.buffers.get(id);
    if (!context || !output || !buffer) {
      return;
    }
    const time = context.currentTime + (options.delay ?? 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    source.detune.value = options.detune ?? this.randomRange(-45, 45);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.09, buffer.duration / Math.max(0.4, options.rate ?? 1)));

    const panner = context.createStereoPanner();
    panner.pan.value = THREE.MathUtils.clamp(options.pan ?? 0, -0.85, 0.85);

    let current: AudioNode = source;
    if (options.highpass) {
      const filter = context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = options.highpass;
      current.connect(filter);
      current = filter;
    }
    if (options.lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      filter.Q.value = 0.4;
      current.connect(filter);
      current = filter;
    }

    current.connect(gain);
    gain.connect(panner);
    panner.connect(output);
    source.start(time);
  }

  private playMaterialHits(materialIds: MaterialId[], intensity: number, pan: number, startDelay: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const materialId = materialIds[i % materialIds.length] ?? "concrete";
      this.playBuffer(this.pick(MATERIAL_SAMPLES[materialId]), {
        gain: (0.11 + Math.random() * 0.08) * intensity,
        rate: this.randomRange(0.72, 1.18),
        delay: startDelay + i * this.randomRange(0.035, 0.095),
        pan: THREE.MathUtils.clamp(pan + this.randomRange(-0.18, 0.18), -0.85, 0.85),
        highpass: materialId === "glass" ? 320 : 70,
        lowpass: materialId === "glass" ? 6200 : 3600
      });
    }
  }

  private playDebrisTail(materialIds: MaterialId[], intensity: number, pan: number): void {
    for (let i = 0; i < 5; i += 1) {
      const materialId = materialIds[i % materialIds.length] ?? "concrete";
      this.playBuffer(this.pick(MATERIAL_SAMPLES[materialId]), {
        gain: (0.055 + Math.random() * 0.035) * intensity,
        rate: this.randomRange(0.64, 1.08),
        delay: 0.35 + i * this.randomRange(0.12, 0.24),
        pan: THREE.MathUtils.clamp(pan + this.randomRange(-0.34, 0.34), -0.9, 0.9),
        highpass: 120,
        lowpass: 2800
      });
    }
  }

  private playRumble(gainValue: number, duration: number, startFrequency: number, endFrequency: number, pan: number, delay = 0): void {
    const context = this.ensureAudio();
    const output = this.outputForBus("rumble");
    if (!context || !output) {
      return;
    }
    const time = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(startFrequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(8, endFrequency), time + duration);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), time + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const panner = context.createStereoPanner();
    panner.pan.value = THREE.MathUtils.clamp(pan * 0.45, -0.45, 0.45);

    oscillator.connect(gain);
    gain.connect(panner);
    panner.connect(output);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.08);
  }

  private playNoiseBurst(
    gainValue: number,
    duration: number,
    pan: number,
    lowFrequency: number,
    highFrequency: number,
    delay = 0,
    bus: AudioBus = "sfx"
  ): void {
    const context = this.ensureAudio();
    const output = this.outputForBus(bus);
    if (!context || !output || !this.noiseBuffer) {
      return;
    }
    const time = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const bandpass = context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(Math.sqrt(lowFrequency * highFrequency), time);
    bandpass.Q.value = 0.72;

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(highFrequency, time);
    lowpass.frequency.exponentialRampToValueAtTime(Math.max(lowFrequency, 90), time + duration);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const panner = context.createStereoPanner();
    panner.pan.value = THREE.MathUtils.clamp(pan, -0.85, 0.85);

    source.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(panner);
    panner.connect(output);
    source.start(time);
    source.stop(time + duration + 0.04);
  }

  private playTone(options: {
    frequency: number;
    duration: number;
    gain: number;
    bus: AudioBus;
    delay?: number;
    pan?: number;
    type?: OscillatorType;
    lowpass?: number;
  }): void {
    const context = this.ensureAudio();
    const output = this.outputForBus(options.bus);
    if (!context || !output) {
      return;
    }
    const time = context.currentTime + (options.delay ?? 0);
    const oscillator = context.createOscillator();
    oscillator.type = options.type ?? "sine";
    oscillator.frequency.setValueAtTime(Math.max(20, options.frequency), time);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.035, options.duration));

    const panner = context.createStereoPanner();
    panner.pan.value = THREE.MathUtils.clamp(options.pan ?? 0, -0.85, 0.85);

    let current: AudioNode = oscillator;
    if (options.lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      filter.Q.value = 0.5;
      current.connect(filter);
      current = filter;
    }

    current.connect(gain);
    gain.connect(panner);
    panner.connect(output);
    oscillator.start(time);
    oscillator.stop(time + options.duration + 0.04);
  }

  private applyMix(): void {
    if (this.master) {
      this.master.gain.value = this.mix.master;
    }
    if (this.sfxBus) {
      this.sfxBus.gain.value = this.mix.sfx;
    }
    if (this.uiBus) {
      this.uiBus.gain.value = this.mix.ui;
    }
    if (this.rumbleBus) {
      this.rumbleBus.gain.value = this.mix.rumble;
    }
  }

  private outputForBus(bus: AudioBus): GainNode | null {
    switch (bus) {
      case "sfx":
        return this.sfxBus ?? this.master;
      case "ui":
        return this.uiBus ?? this.master;
      case "rumble":
        return this.rumbleBus ?? this.master;
    }
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 1.5);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) + (Math.random() * 2 - 1) * 0.22;
    }
    return buffer;
  }

  private impactIntensity(result: ExplosionResult, powerScale: number, sizeScale: number): number {
    const fractureWeight = result.fracturedBodies * 0.24;
    const bodyWeight = result.affectedBodies * 0.035;
    const damageWeight = (result.structureDamage + result.materialChaos) / 520;
    return THREE.MathUtils.clamp(0.58 + fractureWeight + bodyWeight + damageWeight + powerScale * 0.18 + sizeScale * 0.12, 0.66, 2.25);
  }

  private materialIdsFromResult(result: ExplosionResult, fallback?: MaterialId): MaterialId[] {
    const ids = result.affectedObjects
      .filter((object) => object.fractured)
      .sort((a, b) => b.weightedDamage - a.weightedDamage)
      .map((object) => object.materialId);
    if (fallback) {
      ids.unshift(fallback);
    }
    return ids.length > 0 ? ids.slice(0, 6) : ["concrete"];
  }

  private panFromPoint(point: THREE.Vector3): number {
    return THREE.MathUtils.clamp(point.x / 18, -0.85, 0.85);
  }

  private canPlay(key: string, cooldownMs: number): boolean {
    const now = performance.now();
    if ((this.cooldowns.get(key) ?? 0) > now) {
      return false;
    }
    this.cooldowns.set(key, now + cooldownMs);
    return true;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
  }

  private randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

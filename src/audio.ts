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
  | "bellHeavy"
  | "urbanExplosion"
  | "mortarExplosion"
  | "bombardmentBroadside"
  | "cannonballImpact"
  | "buildingRubbleCollapse"
  | "glassRubbleCollapse"
  | "fallingRockCollapse"
  | "massiveWallCollapseTail";

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
  role?: "primary" | "secondary" | "ignition";
}

interface ChainImpactOptions {
  point: THREE.Vector3;
  result: ExplosionResult;
  relativeSpeed: number;
  materialId: MaterialId;
  role?: "chain" | "surface" | "penetration";
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
  bellHeavy: "audio/kenney-impact/impactBell_heavy_001.ogg",
  urbanExplosion: "audio/sonniss-gdc/urban-explosion.ogg",
  mortarExplosion: "audio/sonniss-gdc/mortar-explosion.ogg",
  bombardmentBroadside: "audio/sonniss-gdc/bombardment-broadside.ogg",
  cannonballImpact: "audio/sonniss-gdc/cannonball-impact.ogg",
  buildingRubbleCollapse: "audio/sonniss-gdc/building-rubble-collapse.ogg",
  glassRubbleCollapse: "audio/sonniss-gdc/glass-rubble-collapse.ogg",
  fallingRockCollapse: "audio/sonniss-gdc/falling-rock-collapse.ogg",
  massiveWallCollapseTail: "audio/sonniss-gdc/massive-wall-collapse-tail.ogg"
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
  slug: ["urbanExplosion", "mortarExplosion", "cannonballImpact"],
  scatter: ["mortarExplosion", "glassRubbleCollapse", "plateHeavyA"],
  pulse: ["urbanExplosion", "forceField", "lowBoomB"],
  gravity: ["bombardmentBroadside", "urbanExplosion", "cannonballImpact"],
  ignite: ["urbanExplosion", "mortarExplosion", "lowBoomB"]
};

const SAMPLE_IDS = Object.keys(SAMPLE_PATHS) as SampleId[];
const COLLAPSE_SAMPLES: SampleId[] = ["buildingRubbleCollapse", "fallingRockCollapse", "massiveWallCollapseTail"];
const SHORT_RUBBLE_SAMPLES: SampleId[] = ["cannonballImpact", "glassRubbleCollapse", "fallingRockCollapse"];
const DEFAULT_MIX: AudioMixSettings = {
  master: 0.88,
  sfx: 0.96,
  ui: 0.8,
  rumble: 0.86
};
const PRIMARY_IMPACT_TRANSIENT_GAIN = 0.16;
const PRIMARY_IMPACT_TRANSIENT_DURATION = 0.075;
const CHAIN_IMPACT_TRANSIENT_GAIN = 0.018;
const HAZARD_WARNING_COOLDOWN_MS = 95;

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

  playHazardWarning(point: THREE.Vector3, progress: number, materialId: MaterialId): void {
    if (!this.canPlay("hazard-warning", HAZARD_WARNING_COOLDOWN_MS)) {
      return;
    }
    const urgency = THREE.MathUtils.clamp(progress, 0, 1);
    const pan = this.panFromPoint(point);
    const baseFrequency = hazardWarningFrequency(materialId);
    this.playTone({
      frequency: baseFrequency * (1 + urgency * 0.46),
      duration: 0.052,
      gain: 0.018 + urgency * 0.025,
      bus: "sfx",
      pan,
      type: materialId === "metal" || materialId === "glass" ? "triangle" : "sawtooth",
      lowpass: materialId === "wood" || materialId === "foam" ? 1200 : 3200
    });
    if (materialId === "wood" || materialId === "foam" || materialId === "rubber") {
      this.playNoiseBurst(0.012 + urgency * 0.012, 0.07, pan, 480, 2400, 0.005);
    }
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
    const muzzleSample = projectileId === "scatter" ? "mortarExplosion" : "bombardmentBroadside";
    this.playBuffer(muzzleSample, {
      gain: 0.46 * intensity,
      rate: projectileId === "gravity" ? this.randomRange(0.7, 0.82) : this.randomRange(0.82, 0.98),
      pan,
      highpass: 34,
      lowpass: projectileId === "pulse" ? 5200 : 4200
    });
    this.playBuffer("cannonballImpact", {
      gain: 0.13 * intensity,
      rate: this.randomRange(0.78, 0.94),
      delay: 0.035,
      pan,
      highpass: 80,
      lowpass: 2800
    });
    this.playRumble(0.2 * intensity, 0.5, 62, 24, pan, 0.015);
    this.playNoiseBurst(0.08 * intensity, 0.18, pan, 420, 2200, 0.006);
  }

  playProjectileImpact(options: ImpactOptions): void {
    const pan = this.panFromPoint(options.point);
    const intensity = this.impactIntensity(options.result, options.powerScale, options.sizeScale);
    const blastSamples = PROJECTILE_BLASTS[options.projectileId];
    const materialIds = this.materialIdsFromResult(options.result, options.hitMaterialId);
    const role = options.role ?? "primary";
    this.playImpactTransient(options.point, intensity, materialIds[0] ?? options.hitMaterialId ?? "concrete", role);
    this.playBuffer(this.pick(blastSamples), {
      gain: 0.7 * intensity,
      rate: this.randomRange(0.78, 1.03),
      pan,
      highpass: 28,
      lowpass: 5200
    });
    this.playBuffer(this.pick(["lowBoomA", "lowBoomB"]), {
      gain: 0.36 * intensity,
      rate: this.randomRange(0.58, 0.76),
      delay: 0.018,
      pan,
      lowpass: 900
    });
    const collapseWeight = this.collapseWeight(options.result);
    const materialHitCount = Math.min(4, Math.max(1, Math.ceil(options.result.fracturedBodies / 3)));
    this.playMaterialHits(materialIds, intensity, pan, 0.05, materialHitCount, collapseWeight >= 5.5 ? 0.82 : 0.58);
    this.playRumble(0.4 * intensity, 1.35 + intensity * 0.46, 38, 14, pan, 0.02);
    this.playNoiseBurst(0.18 * intensity, 0.48, pan, 160, 1800, 0.035);

    if (collapseWeight >= 3.2 || options.projectileId === "gravity") {
      this.playDebrisTail(materialIds, intensity, pan);
      this.playCollapseLayer(materialIds, intensity, pan, collapseWeight >= 7.5 ? "major" : "medium", 0.08);
    }
    if (role === "primary" && (collapseWeight >= 5.8 || intensity > 1.35)) {
      this.playBuffer(this.pick(["massiveWallCollapseTail", "urbanExplosion"]), {
        gain: 0.2 * intensity,
        rate: this.randomRange(0.52, 0.7),
        delay: 0.2,
        pan,
        lowpass: 680
      });
      this.playRumble(0.18 * intensity, 1.8, 28, 8, pan, 0.16);
    }
  }

  playChainImpact(options: ChainImpactOptions): void {
    const role = options.role ?? "chain";
    const collapseWeight = this.collapseWeight(options.result);
    const audibleThreshold = role === "surface" ? 4.2 : role === "penetration" ? 2.4 : 3.1;
    const speedThreshold = role === "surface" ? 12.5 : role === "penetration" ? 8.4 : 10.2;
    if (collapseWeight < audibleThreshold && options.relativeSpeed < speedThreshold) {
      return;
    }
    if (!this.canPlay(`chain-${role}`, role === "surface" ? 150 : 110)) {
      return;
    }
    const pan = this.panFromPoint(options.point);
    const intensity = THREE.MathUtils.clamp(
      0.26 + options.relativeSpeed * 0.045 + options.result.fracturedBodies * 0.1 + collapseWeight * 0.035,
      0.32,
      1.42
    );
    if (collapseWeight >= 4.6 || options.relativeSpeed > 12.8) {
      this.playBuffer(this.pick(MATERIAL_SAMPLES[options.materialId]), {
        gain: (role === "surface" ? 0.08 : 0.12) * intensity,
        rate: this.randomRange(0.58, 0.86),
        pan,
        highpass: options.materialId === "glass" ? 160 : 36,
        lowpass: options.materialId === "glass" ? 4600 : 1800
      });
      this.playImpactTransient(options.point, intensity * 0.8, options.materialId, "secondary", 0.01);
    }
    this.playNoiseBurst(0.028 * intensity, 0.2, pan, 120, 1300, 0.018);
    if (collapseWeight >= 5.2 || options.result.fracturedBodies >= 3 || options.relativeSpeed > 13.5) {
      this.playCollapseLayer([options.materialId], intensity, pan, collapseWeight >= 7.2 ? "major" : "medium", 0.045);
      this.playRumble(0.07 * intensity, 0.55, 42, 14, pan, 0.04);
    }
  }

  playScatterBurst(point: THREE.Vector3, intensity: number): void {
    const pan = this.panFromPoint(point);
    this.playMaterialHits(["metal", "glass"], THREE.MathUtils.clamp(intensity, 0.7, 1.55), pan, 0.02, 3, 0.54);
    this.playNoiseBurst(0.072 * intensity, 0.22, pan, 760, 4200, 0.015);
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
    this.playBuffer("massiveWallCollapseTail", {
      gain: 0.2 * loudness,
      rate: this.randomRange(0.68, 0.82),
      delay: 0.08,
      pan,
      highpass: 34,
      lowpass: 2200
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

  private playMaterialHits(materialIds: MaterialId[], intensity: number, pan: number, startDelay: number, count: number, gainScale = 1): void {
    for (let i = 0; i < count; i += 1) {
      const materialId = materialIds[i % materialIds.length] ?? "concrete";
      this.playBuffer(this.pick(MATERIAL_SAMPLES[materialId]), {
        gain: (0.085 + Math.random() * 0.045) * intensity * gainScale,
        rate: this.randomRange(0.62, 0.98),
        delay: startDelay + i * this.randomRange(0.055, 0.13),
        pan: THREE.MathUtils.clamp(pan + this.randomRange(-0.12, 0.12), -0.85, 0.85),
        highpass: materialId === "glass" ? 220 : 44,
        lowpass: materialId === "glass" ? 5200 : 2400
      });
    }
  }

  private playDebrisTail(materialIds: MaterialId[], intensity: number, pan: number): void {
    this.playCollapseLayer(materialIds, intensity, pan, "medium", 0.12);
    for (let i = 0; i < 2; i += 1) {
      const materialId = materialIds[i % materialIds.length] ?? "concrete";
      this.playBuffer(this.pick(MATERIAL_SAMPLES[materialId]), {
        gain: (0.028 + Math.random() * 0.018) * intensity,
        rate: this.randomRange(0.54, 0.86),
        delay: 0.42 + i * this.randomRange(0.18, 0.32),
        pan: THREE.MathUtils.clamp(pan + this.randomRange(-0.22, 0.22), -0.9, 0.9),
        highpass: 42,
        lowpass: materialId === "glass" ? 4600 : 1900
      });
    }
  }

  private playCollapseLayer(materialIds: MaterialId[], intensity: number, pan: number, scale: "small" | "medium" | "major", delay: number): void {
    const cooldown = scale === "major" ? 520 : scale === "medium" ? 320 : 170;
    if (!this.canPlay(`collapse-${scale}`, cooldown)) {
      return;
    }
    const material = materialIds[0] ?? "concrete";
    const sample = material === "glass" ? "glassRubbleCollapse" : scale === "major" ? "massiveWallCollapseTail" : this.pick(COLLAPSE_SAMPLES);
    const gainScale = scale === "major" ? 0.42 : scale === "medium" ? 0.26 : 0.08;
    this.playBuffer(sample, {
      gain: gainScale * THREE.MathUtils.clamp(intensity, 0.58, 2.2),
      rate: scale === "major" ? this.randomRange(0.58, 0.76) : this.randomRange(0.72, 0.92),
      delay,
      pan: THREE.MathUtils.clamp(pan + this.randomRange(-0.08, 0.08), -0.9, 0.9),
      highpass: material === "glass" ? 64 : 22,
      lowpass: material === "glass" ? 6800 : scale === "major" ? 2100 : 3400
    });
    if (scale !== "major") {
      this.playBuffer(this.pick(SHORT_RUBBLE_SAMPLES), {
        gain: 0.026 * THREE.MathUtils.clamp(intensity, 0.5, 1.6),
        rate: this.randomRange(0.62, 0.92),
        delay: delay + this.randomRange(0.05, 0.16),
        pan: THREE.MathUtils.clamp(pan + this.randomRange(-0.12, 0.12), -0.9, 0.9),
        highpass: 70,
        lowpass: material === "glass" ? 6200 : 2600
      });
    }
  }

  private playImpactTransient(
    point: THREE.Vector3,
    intensity: number,
    materialId: MaterialId,
    role: NonNullable<ImpactOptions["role"]>,
    delay = 0
  ): void {
    const pan = this.panFromPoint(point);
    const roleScale = role === "primary" ? 1 : role === "secondary" ? 0.54 : 0.72;
    const transientGain =
      role === "secondary" ? CHAIN_IMPACT_TRANSIENT_GAIN : PRIMARY_IMPACT_TRANSIENT_GAIN * roleScale;
    this.playNoiseBurst(
      transientGain * THREE.MathUtils.clamp(intensity, 0.55, 1.9),
      PRIMARY_IMPACT_TRANSIENT_DURATION,
      pan,
      materialId === "glass" ? 1500 : 850,
      materialId === "metal" || materialId === "glass" ? 7200 : 4800,
      delay
    );
    this.playBuffer(this.pick(MATERIAL_SAMPLES[materialId]), {
      gain: 0.034 * roleScale * THREE.MathUtils.clamp(intensity, 0.5, 1.8),
      rate: materialId === "metal" ? this.randomRange(0.82, 0.98) : this.randomRange(0.88, 1.18),
      delay: delay + 0.004,
      pan,
      highpass: materialId === "glass" ? 460 : 120,
      lowpass: materialId === "glass" ? 7600 : 5200
    });
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

  private collapseWeight(result: ExplosionResult): number {
    const maxDamage = result.affectedObjects.reduce((max, object) => Math.max(max, object.weightedDamage), 0);
    const structuralLabels = result.affectedObjects.filter((object) => {
      if (!object.fractured) {
        return false;
      }
      const text = `${object.label} ${object.zoneId ?? ""}`.toLowerCase();
      return (
        object.scoreRole === "target" ||
        text.includes("silo") ||
        text.includes("skyneedle") ||
        text.includes("metro") ||
        text.includes("crane") ||
        text.includes("scaffold") ||
        text.includes("reactor") ||
        text.includes("substation") ||
        text.includes("propane") ||
        text.includes("boss")
      );
    }).length;
    return (
      result.fracturedBodies * 0.95 +
      result.affectedBodies * 0.08 +
      Math.min(7, (result.structureDamage + result.materialChaos) / 220) +
      Math.min(5, maxDamage / 180) +
      Math.min(4, structuralLabels * 0.9)
    );
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

function hazardWarningFrequency(materialId: MaterialId): number {
  switch (materialId) {
    case "glass":
      return 720;
    case "metal":
      return 640;
    case "concrete":
      return 410;
    case "wood":
      return 330;
    case "foam":
      return 290;
    case "rubber":
      return 260;
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

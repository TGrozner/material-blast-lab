import type { PerfFrameSnapshot, PerfReport } from "./perf";

export interface PerfFrameSummary {
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
  renderMs: number;
  physicsStepMs: number;
  rapierMs: number;
  impactsMs: number;
  fractureMs: number;
  queuedFractureMs: number;
  addBoxMs: number;
  vfxExplodeMs: number;
  fragments: number;
  dynamicBoxes: number;
  particles: number;
  visualOnlyFragments: number;
  physicalFragments: number;
  boxCacheMiss: number;
  childBoxCacheMiss: number;
  frozenRubbleBuckets: number;
  stagedActivated: number;
  droppedSubsteps: number;
}

export interface PerfDiskLogSummary {
  frameCount: number;
  slowFrameCount: number;
  slowRatioPercent: number;
  shotFrameCount: number;
  maxFrame: PerfFrameSummary | null;
  shotMax: {
    totalMs: number;
    renderMs: number;
    physicsStepMs: number;
    rapierMs: number;
    fractureMs: number;
    queuedFractureMs: number;
    addBoxMs: number;
    particlesInFrame: number;
    visualOnlyFragmentsInFrame: number;
    physicalFragmentsInFrame: number;
    fragmentsInFrame: number;
    boxCacheMissesInFrame: number;
    childBoxCacheMissesInFrame: number;
    droppedSubstepsInFrame: number;
  };
  shotTotals: {
    fragments: number;
    dynamicBoxes: number;
    particles: number;
    visualOnlyFragments: number;
    physicalFragments: number;
    boxCacheMisses: number;
    childBoxCacheMisses: number;
    frozenRubbleBuckets: number;
    stagedActivated: number;
    droppedSubsteps: number;
  };
  topShotSlowFrames: PerfFrameSummary[];
  topAllSlowFrames: PerfFrameSummary[];
}

type ShotMax = PerfDiskLogSummary["shotMax"];
type ShotTotals = PerfDiskLogSummary["shotTotals"];

interface ShotPerfAccumulator {
  count: number;
  max: ShotMax;
  totals: ShotTotals;
  topFrames: PerfFrameSummary[];
}

export function summarizePerfReport(report: PerfReport): PerfDiskLogSummary {
  const shotStats = createShotPerfAccumulator();
  const topAllSlowFrames: PerfFrameSummary[] = [];

  for (const frame of report.recentSlowFrames) {
    pushTopPerfFrame(topAllSlowFrames, frame);
    if (isShotPerfFrame(frame)) {
      updateShotPerfAccumulator(shotStats, frame);
    }
  }

  return {
    frameCount: report.frameCount,
    slowFrameCount: report.slowFrameCount,
    slowRatioPercent: Math.round((report.slowFrameCount / Math.max(1, report.frameCount)) * 1000) / 10,
    shotFrameCount: shotStats.count,
    maxFrame: report.maxFrame ? summarizePerfFrame(report.maxFrame) : null,
    shotMax: shotStats.max,
    shotTotals: roundShotTotals(shotStats.totals),
    topShotSlowFrames: shotStats.topFrames,
    topAllSlowFrames
  };
}

function createShotPerfAccumulator(): ShotPerfAccumulator {
  return {
    count: 0,
    max: createEmptyShotMax(),
    totals: createEmptyShotTotals(),
    topFrames: []
  };
}

function createEmptyShotMax(): ShotMax {
  return {
    totalMs: 0,
    renderMs: 0,
    physicsStepMs: 0,
    rapierMs: 0,
    fractureMs: 0,
    queuedFractureMs: 0,
    addBoxMs: 0,
    particlesInFrame: 0,
    visualOnlyFragmentsInFrame: 0,
    physicalFragmentsInFrame: 0,
    fragmentsInFrame: 0,
    boxCacheMissesInFrame: 0,
    childBoxCacheMissesInFrame: 0,
    droppedSubstepsInFrame: 0
  };
}

function createEmptyShotTotals(): ShotTotals {
  return {
    fragments: 0,
    dynamicBoxes: 0,
    particles: 0,
    visualOnlyFragments: 0,
    physicalFragments: 0,
    boxCacheMisses: 0,
    childBoxCacheMisses: 0,
    frozenRubbleBuckets: 0,
    stagedActivated: 0,
    droppedSubsteps: 0
  };
}

function updateShotPerfAccumulator(stats: ShotPerfAccumulator, frame: PerfFrameSnapshot): void {
  stats.count += 1;
  stats.max.totalMs = Math.max(stats.max.totalMs, frame.totalMs);
  stats.max.renderMs = Math.max(stats.max.renderMs, frame.timings["renderer.render"] ?? 0);
  stats.max.physicsStepMs = Math.max(stats.max.physicsStepMs, frame.timings["physics.step"] ?? 0);
  stats.max.rapierMs = Math.max(stats.max.rapierMs, frame.timings["physics.rapierStep"] ?? 0);
  stats.max.fractureMs = Math.max(stats.max.fractureMs, frame.timings["destruction.fracture"] ?? 0);
  stats.max.queuedFractureMs = Math.max(stats.max.queuedFractureMs, frame.timings["destruction.processQueuedFractures"] ?? 0);
  stats.max.addBoxMs = Math.max(stats.max.addBoxMs, frame.timings["physics.addDynamicBox"] ?? 0);
  stats.max.particlesInFrame = Math.max(stats.max.particlesInFrame, frame.counters["vfx.particlesSpawned"] ?? 0);
  stats.max.visualOnlyFragmentsInFrame = Math.max(
    stats.max.visualOnlyFragmentsInFrame,
    frame.counters["destruction.visualOnlyFragmentsCreated"] ?? 0
  );
  stats.max.physicalFragmentsInFrame = Math.max(
    stats.max.physicalFragmentsInFrame,
    frame.counters["destruction.physicalFragmentsCreated"] ?? 0
  );
  stats.max.fragmentsInFrame = Math.max(stats.max.fragmentsInFrame, frame.counters["destruction.fragmentsCreated"] ?? 0);
  stats.max.boxCacheMissesInFrame = Math.max(stats.max.boxCacheMissesInFrame, frame.counters["render.boxGeometryCacheMiss"] ?? 0);
  stats.max.childBoxCacheMissesInFrame = Math.max(
    stats.max.childBoxCacheMissesInFrame,
    frame.counters["render.childBoxGeometryCacheMiss"] ?? 0
  );
  stats.max.droppedSubstepsInFrame = Math.max(stats.max.droppedSubstepsInFrame, frame.counters["physics.substepsDropped"] ?? 0);

  stats.totals.fragments += frame.counters["destruction.fragmentsCreated"] ?? 0;
  stats.totals.dynamicBoxes += frame.counters["physics.dynamicBoxesAdded"] ?? 0;
  stats.totals.particles += frame.counters["vfx.particlesSpawned"] ?? 0;
  stats.totals.visualOnlyFragments += frame.counters["destruction.visualOnlyFragmentsCreated"] ?? 0;
  stats.totals.physicalFragments += frame.counters["destruction.physicalFragmentsCreated"] ?? 0;
  stats.totals.boxCacheMisses += frame.counters["render.boxGeometryCacheMiss"] ?? 0;
  stats.totals.childBoxCacheMisses += frame.counters["render.childBoxGeometryCacheMiss"] ?? 0;
  stats.totals.frozenRubbleBuckets += frame.counters["physics.frozenRubbleBucketsCreated"] ?? 0;
  stats.totals.stagedActivated += frame.counters["render.stagedVisualActivationsActivated"] ?? 0;
  stats.totals.droppedSubsteps += frame.counters["physics.substepsDropped"] ?? 0;
  pushTopPerfFrame(stats.topFrames, frame);
}

function roundShotTotals(totals: ShotTotals): ShotTotals {
  return {
    fragments: roundOneDecimal(totals.fragments),
    dynamicBoxes: roundOneDecimal(totals.dynamicBoxes),
    particles: roundOneDecimal(totals.particles),
    visualOnlyFragments: roundOneDecimal(totals.visualOnlyFragments),
    physicalFragments: roundOneDecimal(totals.physicalFragments),
    boxCacheMisses: roundOneDecimal(totals.boxCacheMisses),
    childBoxCacheMisses: roundOneDecimal(totals.childBoxCacheMisses),
    frozenRubbleBuckets: roundOneDecimal(totals.frozenRubbleBuckets),
    stagedActivated: roundOneDecimal(totals.stagedActivated),
    droppedSubsteps: roundOneDecimal(totals.droppedSubsteps)
  };
}

function summarizePerfFrame(frame: PerfFrameSnapshot): PerfFrameSummary {
  return {
    frame: frame.frame,
    totalMs: frame.totalMs,
    deltaMs: frame.deltaMs,
    bodyCount: frame.bodyCount,
    dynamicBodyCount: frame.dynamicBodyCount,
    awakeBodyCount: frame.awakeBodyCount,
    debrisBodyCount: frame.debrisBodyCount,
    awakeDebrisBodyCount: frame.awakeDebrisBodyCount,
    activeDebrisCount: frame.activeDebrisCount,
    frozenDebrisCount: frame.frozenDebrisCount,
    pendingSupportReleaseCount: frame.pendingSupportReleaseCount,
    accountedMs: frame.accountedMs,
    unattributedMs: frame.unattributedMs,
    renderMs: frame.timings["renderer.render"] ?? 0,
    physicsStepMs: frame.timings["physics.step"] ?? 0,
    rapierMs: frame.timings["physics.rapierStep"] ?? 0,
    impactsMs: frame.timings["game.processDebrisImpacts"] ?? 0,
    fractureMs: frame.timings["destruction.fracture"] ?? 0,
    queuedFractureMs: frame.timings["destruction.processQueuedFractures"] ?? 0,
    addBoxMs: frame.timings["physics.addDynamicBox"] ?? 0,
    vfxExplodeMs: frame.timings["vfx.explode"] ?? 0,
    fragments: frame.counters["destruction.fragmentsCreated"] ?? 0,
    dynamicBoxes: frame.counters["physics.dynamicBoxesAdded"] ?? 0,
    particles: frame.counters["vfx.particlesSpawned"] ?? 0,
    visualOnlyFragments: frame.counters["destruction.visualOnlyFragmentsCreated"] ?? 0,
    physicalFragments: frame.counters["destruction.physicalFragmentsCreated"] ?? 0,
    boxCacheMiss: frame.counters["render.boxGeometryCacheMiss"] ?? 0,
    childBoxCacheMiss: frame.counters["render.childBoxGeometryCacheMiss"] ?? 0,
    frozenRubbleBuckets: frame.counters["physics.frozenRubbleBucketsCreated"] ?? 0,
    stagedActivated: frame.counters["render.stagedVisualActivationsActivated"] ?? 0,
    droppedSubsteps: frame.counters["physics.substepsDropped"] ?? 0
  };
}

function isShotPerfFrame(frame: PerfFrameSnapshot): boolean {
  return Boolean(
    frame.timings["physics.step"] ||
      frame.timings["game.projectiles"] ||
      frame.timings["destruction.explode"] ||
      frame.counters["collision.chainDrained"] ||
      frame.counters["collision.surfaceDrained"] ||
      frame.counters["destruction.fragmentsCreated"] ||
      frame.counters["physics.dynamicBoxesAdded"] ||
      frame.counters["destruction.fracturesQueued"]
  );
}

function pushTopPerfFrame(topFrames: PerfFrameSummary[], frame: PerfFrameSnapshot): void {
  const summary = summarizePerfFrame(frame);
  let insertAt = topFrames.length;
  while (insertAt > 0 && topFrames[insertAt - 1].totalMs < summary.totalMs) {
    insertAt -= 1;
  }
  if (insertAt >= 10) {
    return;
  }
  topFrames.splice(insertAt, 0, summary);
  if (topFrames.length > 10) {
    topFrames.pop();
  }
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

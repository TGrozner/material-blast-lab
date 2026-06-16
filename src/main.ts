import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  loadArcadeProgress,
  recordArcadeRun,
  saveArcadeProgress,
  type ArcadeLevelDefinition,
  type ArcadeResult
} from "./arcade";
import { DestructionAudio } from "./audio";
import { BioGoreSystem } from "./bioGore";
import { CameraRig } from "./cameraRig";
import { Cannon } from "./cannon";
import { DestructionSystem, type ExplosionResult } from "./destruction";
import { InputController } from "./input";
import { TEST_CHAMBERS, type TestChamber } from "./levels";
import { MaterialCatalog } from "./materialCatalog";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import { PROJECTILES, ProjectileSystem, type ActiveProjectile, type ProjectileId } from "./projectile";
import { SeededRandom, createRunSeed, randomRange } from "./random";
import { ShotRunState } from "./runState";
import { ScorePopupLayer } from "./scorePopups";
import { ShotScoreTracker, type ScoreBreakdown, type ScoreEvent } from "./scoring";
import {
  DEFAULT_GAME_SETTINGS,
  type GameSettings,
  graphicsPixelRatioCap,
  loadGameSettings,
  saveGameSettings,
  sanitizeGameSettings
} from "./settings";
import { ExplosionSystem, ParticleSystem } from "./vfx";
import { GameUI } from "./ui";
import { graphicTexture } from "./visualAssets";

const DEFAULT_AIM_POINT = new THREE.Vector3(0, 0.16, -3.4);
const CHAIN_DEBRIS_MIN_SPEED = 1.85;
const CHAIN_DEBRIS_MIN_SPEED_SQ = CHAIN_DEBRIS_MIN_SPEED * CHAIN_DEBRIS_MIN_SPEED;
const CHAIN_IMPACT_COOLDOWN_MS = 220;
const CHAIN_IMPACT_MAX_PER_FRAME = 14;
const SCORE_SETTLED_SPEED = 1.55;
const MAX_PROJECTILE_PENETRATIONS: Record<ProjectileId, number> = {
  slug: 4,
  scatter: 0,
  pulse: 1,
  gel: 0,
  gravity: 3
};
const IMPACT_BOUNDS = {
  minX: -18.8,
  maxX: 18.8,
  minZ: -21.8,
  maxZ: 35.8
};
const ARCADE_LEVELS = TEST_CHAMBERS.map(chamberToArcadeLevel);

class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly materials = new MaterialCatalog();
  private readonly rng: SeededRandom;
  private readonly physics: PhysicsWorld;
  private readonly destruction: DestructionSystem;
  private readonly audio = new DestructionAudio();
  private readonly particles: ParticleSystem;
  private readonly explosion: ExplosionSystem;
  private readonly cameraRig: CameraRig;
  private readonly cannon: Cannon;
  private readonly projectiles: ProjectileSystem;
  private readonly bioGore: BioGoreSystem;
  private readonly scoreTracker = new ShotScoreTracker();
  private readonly runState = new ShotRunState();
  private readonly scorePopups: ScorePopupLayer;
  private readonly ui: GameUI;
  private readonly input: InputController;
  private readonly timer = new THREE.Timer();
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = DEFAULT_AIM_POINT.clone();
  private readonly aimMarkerMaterial = new THREE.MeshBasicMaterial({
    color: 0x8ff7ff,
    transparent: true,
    opacity: 0.84,
    depthWrite: false
  });
  private readonly aimMarker = createAimMarker(this.aimMarkerMaterial);
  private readonly arenaObjects: THREE.Object3D[] = [];
  private readonly levelDecorations: THREE.Object3D[] = [];
  private readonly chainImpactCooldowns = new Map<string, number>();
  private readonly surfaceImpactCooldowns = new Map<number, number>();

  private settings: GameSettings = loadGameSettings();
  private selectedProjectile: ProjectileId = "slug";
  private powerScale = 1;
  private sizeScale = 1;
  private levelIndex = 0;
  private arcadeProgress = loadArcadeProgress(ARCADE_LEVELS);
  private arcadeResult: ArcadeResult | null = null;
  private runSeed = createRunSeed();
  private status = "Aim the siege cannon from the high battery.";
  private slowMotionTimer = 0;
  private hitStopTimer = 0;
  private fpsSampleElapsed = 0;
  private fpsSampleFrames = 0;
  private displayedFps = 0;

  constructor() {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app");
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.settings.antialias,
      powerPreference: "high-performance"
    });
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(graphicsPixelRatioCap(this.settings.graphicsQuality));
    app.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x080b10);
    this.scene.fog = new THREE.Fog(0x080b10, 28, 78);
    this.timer.connect(document);

    this.rng = new SeededRandom(this.runSeed);
    this.cameraRig = new CameraRig(this.renderer);
    this.physics = new PhysicsWorld(this.scene);
    this.destruction = new DestructionSystem(this.physics, this.materials, this.rng);
    this.particles = new ParticleSystem(this.scene);
    this.explosion = new ExplosionSystem(this.particles);
    this.bioGore = new BioGoreSystem(this.physics, this.materials, this.particles);
    this.projectiles = new ProjectileSystem(this.physics, this.materials, this.rng);
    this.cannon = new Cannon(this.scene);
    this.scene.add(this.aimMarker);
    this.scorePopups = new ScorePopupLayer();

    this.ui = new GameUI({
      fire: () => this.fire(),
      reset: () => this.reset(),
      clearDebris: () => this.clearDebris(),
      selectProjectile: (id) => this.selectProjectile(id),
      nextLevel: () => this.nextLevel(),
      adjustPower: (delta) => this.adjustPower(delta),
      adjustSize: (delta) => this.adjustSize(delta),
      updateSettings: (patch) => this.updateSettings(patch),
      resetSettings: () => this.resetSettings()
    });

    this.input = new InputController(this.renderer.domElement, {
      aim: (pointer) => this.aim(pointer),
      fire: () => this.fire(),
      reset: () => this.reset(),
      clearDebris: () => this.clearDebris(),
      adjustPower: (delta) => this.adjustPower(delta),
      adjustSize: (delta) => this.adjustSize(delta),
      selectProjectile: (id) => this.selectProjectile(id),
      nextLevel: () => this.nextLevel()
    });

    this.configureLights();
    this.applySettings();
    this.buildArena();
    this.loadLevel();
    this.audio.preload();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.visualViewport?.addEventListener("resize", () => this.resize());
    window.addEventListener("beforeunload", () => this.input.dispose());
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.update());
  }

  private update(): void {
    this.timer.update();
    const frameDelta = this.timer.getDelta();
    const delta = Math.min(frameDelta, 0.05);
    this.updateFps(frameDelta);
    const motionEffectsActive = this.settings.motionEffects;
    const hitStopped = motionEffectsActive && this.hitStopTimer > 0;
    const slowMotionActive = motionEffectsActive && this.slowMotionTimer > 0;
    const timeScale = hitStopped ? 0 : slowMotionActive ? 0.32 : 1;
    const visualScale = hitStopped ? 0 : slowMotionActive ? 0.55 : 1;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - delta);
    }
    if (this.slowMotionTimer > 0) {
      this.slowMotionTimer = Math.max(0, this.slowMotionTimer - delta);
    }

    this.cannon.update(delta, PROJECTILES[this.selectedProjectile], this.powerScale, this.sizeScale);
    if (this.runState.phase !== "aim") {
      this.physics.step(delta * timeScale);
      this.projectiles.update(delta * timeScale);
    }
    const chainEvents = this.processDebrisImpacts();
    if (chainEvents.length > 0) {
      this.scorePopups.push(chainEvents);
    }
    this.updatePhase();
    this.particles.update(delta * visualScale);
    this.cameraRig.update(delta * visualScale);
    this.updateAimMarker();
    this.scorePopups.update(delta * visualScale, this.cameraRig.camera);
    this.ui.update({
      projectileId: this.selectedProjectile,
      projectile: PROJECTILES[this.selectedProjectile],
      powerScale: this.powerScale,
      sizeScale: this.sizeScale,
      shotAvailable: this.runState.shotAvailable,
      bodyCount: this.physics.getDynamicBodyCount(),
      levelName: this.currentLevel().name,
      levelDescription: this.currentLevel().description,
      objective: this.currentLevel().objective,
      protectedBrief: this.currentLevel().protectedBrief,
      mission: this.currentLevel().mission,
      levelIndex: this.levelIndex,
      levelCount: TEST_CHAMBERS.length,
      levelProgress: this.currentLevelProgress(),
      totalStars: this.arcadeProgress.totalStars,
      arcadeResult: this.arcadeResult,
      settings: this.settings,
      status: this.status,
      fps: this.displayedFps,
      score: this.runState.score
    });
    this.renderer.render(this.scene, this.cameraRig.camera);
  }

  private updateFps(delta: number): void {
    this.fpsSampleElapsed += delta;
    this.fpsSampleFrames += 1;
    if (this.fpsSampleElapsed >= 0.35) {
      this.displayedFps = Math.round(this.fpsSampleFrames / this.fpsSampleElapsed);
      this.fpsSampleElapsed = 0;
      this.fpsSampleFrames = 0;
    }
  }

  private updatePhase(): void {
    const active = this.projectiles.getActive();
    if (this.runState.phase === "aim") {
      this.cannon.setTrajectoryVisible(true);
      this.cameraRig.setCityAimView(this.cannon.getCameraAnchor());
      return;
    }

    this.cannon.setTrajectoryVisible(false);
    if (this.runState.phase === "flight" && active) {
      const position = vectorFromRapier(active.object.body.translation());
      const velocity = vectorFromRapier(active.object.body.linvel());
      this.cameraRig.followProjectile(position, velocity);
      const impact = this.detectImpact(active);
      if (impact || active.age > 7.5) {
        this.handleImpact(impact?.point ?? position, active, impact?.object ?? null);
      }
      return;
    }

    const scoreRevealDecision = this.runState.evaluateScoreReveal(performance.now(), this.isSceneSettled());
    if (scoreRevealDecision === "waiting") {
      this.status = "Scoring active chain reactions...";
      return;
    }
    if (scoreRevealDecision === "ready") {
      const score = this.scoreTracker.finalize(this.physics);
      this.runState.markScored(score);
      const recorded = recordArcadeRun(this.arcadeProgress, ARCADE_LEVELS, this.currentLevel().id, score);
      this.arcadeProgress = recorded.progress;
      this.arcadeResult = recorded.result;
      saveArcadeProgress(this.arcadeProgress);
      this.audio.playScoreCeremony(score.totalScore, recorded.result.stars, recorded.result.completed);
      this.status = scoreStatus(score, recorded.result);
    }
  }

  private configureLights(): void {
    const ambient = new THREE.AmbientLight(0xb6c6d5, 0.52);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xf7fbff, 3.4);
    key.position.set(7, 11, 6);
    key.castShadow = false;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -22;
    key.shadow.camera.right = 22;
    key.shadow.camera.top = 22;
    key.shadow.camera.bottom = -22;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x6aa7ff, 1.05);
    rim.position.set(-7, 5, -8);
    this.scene.add(rim);
  }

  private buildArena(): void {
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x15191d,
      roughness: 0.82,
      metalness: 0.08,
      map: graphicTexture("arenaFloor", { repeat: [7, 11], anisotropy: 8 })
    });
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e2730,
      roughness: 0.72,
      metalness: 0.05,
      map: graphicTexture("arenaWall", { repeat: [5, 1], anisotropy: 8 })
    });
    const cannonDeckMaterial = new THREE.MeshStandardMaterial({
      color: 0x27313a,
      roughness: 0.76,
      metalness: 0.08,
      map: graphicTexture("cannonDeck", { repeat: [2.2, 1.6], anisotropy: 8 })
    });

    const floor = this.physics.addStaticBox({
      label: "Siege range floor",
      position: new THREE.Vector3(0, -0.1, 7),
      size: new THREE.Vector3(38, 0.2, 58),
      material: floorMaterial
    });
    this.arenaObjects.push(floor);

    const wallSpecs = [
      { position: new THREE.Vector3(0, 0.55, -22), size: new THREE.Vector3(38, 1.1, 0.35) },
      { position: new THREE.Vector3(0, 0.55, 36), size: new THREE.Vector3(38, 1.1, 0.35) },
      { position: new THREE.Vector3(-19, 0.55, 7), size: new THREE.Vector3(0.35, 1.1, 58) },
      { position: new THREE.Vector3(19, 0.55, 7), size: new THREE.Vector3(0.35, 1.1, 58) }
    ];
    for (const spec of wallSpecs) {
      const wall = this.physics.addStaticBox({ label: "Arena wall", material: wallMaterial, ...spec });
      wall.castShadow = true;
      this.arenaObjects.push(wall);
    }

    const cannonDeck = this.addArenaVisualBox(
      "High siege battery",
      new THREE.Vector3(0, 2.85, 26.45),
      new THREE.Vector3(6.4, 5.7, 4.8),
      cannonDeckMaterial
    );
    cannonDeck.castShadow = true;
    this.arenaObjects.push(cannonDeck);

    for (const x of [-3.3, 3.3]) {
      const curb = this.addArenaVisualBox(
        "Cannon deck curb",
        new THREE.Vector3(x, 5.86, 26.45),
        new THREE.Vector3(0.22, 0.32, 4.7),
        cannonDeckMaterial
      );
      curb.castShadow = true;
      this.arenaObjects.push(curb);
    }

    const grid = new THREE.GridHelper(38, 76, 0x3f8da0, 0x26333a);
    grid.position.z = 7;
    grid.position.y = 0.012;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.scene.add(grid);
    this.arenaObjects.push(grid);
  }

  private addArenaVisualBox(
    label: string,
    position: THREE.Vector3,
    size: THREE.Vector3,
    material: THREE.Material
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.name = label;
    mesh.position.copy(position);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.scene.add(mesh);
    return mesh;
  }

  private loadLevel(): void {
    this.physics.clearDynamic();
    this.clearLevelDecorations();
    this.projectiles.clearActive();
    this.chainImpactCooldowns.clear();
    this.surfaceImpactCooldowns.clear();
    this.runState.resetAim();
    this.arcadeResult = null;
    this.runSeed = createRunSeed();
    this.rng.reset(this.runSeed);
    if (import.meta.env.DEV) {
      console.debug(`[Material Blast Lab] run seed ${this.runSeed}`);
    }
    this.scorePopups.clear();
    this.slowMotionTimer = 0;
    this.hitStopTimer = 0;
    this.aimPoint.copy(DEFAULT_AIM_POINT);
    this.currentLevel().setup({
      physics: this.physics,
      materials: this.materials,
      addDecoration: (object) => this.addDecoration(object)
    });
    this.renderer.shadowMap.needsUpdate = true;
    this.status = `${this.currentLevel().name}: ${this.currentLevel().objective}`;
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
  }

  private aim(pointer: THREE.Vector2): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    if (this.runState.phase === "aim") {
      this.aimRaycaster.setFromCamera(pointer, this.cameraRig.camera);
      if (this.aimRaycaster.ray.intersectPlane(this.groundPlane, this.aimPoint)) {
        this.aimPoint.y = 0.16;
        this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
      } else {
        this.cannon.aim(pointer);
      }
    }
  }

  private fire(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      return;
    }
    const projectile = PROJECTILES[this.selectedProjectile];
    const muzzle = this.cannon.getMuzzlePosition();
    const direction = this.cannon.getDirection();
    const launchPosition = this.cannon.getLaunchPosition(projectile.baseRadius * this.sizeScale);
    this.projectiles.launch(this.selectedProjectile, launchPosition, direction, this.sizeScale, this.powerScale);
    this.scoreTracker.beginShot(projectile);
    this.cannon.fireKick(this.powerScale, this.sizeScale);
    this.audio.playCannonFire(projectile.id, this.powerScale, this.sizeScale);
    this.particles.muzzleFlash(muzzle, projectile.color);
    this.cameraRig.shake(projectile.id === "gravity" ? 0.36 : 0.24, 0.48);
    this.runState.beginFlight();
    this.status = `${projectile.name} fired from the high battery.`;
  }

  private detectImpact(active: ActiveProjectile): { point: THREE.Vector3; object: PhysicsObject | null } | null {
    const current = vectorFromRapier(active.object.body.translation());
    const previous = active.previousPosition.clone();

    if (
      current.y < 0.18 ||
      current.x < IMPACT_BOUNDS.minX ||
      current.x > IMPACT_BOUNDS.maxX ||
      current.z < IMPACT_BOUNDS.minZ ||
      current.z > IMPACT_BOUNDS.maxZ
    ) {
      active.previousPosition.copy(current);
      return { point: current, object: null };
    }

    let best: { point: THREE.Vector3; object: PhysicsObject; distance: number } | null = null;
    for (const object of this.physics.objects.values()) {
      if (
        object.id === active.object.id ||
        active.piercedObjectIds.has(object.id) ||
        object.category === "projectile" ||
        object.isDebris ||
        object.zoneId === "surface"
      ) {
        continue;
      }
      const candidate = projectileImpactCandidate(active, object, previous, current);
      if (candidate && (!best || candidate.distance < best.distance)) {
        best = candidate;
      }
    }

    active.previousPosition.copy(current);
    return best ? { point: best.point, object: best.object } : null;
  }

  private handleImpact(point: THREE.Vector3, active: ActiveProjectile, hitObject: PhysicsObject | null): void {
    const projectile = active.definition;
    const direction = active.object.body.linvel();
    const directionVector = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    if (hitObject && this.shouldProjectilePenetrate(active, hitObject)) {
      this.handleProjectilePenetration(point, active, hitObject, directionVector);
      return;
    }

    if (hitObject && !hitObject.canFracture) {
      const directImpulse = directionVector
        .clone()
        .multiplyScalar(projectile.impulse * active.powerScale * 0.22 / Math.max(0.8, this.materials.get(hitObject.materialId).massFactor));
      hitObject.body.applyImpulse({ x: directImpulse.x, y: directImpulse.y, z: directImpulse.z }, true);
      hitObject.body.applyTorqueImpulse({ x: directImpulse.z * 0.06, y: directImpulse.x * 0.06, z: directImpulse.y * 0.06 }, true);
    }

    const directResult =
      hitObject && hitObject.destructible
        ? this.destruction.impact(active.object, hitObject, point, speedOf(active.object) * directImpactScale(projectile.id))
        : null;
    this.projectiles.removeActive();
    const strength = projectile.impulse * active.powerScale * projectile.fractureBoost * residualBlastScale(projectile.id);
    const radius = projectile.blastRadius * active.sizeScale * residualBlastRadiusScale(projectile.id);
    const visualRadius = projectile.blastRadius * active.sizeScale * impactVisualRadiusScale(projectile.id);
    const result = this.destruction.explode(point, strength, radius);
    this.audio.playProjectileImpact({
      point,
      projectileId: projectile.id,
      result,
      powerScale: active.powerScale,
      sizeScale: active.sizeScale,
      hitMaterialId: hitObject?.materialId
    });
    const scoreEvents = [
      ...(directResult ? this.applyExplosionResult(directResult, projectile.id === "gel" ? 0.65 : 0.32) : []),
      ...this.applyExplosionResult(result, projectile.id === "gel" ? 1.2 : 0.85),
      ...this.playProjectileSpecial(projectile.id, point, directionVector, active)
    ];
    this.scorePopups.push(scoreEvents);

    this.explosion.play(point, visualRadius, result.dustColors);
    this.particles.cityDebrisSpray(point, result.dustColors, 1 + result.fracturedBodies * 0.085);
    this.cameraRig.spectacle(point);
    this.cameraRig.shake(projectile.id === "gravity" ? 0.78 : 0.52, 0.92);
    this.hitStopTimer = this.settings.motionEffects ? (projectile.id === "gravity" ? 0.09 : 0.065) : 0;
    this.slowMotionTimer = this.settings.motionEffects ? (projectile.id === "gravity" ? 0.72 : 0.58) : 0;
    this.runState.beginSpectacle(performance.now());
    this.status = `${projectile.name} impact: ${(directResult?.fracturedBodies ?? 0) + result.fracturedBodies} fractures, ${result.affectedBodies} bodies hit.`;
  }

  private shouldProjectilePenetrate(active: ActiveProjectile, hitObject: PhysicsObject): boolean {
    if (!hitObject.destructible || !hitObject.canFracture) {
      return false;
    }
    if (active.piercedObjectIds.size >= MAX_PROJECTILE_PENETRATIONS[active.definition.id]) {
      return false;
    }
    if (hitObject.materialId === "glass") {
      return active.definition.id === "slug" || active.definition.id === "gravity" || active.definition.id === "pulse";
    }
    if (hitObject.materialId === "foam") {
      return active.definition.id === "slug" || active.definition.id === "gravity";
    }
    if (hitObject.materialId === "wood") {
      return active.definition.id === "gravity" && Math.min(hitObject.dimensions.x, hitObject.dimensions.z) <= 0.58;
    }
    return false;
  }

  private handleProjectilePenetration(
    point: THREE.Vector3,
    active: ActiveProjectile,
    hitObject: PhysicsObject,
    direction: THREE.Vector3
  ): void {
    active.piercedObjectIds.add(hitObject.id);
    const speed = speedOf(active.object);
    const impactSpeed = speed * penetrationImpactScale(active.definition.id, hitObject);
    const result = this.destruction.impact(active.object, hitObject, point, impactSpeed);
    const scoreEvents = this.applyExplosionResult(result, active.definition.id === "gel" ? 0.9 : 0.45);
    if (scoreEvents.length > 0) {
      this.scorePopups.push(scoreEvents);
    }

    if (result.dustColors.length > 0) {
      this.particles.cityDebrisSpray(point, result.dustColors, 0.42 + result.fracturedBodies * 0.08);
    }
    this.particles.spark(point, hitObject.materialId === "glass" ? 0xb6fbff : active.definition.color, 0.55);
    this.audio.playChainImpact({
      point,
      result,
      relativeSpeed: impactSpeed,
      materialId: hitObject.materialId
    });

    const retainedSpeed = speed * penetrationRetainedSpeed(active.definition.id, hitObject);
    const nextVelocity = direction.clone().multiplyScalar(retainedSpeed);
    active.object.body.setLinvel({ x: nextVelocity.x, y: nextVelocity.y, z: nextVelocity.z }, true);
    this.cameraRig.shake(active.definition.id === "gravity" ? 0.18 : 0.1, 0.22);
    this.status = `${active.definition.name} pierced ${hitObject.materialId}; continuing through the block.`;
  }

  private playProjectileSpecial(
    projectileId: ProjectileId,
    point: THREE.Vector3,
    direction: THREE.Vector3,
    active: ActiveProjectile
  ): ScoreEvent[] {
    if (projectileId === "scatter") {
      this.spawnScatterFragments(point, direction, active.sizeScale);
      this.audio.playScatterBurst(point, active.sizeScale * active.powerScale);
      return [];
    }
    if (projectileId === "gel") {
      this.bioGore.splashAt(point, 1.45);
      this.audio.playBioSplash(point, 1.35 * active.sizeScale * active.powerScale);
      return [];
    }
    if (projectileId === "gravity") {
      const crush = this.destruction.explode(point.clone().add(new THREE.Vector3(0, -0.25, 0)), 30 * active.powerScale, 2.15 * active.sizeScale);
      this.audio.playGravityCrush(point, active.sizeScale * active.powerScale);
      this.audio.playProjectileImpact({
        point,
        projectileId,
        result: crush,
        powerScale: active.powerScale,
        sizeScale: active.sizeScale,
        hitMaterialId: "concrete"
      });
      return this.applyExplosionResult(crush, 0.35);
    }
    return [];
  }

  private applyExplosionResult(result: ExplosionResult, bioIntensity: number): ScoreEvent[] {
    const extraBio = this.bioGore.reactToExplosion(result.affectedObjects) * bioIntensity;
    return this.scoreTracker.addExplosion(result, extraBio);
  }

  private processDebrisImpacts(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    if (this.runState.phase === "aim" || this.runState.score) {
      this.physics.drainCollisionEvents();
      this.physics.drainSurfaceCollisionEvents();
      return events;
    }
    const activeProjectile = this.runState.phase === "flight" ? this.projectiles.getActive() : null;

    const now = performance.now();
    for (const [key, expiresAt] of this.chainImpactCooldowns) {
      if (expiresAt <= now) {
        this.chainImpactCooldowns.delete(key);
      }
    }

    let impactsThisFrame = 0;
    for (const collision of this.physics.drainCollisionEvents()) {
      if (impactsThisFrame >= CHAIN_IMPACT_MAX_PER_FRAME) {
        break;
      }
      if (!collision.started) {
        continue;
      }
      if (activeProjectile) {
        const projectileTarget = projectileCollisionTarget(activeProjectile, collision);
        if (projectileTarget) {
          const current = vectorFromRapier(activeProjectile.object.body.translation());
          const previous = activeProjectile.previousPosition.clone();
          const candidate = projectileImpactCandidate(activeProjectile, projectileTarget, previous, current);
          this.handleImpact(candidate?.point ?? closestPointOnObject(projectileTarget, current), activeProjectile, projectileTarget);
          return events;
        }
      }
      const pair = chainCollisionPair(collision.first, collision.second);
      if (!pair) {
        continue;
      }
      const { source, target } = pair;
      if (!this.physics.getObject(source.id) || !this.physics.getObject(target.id)) {
        continue;
      }
      const sourcePosition = vectorFromRapier(source.body.translation());
      const targetPosition = vectorFromRapier(target.body.translation());
      const sourceVelocity = source.body.linvel();
      const targetVelocity = target.body.linvel();
      const relativeVelocity = {
        x: sourceVelocity.x - targetVelocity.x,
        y: sourceVelocity.y - targetVelocity.y,
        z: sourceVelocity.z - targetVelocity.z
      };
      const relativeSpeedSq = velocityLengthSq(relativeVelocity);
      if (relativeSpeedSq < CHAIN_DEBRIS_MIN_SPEED_SQ) {
        continue;
      }
      const towardTarget = targetPosition.clone().sub(sourcePosition);
      if (
        towardTarget.lengthSq() > 0.0001 &&
        relativeVelocity.x * towardTarget.x + relativeVelocity.y * towardTarget.y + relativeVelocity.z * towardTarget.z <= 0
      ) {
        continue;
      }

      const pairKey = `${source.id}:${target.id}`;
      if ((this.chainImpactCooldowns.get(pairKey) ?? 0) > now) {
        continue;
      }
      this.chainImpactCooldowns.set(pairKey, now + CHAIN_IMPACT_COOLDOWN_MS);

      const origin = sourcePosition.clone().lerp(targetPosition, 0.5);
      const relativeSpeed = Math.sqrt(relativeSpeedSq);
      const result = this.destruction.impact(source, target, origin, relativeSpeed);
      const damaged = result.affectedObjects[0];
      if (!damaged?.fractured) {
        continue;
      }

      this.audio.playChainImpact({
        point: origin,
        result,
        relativeSpeed,
        materialId: damaged.materialId
      });
      events.push(...this.applyExplosionResult(result, 0.45));
      if (damaged.scoreRole !== "protected") {
        const points = Math.max(45, Math.round(damaged.weightedDamage * 0.85 + relativeSpeed * 8));
        events.push(...this.scoreTracker.addChainReaction(points, damaged.position));
        this.particles.spark(origin, 0xffd25c, Math.min(1.4, 0.55 + relativeSpeed * 0.045));
        if (result.dustColors.length > 0) {
          this.particles.cityDebrisSpray(origin, result.dustColors, 0.35 + result.fracturedBodies * 0.04);
        }
      }
      impactsThisFrame += 1;
    }
    events.push(...this.processSurfaceImpacts(now));
    return events;
  }

  private processSurfaceImpacts(now: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    for (const surfaceImpact of this.physics.drainSurfaceCollisionEvents()) {
      if (!surfaceImpact.started || !isGroundSurface(surfaceImpact.surfaceLabel)) {
        continue;
      }
      const object = surfaceImpact.object;
      if (!object.destructible || !object.canFracture || object.bodyType !== "dynamic" || object.category === "projectile") {
        continue;
      }
      if ((this.surfaceImpactCooldowns.get(object.id) ?? 0) > now) {
        continue;
      }

      const downwardSpeed = Math.max(0, -surfaceImpact.impactVelocity.y);
      const impactSpeed = downwardSpeed + horizontalSpeed(surfaceImpact.impactVelocity) * 0.22;
      if (!canGroundImpactBreak(object, impactSpeed)) {
        continue;
      }

      this.surfaceImpactCooldowns.set(object.id, now + 520);
      const objectPosition = vectorFromRapier(object.body.translation());
      const origin = objectPosition.clone();
      origin.y -= object.dimensions.y * 0.5;
      const result = this.destruction.groundImpact(object, origin, impactSpeed);
      const damaged = result.affectedObjects[0];
      if (!damaged?.fractured) {
        continue;
      }

      this.audio.playChainImpact({
        point: origin,
        result,
        relativeSpeed: impactSpeed,
        materialId: damaged.materialId
      });
      events.push(...this.applyExplosionResult(result, 0.25));
      if (damaged.scoreRole !== "protected") {
        const points = Math.max(22, Math.round(damaged.weightedDamage * 0.45 + impactSpeed * 6));
        events.push(...this.scoreTracker.addChainReaction(points, damaged.position));
      }
      if (result.dustColors.length > 0) {
        this.particles.cityDebrisSpray(origin, result.dustColors, 0.22 + result.fracturedBodies * 0.045);
      }
    }
    return events;
  }

  private isSceneSettled(): boolean {
    for (const object of this.physics.objects.values()) {
      if (object.category === "projectile" || object.bodyType === "fixed" || object.body.isSleeping()) {
        continue;
      }
      if (speedOf(object) >= SCORE_SETTLED_SPEED) {
        return false;
      }
    }
    return true;
  }

  private spawnScatterFragments(origin: THREE.Vector3, direction: THREE.Vector3, sizeScale: number): void {
    const material = this.materials.get("metal");
    const renderMaterial = this.materials.getRenderMaterial("metal");
    for (let i = 0; i < 18; i += 1) {
      const scatterDirection = direction
        .clone()
        .add(new THREE.Vector3(randomRange(this.rng, -0.4, 0.4), randomRange(this.rng, 0, 0.55), randomRange(this.rng, -0.4, 0.4)))
        .normalize();
      this.physics.addDynamicSphere({
        label: "Scatter shard",
        material,
        renderMaterial,
        position: origin.clone().add(scatterDirection.clone().multiplyScalar(0.22)),
        radius: 0.07 * sizeScale,
        linearVelocity: scatterDirection.multiplyScalar(randomRange(this.rng, 13, 24)),
        angularVelocity: new THREE.Vector3(randomRange(this.rng, 0, 7), randomRange(this.rng, 0, 7), randomRange(this.rng, 0, 7)),
        category: "debris",
        isDebris: true,
        chainSource: true,
        destructible: false,
        canFracture: false,
        density: 1.2,
        scoreValue: 4,
        segments: 10
      });
    }
    this.particles.spark(origin, 0xffc961, 1.5);
  }

  private reset(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    this.loadLevel();
  }

  private nextLevel(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    const unlockedCount = Math.max(1, Math.min(TEST_CHAMBERS.length, this.arcadeProgress.highestUnlockedLevel + 1));
    this.levelIndex = (this.levelIndex + 1) % unlockedCount;
    this.loadLevel();
  }

  private clearDebris(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    this.physics.clearDebris();
    this.audio.playUiTick();
    this.status = "Loose debris cleared. The trial state is unchanged.";
  }

  private selectProjectile(id: ProjectileId): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      this.status = "Reset before changing projectile.";
      this.audio.playUiReject();
      return;
    }
    this.selectedProjectile = id;
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
    this.audio.playLoadoutPreview(id, this.powerScale, this.sizeScale);
    this.status = `${PROJECTILES[id].name}: ${PROJECTILES[id].description}`;
  }

  private adjustPower(delta: number): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      this.audio.playUiReject();
      return;
    }
    this.powerScale = THREE.MathUtils.clamp(this.powerScale + delta, 0.65, 1.65);
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
    this.audio.playUiTick();
    this.status = `Power set to ${Math.round(this.powerScale * 100)}%.`;
  }

  private adjustSize(delta: number): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      this.audio.playUiReject();
      return;
    }
    this.sizeScale = THREE.MathUtils.clamp(this.sizeScale + delta, 0.75, 1.55);
    this.audio.playLoadoutPreview(this.selectedProjectile, this.powerScale, this.sizeScale);
    this.status = `Projectile size set to ${Math.round(this.sizeScale * 100)}%.`;
  }

  private updateSettings(patch: Partial<GameSettings>): void {
    this.settings = sanitizeGameSettings({ ...this.settings, ...patch });
    this.applySettings();
    saveGameSettings(this.settings);
    this.status = `Settings saved: ${settingsStatus(this.settings)}.`;
  }

  private resetSettings(): void {
    this.settings = { ...DEFAULT_GAME_SETTINGS };
    this.applySettings();
    saveGameSettings(this.settings);
    this.status = `Settings restored: ${settingsStatus(this.settings)}.`;
  }

  private applySettings(): void {
    const pixelRatioCap = graphicsPixelRatioCap(this.settings.graphicsQuality);
    this.cameraRig.setPixelRatioCap(pixelRatioCap);
    this.cameraRig.setShakeScale(this.settings.cameraShake);
    this.audio.setMasterVolume(this.settings.masterVolume);
    this.particles.setFlashScale(this.settings.motionEffects ? 1 : 0);
    this.renderer.shadowMap.enabled = this.settings.graphicsQuality === "cinematic";
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  private currentLevel() {
    return TEST_CHAMBERS[this.levelIndex];
  }

  private currentLevelProgress() {
    return this.arcadeProgress.levels[this.currentLevel().id];
  }

  private resize(): void {
    const viewport = window.visualViewport;
    this.cameraRig.resize(Math.round(viewport?.width ?? window.innerWidth), Math.round(viewport?.height ?? window.innerHeight));
  }

  private updateAimMarker(): void {
    this.aimMarker.visible = this.runState.phase === "aim";
    this.aimMarker.position.set(this.aimPoint.x, 0.055, this.aimPoint.z);
    this.aimMarkerMaterial.color.copy(PROJECTILES[this.selectedProjectile].color);
  }

  private addDecoration(object: THREE.Object3D): void {
    this.scene.add(object);
    this.levelDecorations.push(object);
  }

  private clearLevelDecorations(): void {
    for (const object of this.levelDecorations) {
      this.scene.remove(object);
      disposeObject(object);
    }
    this.levelDecorations.length = 0;
  }
}

function createAimMarker(material: THREE.MeshBasicMaterial): THREE.Group {
  const group = new THREE.Group();
  group.name = "aim impact reticle";

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 42), material);
  ring.rotation.x = -Math.PI * 0.5;
  ring.renderOrder = 5;

  const barGeometry = new THREE.PlaneGeometry(0.92, 0.045);
  const horizontal = new THREE.Mesh(barGeometry, material);
  horizontal.rotation.x = -Math.PI * 0.5;
  horizontal.renderOrder = 5;

  const vertical = new THREE.Mesh(barGeometry.clone(), material);
  vertical.rotation.x = -Math.PI * 0.5;
  vertical.rotation.z = Math.PI * 0.5;
  vertical.renderOrder = 5;

  group.add(ring, horizontal, vertical);
  return group;
}

async function boot(): Promise<void> {
  await RAPIER.init();
  const game = new Game();
  game.start();
}

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function quaternionFromRapier(q: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

function speedOf(object: PhysicsObject): number {
  return Math.sqrt(velocityLengthSq(object.body.linvel()));
}

function velocityLengthSq(velocity: { x: number; y: number; z: number }): number {
  return velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z;
}

function chainCollisionPair(first: PhysicsObject, second: PhysicsObject): { source: PhysicsObject; target: PhysicsObject } | null {
  if (isChainSource(first) && isChainTarget(second)) {
    return { source: first, target: second };
  }
  if (isChainSource(second) && isChainTarget(first)) {
    return { source: second, target: first };
  }
  return null;
}

function isChainSource(object: PhysicsObject): boolean {
  return object.chainSource && object.scoreRole !== "protected" && object.category !== "projectile" && object.bodyType === "dynamic";
}

function isChainTarget(object: PhysicsObject): boolean {
  return object.category !== "projectile" && !object.isDebris && object.destructible && object.canFracture;
}

function isGroundSurface(label: string): boolean {
  return label.toLowerCase().includes("floor");
}

function horizontalSpeed(velocity: THREE.Vector3): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

function canGroundImpactBreak(object: PhysicsObject, impactSpeed: number): boolean {
  if (object.scoreRole === "protected") {
    return impactSpeed >= 5.6;
  }
  if (object.isDebris) {
    return impactSpeed >= (object.materialId === "glass" || object.materialId === "foam" ? 3.2 : 3.8);
  }
  if (object.materialId === "glass" || object.materialId === "foam" || object.materialId === "bioGel") {
    return impactSpeed >= 4.0;
  }
  if (object.materialId === "wood") {
    return impactSpeed >= 4.6;
  }
  return impactSpeed >= 5.1;
}

function projectileCollisionTarget(active: ActiveProjectile, collision: { first: PhysicsObject; second: PhysicsObject }): PhysicsObject | null {
  const target =
    collision.first.id === active.object.id
      ? collision.second
      : collision.second.id === active.object.id
        ? collision.first
        : null;
  if (!target || active.piercedObjectIds.has(target.id) || target.category === "projectile" || target.isDebris || target.zoneId === "surface") {
    return null;
  }
  return target;
}

function penetrationImpactScale(projectileId: ProjectileId, target: PhysicsObject): number {
  if (target.materialId === "glass") {
    return projectileId === "pulse" ? 0.38 : 0.32;
  }
  if (target.materialId === "foam") {
    return 0.26;
  }
  return 0.22;
}

function penetrationRetainedSpeed(projectileId: ProjectileId, target: PhysicsObject): number {
  if (target.materialId === "glass") {
    return projectileId === "gravity" ? 0.78 : projectileId === "pulse" ? 0.62 : 0.74;
  }
  if (target.materialId === "foam") {
    return projectileId === "gravity" ? 0.66 : 0.58;
  }
  return 0.48;
}

function directImpactScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.82;
    case "gravity":
      return 1.35;
    case "pulse":
      return 0.82;
    case "scatter":
      return 0.72;
    case "gel":
      return 0.68;
  }
}

function residualBlastScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.48;
    case "gravity":
      return 0.62;
    case "pulse":
      return 0.9;
    case "scatter":
      return 0.76;
    case "gel":
      return 0.82;
  }
}

function residualBlastRadiusScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.82;
    case "gravity":
      return 0.82;
    case "pulse":
      return 1.0;
    case "scatter":
      return 0.88;
    case "gel":
      return 0.94;
  }
}

function impactVisualRadiusScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 1.32;
    case "gravity":
      return 1.02;
    case "pulse":
      return 1.12;
    case "scatter":
      return 0.98;
    case "gel":
      return 1.02;
  }
}

function projectileImpactCandidate(
  active: ActiveProjectile,
  object: PhysicsObject,
  previous: THREE.Vector3,
  current: THREE.Vector3
): { point: THREE.Vector3; object: PhysicsObject; distance: number } | null {
  if (!segmentCanReachObject(previous, current, object, active.radius + 0.2)) {
    return null;
  }
  if (object.shape === "sphere") {
    const objectPosition = object.body.translation();
    const threshold = active.radius + object.radius;
    const distanceSq = distancePointToSegmentSq(objectPosition, previous, current);
    if (distanceSq > threshold * threshold) {
      return null;
    }
    const point = new THREE.Vector3(objectPosition.x, objectPosition.y, objectPosition.z).lerp(current, 0.35);
    return { point, object, distance: previous.distanceToSquared(point) };
  }

  const center = vectorFromRapier(object.body.translation());
  const rotation = quaternionFromRapier(object.body.rotation());
  const inverseRotation = rotation.clone().invert();
  const localPrevious = previous.clone().sub(center).applyQuaternion(inverseRotation);
  const localCurrent = current.clone().sub(center).applyQuaternion(inverseRotation);
  const originalHalf = object.dimensions.clone().multiplyScalar(0.5);
  const expandedHalf = originalHalf.clone().addScalar(active.radius + 0.08);
  const hitT = segmentAabbIntersection(localPrevious, localCurrent, expandedHalf);
  if (hitT === null) {
    return null;
  }

  const localHit = localPrevious.clone().lerp(localCurrent, hitT);
  const localSurface = clampVectorToBox(localHit, originalHalf);
  const point = localSurface.applyQuaternion(rotation).add(center);
  return { point, object, distance: previous.distanceToSquared(point) };
}

function segmentCanReachObject(previous: THREE.Vector3, current: THREE.Vector3, object: PhysicsObject, padding: number): boolean {
  const objectPosition = object.body.translation();
  const threshold = object.radius + padding;
  return !(
    objectPosition.x < Math.min(previous.x, current.x) - threshold ||
    objectPosition.x > Math.max(previous.x, current.x) + threshold ||
    objectPosition.y < Math.min(previous.y, current.y) - threshold ||
    objectPosition.y > Math.max(previous.y, current.y) + threshold ||
    objectPosition.z < Math.min(previous.z, current.z) - threshold ||
    objectPosition.z > Math.max(previous.z, current.z) + threshold
  );
}

function segmentAabbIntersection(start: THREE.Vector3, end: THREE.Vector3, halfSize: THREE.Vector3): number | null {
  const delta = end.clone().sub(start);
  let tMin = 0;
  let tMax = 1;

  const x = clipSegmentAxis(start.x, delta.x, -halfSize.x, halfSize.x, tMin, tMax);
  if (!x) {
    return null;
  }
  tMin = x.tMin;
  tMax = x.tMax;

  const y = clipSegmentAxis(start.y, delta.y, -halfSize.y, halfSize.y, tMin, tMax);
  if (!y) {
    return null;
  }
  tMin = y.tMin;
  tMax = y.tMax;

  const z = clipSegmentAxis(start.z, delta.z, -halfSize.z, halfSize.z, tMin, tMax);
  return z ? z.tMin : null;
}

function clipSegmentAxis(
  start: number,
  delta: number,
  min: number,
  max: number,
  tMin: number,
  tMax: number
): { tMin: number; tMax: number } | null {
  if (Math.abs(delta) < 0.000001) {
    return start >= min && start <= max ? { tMin, tMax } : null;
  }
  const inverseDelta = 1 / delta;
  let near = (min - start) * inverseDelta;
  let far = (max - start) * inverseDelta;
  if (near > far) {
    const swap = near;
    near = far;
    far = swap;
  }
  const nextMin = Math.max(tMin, near);
  const nextMax = Math.min(tMax, far);
  return nextMin <= nextMax ? { tMin: nextMin, tMax: nextMax } : null;
}

function closestPointOnObject(object: PhysicsObject, point: THREE.Vector3): THREE.Vector3 {
  if (object.shape === "sphere") {
    const center = vectorFromRapier(object.body.translation());
    const direction = point.clone().sub(center);
    if (direction.lengthSq() < 0.0001) {
      return center;
    }
    return center.add(direction.normalize().multiplyScalar(object.radius));
  }
  const center = vectorFromRapier(object.body.translation());
  const rotation = quaternionFromRapier(object.body.rotation());
  const localPoint = point.clone().sub(center).applyQuaternion(rotation.clone().invert());
  return clampVectorToBox(localPoint, object.dimensions.clone().multiplyScalar(0.5)).applyQuaternion(rotation).add(center);
}

function clampVectorToBox(point: THREE.Vector3, halfSize: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(point.x, -halfSize.x, halfSize.x),
    THREE.MathUtils.clamp(point.y, -halfSize.y, halfSize.y),
    THREE.MathUtils.clamp(point.z, -halfSize.z, halfSize.z)
  );
}

function distancePointToSegmentSq(point: { x: number; y: number; z: number }, a: THREE.Vector3, b: THREE.Vector3): number {
  const segmentX = b.x - a.x;
  const segmentY = b.y - a.y;
  const segmentZ = b.z - a.z;
  const lengthSq = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
  if (lengthSq < 0.0001) {
    const dx = point.x - a.x;
    const dy = point.y - a.y;
    const dz = point.z - a.z;
    return dx * dx + dy * dy + dz * dz;
  }
  const pointX = point.x - a.x;
  const pointY = point.y - a.y;
  const pointZ = point.z - a.z;
  const t = THREE.MathUtils.clamp((pointX * segmentX + pointY * segmentY + pointZ * segmentZ) / lengthSq, 0, 1);
  const closestX = a.x + segmentX * t;
  const closestY = a.y + segmentY * t;
  const closestZ = a.z + segmentZ * t;
  const dx = point.x - closestX;
  const dy = point.y - closestY;
  const dz = point.z - closestZ;
  return dx * dx + dy * dy + dz * dz;
}

function disposeObject(object: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.geometry.userData.sharedGeometry !== true) {
        child.geometry.dispose();
      }
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (disposedMaterials.has(material)) {
          continue;
        }
        material.dispose();
        disposedMaterials.add(material);
      }
    }
  });
}

function chamberToArcadeLevel(chamber: TestChamber): ArcadeLevelDefinition {
  const mission = chamber.mission;
  return {
    id: chamber.id,
    title: chamber.name,
    thresholds: {
      missionScore: mission.scoreThresholds.oneStar,
      missionMaxProtectedPenalty: mission.protectedDamageLimit,
      twoStarScore: mission.scoreThresholds.twoStar,
      twoStarMaxProtectedPenalty: mission.cleanBlastLimit,
      threeStarScore: mission.scoreThresholds.threeStar,
      threeStarMaxProtectedPenalty: mission.cleanBlastLimit,
      threeStarBonus: mission.bonusThreshold
    }
  };
}

function scoreStatus(score: ScoreBreakdown, result: ArcadeResult): string {
  if (!result.completed) {
    return `Mission failed: ${score.totalScore}. Retry for 1 star.`;
  }
  if (result.stars >= 3) {
    return `Perfect run: ${score.totalScore}. 3/3 stars earned.`;
  }
  return `Mission complete: ${score.totalScore}. ${result.stars}/3 stars earned.`;
}

function settingsStatus(settings: GameSettings): string {
  return `${settings.graphicsQuality}, ${Math.round(settings.masterVolume * 100)}% volume, ${Math.round(settings.cameraShake * 100)}% shake`;
}

boot().catch((error: unknown) => {
  console.error(error);
  document.body.replaceChildren();
  const pre = document.createElement("pre");
  pre.style.color = "#fff";
  pre.style.background = "#111";
  pre.style.padding = "24px";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = String(error);
  document.body.appendChild(pre);
});

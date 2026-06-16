import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { DestructionAudio } from "./audio";
import { BioGoreSystem } from "./bioGore";
import { CameraRig } from "./cameraRig";
import { Cannon } from "./cannon";
import { DestructionSystem, type ExplosionResult } from "./destruction";
import { InputController } from "./input";
import { TEST_CHAMBERS } from "./levels";
import { MaterialCatalog } from "./materialCatalog";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import { PROJECTILES, ProjectileSystem, type ActiveProjectile, type ProjectileId } from "./projectile";
import { ScorePopupLayer } from "./scorePopups";
import { ShotScoreTracker, type ScoreBreakdown, type ScoreEvent } from "./scoring";
import { ExplosionSystem, ParticleSystem } from "./vfx";
import { GameUI } from "./ui";

type GamePhase = "aim" | "flight" | "spectacle" | "scored";

const DEFAULT_AIM_POINT = new THREE.Vector3(0, 0.16, -3.4);
const CHAIN_DEBRIS_MIN_SPEED = 4.4;
const CHAIN_DEBRIS_MIN_SPEED_SQ = CHAIN_DEBRIS_MIN_SPEED * CHAIN_DEBRIS_MIN_SPEED;
const CHAIN_IMPACT_COOLDOWN_MS = 520;
const CHAIN_IMPACT_MAX_PER_FRAME = 5;
const SCORE_REVEAL_MIN_DELAY_MS = 2600;
const SCORE_REVEAL_TIMEOUT_MS = 7600;
const SCORE_SETTLED_SPEED = 1.15;
const SCORE_SETTLED_FRAMES = 18;
const IMPACT_BOUNDS = {
  minX: -18.8,
  maxX: 18.8,
  minZ: -21.8,
  maxZ: 35.8
};

class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly materials = new MaterialCatalog();
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

  private selectedProjectile: ProjectileId = "slug";
  private powerScale = 1;
  private sizeScale = 1;
  private shotAvailable = true;
  private phase: GamePhase = "aim";
  private levelIndex = 0;
  private status = "Aim the siege cannon from the high battery.";
  private score: ScoreBreakdown | null = null;
  private slowMotionTimer = 0;
  private scoreRevealAt: number | null = null;
  private scoreRevealStartedAt: number | null = null;
  private scoreSettleFrames = 0;
  private fpsSampleElapsed = 0;
  private fpsSampleFrames = 0;
  private displayedFps = 0;

  constructor() {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app");
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance"
    });
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    app.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x080b10);
    this.scene.fog = new THREE.Fog(0x080b10, 28, 78);
    this.timer.connect(document);

    this.cameraRig = new CameraRig(this.renderer);
    this.physics = new PhysicsWorld(this.scene);
    this.destruction = new DestructionSystem(this.physics, this.materials);
    this.particles = new ParticleSystem(this.scene);
    this.explosion = new ExplosionSystem(this.particles);
    this.bioGore = new BioGoreSystem(this.physics, this.materials, this.particles);
    this.projectiles = new ProjectileSystem(this.physics, this.materials);
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
      adjustSize: (delta) => this.adjustSize(delta)
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
    const timeScale = this.slowMotionTimer > 0 ? 0.32 : 1;
    if (this.slowMotionTimer > 0) {
      this.slowMotionTimer = Math.max(0, this.slowMotionTimer - delta);
    }

    this.cannon.update(delta, PROJECTILES[this.selectedProjectile], this.powerScale, this.sizeScale);
    if (this.phase !== "aim") {
      this.physics.step(delta * timeScale);
      this.projectiles.update(delta * timeScale);
    }
    const chainEvents = this.processDebrisImpacts();
    if (chainEvents.length > 0) {
      this.scorePopups.push(chainEvents);
    }
    this.updatePhase();
    this.particles.update(delta);
    this.cameraRig.update(delta);
    this.updateAimMarker();
    this.scorePopups.update(delta, this.cameraRig.camera);
    this.ui.update({
      projectileId: this.selectedProjectile,
      projectile: PROJECTILES[this.selectedProjectile],
      powerScale: this.powerScale,
      sizeScale: this.sizeScale,
      shotAvailable: this.shotAvailable,
      bodyCount: this.physics.getDynamicBodyCount(),
      levelName: this.currentLevel().name,
      levelDescription: this.currentLevel().description,
      objective: this.currentLevel().objective,
      protectedBrief: this.currentLevel().protectedBrief,
      status: this.status,
      fps: this.displayedFps,
      score: this.score
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
    if (this.phase === "aim") {
      this.cannon.setTrajectoryVisible(true);
      this.cameraRig.setCityAimView(this.cannon.getCameraAnchor());
      return;
    }

    this.cannon.setTrajectoryVisible(false);
    if (this.phase === "flight" && active) {
      const position = vectorFromRapier(active.object.body.translation());
      const velocity = vectorFromRapier(active.object.body.linvel());
      this.cameraRig.followProjectile(position, velocity);
      const impact = this.detectImpact(active);
      if (impact || active.age > 7.5) {
        this.handleImpact(impact?.point ?? position, active, impact?.object ?? null);
      }
      return;
    }

    if ((this.phase === "spectacle" || this.phase === "scored") && this.scoreRevealAt !== null) {
      const now = performance.now();
      if (!this.score && now >= this.scoreRevealAt) {
        const timedOut = this.scoreRevealStartedAt !== null && now - this.scoreRevealStartedAt >= SCORE_REVEAL_TIMEOUT_MS;
        this.scoreSettleFrames = this.isSceneSettled() ? this.scoreSettleFrames + 1 : 0;
        if (!timedOut && this.scoreSettleFrames < SCORE_SETTLED_FRAMES) {
          this.status = "Scoring active chain reactions...";
          return;
        }
        this.score = this.scoreTracker.finalize(this.physics);
        this.phase = "scored";
        this.scoreRevealAt = null;
        this.scoreRevealStartedAt = null;
        this.scoreSettleFrames = 0;
        this.status = `${this.score.containmentRating}: ${this.score.totalScore}. Retry to rebuild the district.`;
      }
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
      metalness: 0.08
    });
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e2730,
      roughness: 0.72,
      metalness: 0.05
    });
    const cannonDeckMaterial = new THREE.MeshStandardMaterial({
      color: 0x27313a,
      roughness: 0.76,
      metalness: 0.08
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
    this.score = null;
    this.scoreRevealAt = null;
    this.scoreRevealStartedAt = null;
    this.scoreSettleFrames = 0;
    this.scorePopups.clear();
    this.phase = "aim";
    this.shotAvailable = true;
    this.slowMotionTimer = 0;
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
    if (this.phase === "aim") {
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
    if (!this.shotAvailable || this.phase !== "aim") {
      return;
    }
    const projectile = PROJECTILES[this.selectedProjectile];
    const muzzle = this.cannon.getMuzzlePosition();
    const direction = this.cannon.getDirection();
    const launchPosition = this.cannon.getLaunchPosition(projectile.baseRadius * this.sizeScale);
    this.projectiles.launch(this.selectedProjectile, launchPosition, direction, this.sizeScale, this.powerScale);
    this.scoreTracker.beginShot(projectile);
    this.cannon.fireKick();
    this.audio.playCannonFire(projectile.id, this.powerScale, this.sizeScale);
    this.particles.muzzleFlash(muzzle, projectile.color);
    this.cameraRig.shake(0.18, 0.38);
    this.shotAvailable = false;
    this.phase = "flight";
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
      if (object.id === active.object.id || object.category === "projectile" || object.isDebris) {
        continue;
      }
      const objectPosition = object.body.translation();
      const threshold = active.radius + Math.min(1.25, object.radius * 0.55);
      if (
        objectPosition.x < Math.min(previous.x, current.x) - threshold ||
        objectPosition.x > Math.max(previous.x, current.x) + threshold ||
        objectPosition.y < Math.min(previous.y, current.y) - threshold ||
        objectPosition.y > Math.max(previous.y, current.y) + threshold ||
        objectPosition.z < Math.min(previous.z, current.z) - threshold ||
        objectPosition.z > Math.max(previous.z, current.z) + threshold
      ) {
        continue;
      }
      const distanceSq = distancePointToSegmentSq(objectPosition, previous, current);
      const thresholdSq = threshold * threshold;
      if (distanceSq < thresholdSq && (!best || distanceSq < best.distance)) {
        best = { point: new THREE.Vector3(objectPosition.x, objectPosition.y, objectPosition.z).lerp(current, 0.35), object, distance: distanceSq };
      }
    }

    active.previousPosition.copy(current);
    return best ? { point: best.point, object: best.object } : null;
  }

  private handleImpact(point: THREE.Vector3, active: ActiveProjectile, hitObject: PhysicsObject | null): void {
    const projectile = active.definition;
    const direction = active.object.body.linvel();
    const directionVector = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    if (hitObject && !hitObject.canFracture) {
      const directImpulse = directionVector
        .clone()
        .multiplyScalar(projectile.impulse * active.powerScale * 0.22 / Math.max(0.8, this.materials.get(hitObject.materialId).massFactor));
      hitObject.body.applyImpulse({ x: directImpulse.x, y: directImpulse.y, z: directImpulse.z }, true);
      hitObject.body.applyTorqueImpulse({ x: directImpulse.z * 0.06, y: directImpulse.x * 0.06, z: directImpulse.y * 0.06 }, true);
    }

    this.projectiles.removeActive();
    const strength = projectile.impulse * active.powerScale * projectile.fractureBoost;
    const radius = projectile.blastRadius * active.sizeScale;
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
      ...this.applyExplosionResult(result, projectile.id === "gel" ? 1.2 : 0.85),
      ...this.playProjectileSpecial(projectile.id, point, directionVector, active)
    ];
    this.scorePopups.push(scoreEvents);

    this.explosion.play(point, radius, result.dustColors);
    this.particles.cityDebrisSpray(point, result.dustColors, 0.8 + result.fracturedBodies * 0.07);
    this.cameraRig.spectacle(point);
    this.cameraRig.shake(projectile.id === "gravity" ? 0.58 : 0.38, 0.78);
    this.slowMotionTimer = 0.45;
    this.scoreRevealStartedAt = performance.now();
    this.scoreRevealAt = this.scoreRevealStartedAt + SCORE_REVEAL_MIN_DELAY_MS;
    this.scoreSettleFrames = 0;
    this.phase = "spectacle";
    this.status = `${projectile.name} impact: ${result.fracturedBodies} fractures, ${result.affectedBodies} bodies hit.`;
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
      const crush = this.destruction.explode(point.clone().add(new THREE.Vector3(0, -0.25, 0)), 22 * active.powerScale, 1.8 * active.sizeScale);
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
    if (this.phase === "aim" || this.score) {
      this.physics.drainCollisionEvents();
      return events;
    }

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
    for (let i = 0; i < 12; i += 1) {
      const scatterDirection = direction
        .clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.55, (Math.random() - 0.5) * 0.8))
        .normalize();
      this.physics.addDynamicSphere({
        label: "Scatter shard",
        material,
        renderMaterial,
        position: origin.clone().add(scatterDirection.clone().multiplyScalar(0.22)),
        radius: 0.055 * sizeScale,
        linearVelocity: scatterDirection.multiplyScalar(10 + Math.random() * 8),
        angularVelocity: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4),
        category: "debris",
        isDebris: true,
        chainSource: false,
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
    this.loadLevel();
  }

  private nextLevel(): void {
    this.levelIndex = (this.levelIndex + 1) % TEST_CHAMBERS.length;
    this.loadLevel();
  }

  private clearDebris(): void {
    this.physics.clearDebris();
    this.status = "Loose debris cleared. The trial state is unchanged.";
  }

  private selectProjectile(id: ProjectileId): void {
    if (!this.shotAvailable || this.phase !== "aim") {
      this.status = "Reset before changing projectile.";
      return;
    }
    this.selectedProjectile = id;
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
    this.status = `${PROJECTILES[id].name}: ${PROJECTILES[id].description}`;
  }

  private adjustPower(delta: number): void {
    if (!this.shotAvailable || this.phase !== "aim") {
      return;
    }
    this.powerScale = THREE.MathUtils.clamp(this.powerScale + delta, 0.65, 1.65);
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
    this.status = `Power set to ${Math.round(this.powerScale * 100)}%.`;
  }

  private adjustSize(delta: number): void {
    if (!this.shotAvailable || this.phase !== "aim") {
      return;
    }
    this.sizeScale = THREE.MathUtils.clamp(this.sizeScale + delta, 0.75, 1.55);
    this.status = `Projectile size set to ${Math.round(this.sizeScale * 100)}%.`;
  }

  private currentLevel() {
    return TEST_CHAMBERS[this.levelIndex];
  }

  private resize(): void {
    const viewport = window.visualViewport;
    this.cameraRig.resize(Math.round(viewport?.width ?? window.innerWidth), Math.round(viewport?.height ?? window.innerHeight));
  }

  private updateAimMarker(): void {
    this.aimMarker.visible = this.phase === "aim";
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
  return object.isDebris && object.chainSource && object.scoreRole !== "protected";
}

function isChainTarget(object: PhysicsObject): boolean {
  return object.category !== "projectile" && !object.isDebris && object.destructible && object.canFracture;
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

boot().catch((error: unknown) => {
  console.error(error);
  document.body.innerHTML = `<pre style="color:#fff;background:#111;padding:24px;white-space:pre-wrap">${String(error)}</pre>`;
});

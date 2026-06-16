import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { BioGoreSystem } from "./bioGore";
import { CameraRig } from "./cameraRig";
import { Cannon } from "./cannon";
import { DestructionSystem, type ExplosionAffectedObject, type ExplosionResult } from "./destruction";
import { InputController } from "./input";
import { TEST_CHAMBERS } from "./levels";
import { MaterialCatalog } from "./materialCatalog";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import { PROJECTILES, ProjectileSystem, type ActiveProjectile, type ProjectileId } from "./projectile";
import { ShotScoreTracker, type ScoreBreakdown } from "./scoring";
import { ExplosionSystem, ParticleSystem } from "./vfx";
import { GameUI } from "./ui";

type GamePhase = "aim" | "flight" | "spectacle" | "scored";

class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly materials = new MaterialCatalog();
  private readonly physics: PhysicsWorld;
  private readonly destruction: DestructionSystem;
  private readonly particles: ParticleSystem;
  private readonly explosion: ExplosionSystem;
  private readonly cameraRig: CameraRig;
  private readonly cannon: Cannon;
  private readonly projectiles: ProjectileSystem;
  private readonly bioGore: BioGoreSystem;
  private readonly scoreTracker = new ShotScoreTracker();
  private readonly ui: GameUI;
  private readonly input: InputController;
  private readonly timer = new THREE.Timer();
  private readonly arenaObjects: THREE.Object3D[] = [];
  private readonly triggeredIds = new Set<number>();

  private selectedProjectile: ProjectileId = "slug";
  private powerScale = 1;
  private sizeScale = 1;
  private shotAvailable = true;
  private phase: GamePhase = "aim";
  private levelIndex = 0;
  private status = "Aim the cannon. One shot, maximum damage.";
  private score: ScoreBreakdown | null = null;
  private slowMotionTimer = 0;
  private scoreRevealAt: number | null = null;

  constructor() {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app");
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    app.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x080b10);
    this.scene.fog = new THREE.Fog(0x080b10, 18, 42);
    this.timer.connect(document);

    this.cameraRig = new CameraRig(this.renderer);
    this.physics = new PhysicsWorld(this.scene);
    this.destruction = new DestructionSystem(this.physics, this.materials);
    this.particles = new ParticleSystem(this.scene);
    this.explosion = new ExplosionSystem(this.particles);
    this.bioGore = new BioGoreSystem(this.physics, this.materials, this.particles);
    this.projectiles = new ProjectileSystem(this.physics, this.materials);
    this.cannon = new Cannon(this.scene);

    this.ui = new GameUI({
      fire: () => this.fire(),
      reset: () => this.reset(),
      clearDebris: () => this.clearDebris(),
      selectProjectile: (id) => this.selectProjectile(id),
      nextLevel: () => this.nextLevel()
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
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("beforeunload", () => this.input.dispose());
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.update());
  }

  private update(): void {
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.05);
    const timeScale = this.slowMotionTimer > 0 ? 0.32 : 1;
    if (this.slowMotionTimer > 0) {
      this.slowMotionTimer = Math.max(0, this.slowMotionTimer - delta);
    }

    this.cannon.update(delta, PROJECTILES[this.selectedProjectile], this.powerScale);
    this.physics.step(delta * timeScale);
    this.projectiles.update(delta * timeScale);
    this.updatePhase();
    this.particles.update(delta);
    this.cameraRig.update(delta);
    this.ui.update({
      projectileId: this.selectedProjectile,
      projectile: PROJECTILES[this.selectedProjectile],
      powerScale: this.powerScale,
      sizeScale: this.sizeScale,
      shotAvailable: this.shotAvailable,
      bodyCount: this.physics.getDynamicBodyCount(),
      levelName: this.currentLevel().name,
      levelDescription: this.currentLevel().description,
      status: this.status,
      score: this.score
    });
    this.renderer.render(this.scene, this.cameraRig.camera);
  }

  private updatePhase(): void {
    const active = this.projectiles.getActive();
    if (this.phase === "aim") {
      this.cannon.setTrajectoryVisible(true);
      this.cameraRig.setCannonView(this.cannon.getMuzzlePosition(), this.cannon.getDirection());
      return;
    }

    this.cannon.setTrajectoryVisible(false);
    if (this.phase === "flight" && active) {
      const position = vectorFromRapier(active.object.body.translation());
      const velocity = vectorFromRapier(active.object.body.linvel());
      this.cameraRig.followProjectile(position, velocity);
      const impact = this.detectImpact(active);
      if (impact || active.age > 5.2) {
        this.handleImpact(impact?.point ?? position, active, impact?.object ?? null);
      }
      return;
    }

    if ((this.phase === "spectacle" || this.phase === "scored") && this.scoreRevealAt !== null) {
      if (performance.now() >= this.scoreRevealAt && !this.score) {
        this.score = this.scoreTracker.finalize(this.physics);
        this.phase = "scored";
        this.scoreRevealAt = null;
        this.status = `Trial scored: ${this.score.totalScore}. R resets, Tab changes chamber.`;
      }
    }
  }

  private configureLights(): void {
    const ambient = new THREE.AmbientLight(0xb6c6d5, 0.52);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xf7fbff, 3.4);
    key.position.set(7, 11, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
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

    const floor = this.physics.addStaticBox({
      label: "Lab floor",
      position: new THREE.Vector3(0, -0.1, 0),
      size: new THREE.Vector3(18, 0.2, 18),
      material: floorMaterial
    });
    this.arenaObjects.push(floor);

    const wallSpecs = [
      { position: new THREE.Vector3(0, 0.75, -9), size: new THREE.Vector3(18, 1.5, 0.35) },
      { position: new THREE.Vector3(0, 0.75, 9), size: new THREE.Vector3(18, 1.5, 0.35) },
      { position: new THREE.Vector3(-9, 0.75, 0), size: new THREE.Vector3(0.35, 1.5, 18) },
      { position: new THREE.Vector3(9, 0.75, 0), size: new THREE.Vector3(0.35, 1.5, 18) }
    ];
    for (const spec of wallSpecs) {
      const wall = this.physics.addStaticBox({ label: "Arena wall", material: wallMaterial, ...spec });
      wall.castShadow = true;
      this.arenaObjects.push(wall);
    }

    const grid = new THREE.GridHelper(18, 36, 0x3f8da0, 0x26333a);
    grid.position.y = 0.012;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.scene.add(grid);
    this.arenaObjects.push(grid);
  }

  private loadLevel(): void {
    this.physics.clearDynamic();
    this.projectiles.clearActive();
    this.triggeredIds.clear();
    this.score = null;
    this.scoreRevealAt = null;
    this.phase = "aim";
    this.shotAvailable = true;
    this.slowMotionTimer = 0;
    this.currentLevel().setup({
      physics: this.physics,
      materials: this.materials,
      bioGore: this.bioGore
    });
    this.status = `${this.currentLevel().name}: choose a projectile and make one shot count.`;
  }

  private aim(pointer: THREE.Vector2): void {
    if (this.phase === "aim") {
      this.cannon.aim(pointer);
    }
  }

  private fire(): void {
    if (!this.shotAvailable || this.phase !== "aim") {
      return;
    }
    const projectile = PROJECTILES[this.selectedProjectile];
    const muzzle = this.cannon.getMuzzlePosition();
    const direction = this.cannon.getDirection();
    this.projectiles.launch(this.selectedProjectile, muzzle, direction, this.sizeScale, this.powerScale);
    this.scoreTracker.beginShot(projectile);
    this.cannon.fireKick();
    this.particles.muzzleFlash(muzzle, projectile.color);
    this.shotAvailable = false;
    this.phase = "flight";
    this.status = `${projectile.name} away.`;
  }

  private detectImpact(active: ActiveProjectile): { point: THREE.Vector3; object: PhysicsObject | null } | null {
    const current = vectorFromRapier(active.object.body.translation());
    const previous = active.previousPosition.clone();

    if (current.y < 0.18 || Math.abs(current.x) > 8.6 || current.z < -8.6 || current.z > 9.1) {
      active.previousPosition.copy(current);
      return { point: current, object: null };
    }

    let best: { point: THREE.Vector3; object: PhysicsObject; distance: number } | null = null;
    for (const object of this.physics.getDynamicObjects()) {
      if (object.id === active.object.id || object.category === "projectile" || object.isDebris) {
        continue;
      }
      const objectPosition = vectorFromRapier(object.body.translation());
      const distance = distancePointToSegment(objectPosition, previous, current);
      const threshold = active.radius + Math.min(1.25, object.radius * 0.55);
      if (distance < threshold && (!best || distance < best.distance)) {
        best = { point: objectPosition.lerp(current, 0.35), object, distance };
      }
    }

    active.previousPosition.copy(current);
    return best ? { point: best.point, object: best.object } : null;
  }

  private handleImpact(point: THREE.Vector3, active: ActiveProjectile, hitObject: PhysicsObject | null): void {
    const projectile = active.definition;
    const direction = active.object.body.linvel();
    const directionVector = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    if (hitObject) {
      const directImpulse = directionVector
        .clone()
        .multiplyScalar(projectile.impulse * active.powerScale * 0.65 / Math.max(0.6, this.materials.get(hitObject.materialId).massFactor));
      hitObject.body.applyImpulse({ x: directImpulse.x, y: directImpulse.y, z: directImpulse.z }, true);
      hitObject.body.applyTorqueImpulse({ x: directImpulse.z * 0.18, y: directImpulse.x * 0.18, z: directImpulse.y * 0.18 }, true);
    }

    this.projectiles.removeActive();
    const strength = projectile.impulse * active.powerScale * projectile.fractureBoost;
    const radius = projectile.blastRadius * active.sizeScale;
    const result = this.destruction.explode(point, strength, radius);
    this.applyExplosionResult(result, projectile.id === "gel" ? 1.2 : 0.85);
    this.processTriggers(result.affectedObjects, 0);
    this.playProjectileSpecial(projectile.id, point, directionVector, active);

    this.explosion.play(point, radius, result.dustColors);
    this.cameraRig.spectacle(point);
    this.cameraRig.shake(projectile.id === "gravity" ? 0.58 : 0.38, 0.78);
    this.slowMotionTimer = 0.45;
    this.scoreRevealAt = performance.now() + 3400;
    this.phase = "spectacle";
    this.status = `${projectile.name} impact: ${result.fracturedBodies} fractures, ${result.affectedBodies} bodies hit.`;
  }

  private playProjectileSpecial(
    projectileId: ProjectileId,
    point: THREE.Vector3,
    direction: THREE.Vector3,
    active: ActiveProjectile
  ): void {
    if (projectileId === "scatter") {
      this.spawnScatterFragments(point, direction, active.sizeScale);
      this.scoreTracker.addChainReaction(120);
      return;
    }
    if (projectileId === "gel") {
      this.bioGore.splashAt(point, 1.45);
      this.scoreTracker.addBioGelSplash(Math.round(180 * active.sizeScale * active.powerScale));
      this.scoreTracker.addChainReaction(90);
      return;
    }
    if (projectileId === "gravity") {
      const crush = this.destruction.explode(point.clone().add(new THREE.Vector3(0, -0.25, 0)), 22 * active.powerScale, 1.8 * active.sizeScale);
      this.applyExplosionResult(crush, 0.35);
      this.scoreTracker.addChainReaction(150);
    }
  }

  private applyExplosionResult(result: ExplosionResult, bioIntensity: number): void {
    const extraBio = this.bioGore.reactToExplosion(result.affectedObjects) * bioIntensity;
    this.scoreTracker.addExplosion(result, extraBio);
  }

  private processTriggers(affectedObjects: ExplosionAffectedObject[], depth: number): void {
    if (depth > 2) {
      return;
    }
    for (const affected of affectedObjects) {
      if (affected.category !== "trigger" || !affected.triggerType || this.triggeredIds.has(affected.id)) {
        continue;
      }
      if (affected.energy < 7 && !affected.fractured) {
        continue;
      }
      this.triggeredIds.add(affected.id);
      this.physics.markTriggered(affected.id);
      const position = affected.position;

      if (affected.triggerType === "shockCanister") {
        this.particles.spark(position, 0x74f0ff, 1.35);
        const chain = this.destruction.explode(position, 26, 2.65);
        this.explosion.play(position, 2.65, chain.dustColors);
        this.applyExplosionResult(chain, 0.75);
        this.scoreTracker.addChainReaction(240);
        this.processTriggers(chain.affectedObjects, depth + 1);
      } else if (affected.triggerType === "gelTank") {
        this.bioGore.splashAt(position, 1.6);
        const chain = this.destruction.explode(position, 18, 2.25);
        this.applyExplosionResult(chain, 1.35);
        this.scoreTracker.addChainReaction(190);
        this.processTriggers(chain.affectedObjects, depth + 1);
      } else {
        const boosted = this.springPulse(position);
        this.particles.spark(position, 0x70ff7a, 1.1);
        this.scoreTracker.addChainReaction(120 + boosted * 8);
      }
    }
  }

  private springPulse(origin: THREE.Vector3): number {
    let boosted = 0;
    for (const object of this.physics.getDynamicObjects()) {
      if (object.category === "projectile") {
        continue;
      }
      const position = vectorFromRapier(object.body.translation());
      const offset = position.sub(origin);
      const distance = Math.max(0.001, offset.length());
      if (distance > 2.8) {
        continue;
      }
      boosted += 1;
      const falloff = (1 - distance / 2.8) ** 2;
      const direction = offset.normalize().add(new THREE.Vector3(0, 1.2, 0)).normalize();
      const impulse = direction.multiplyScalar(16 * falloff);
      object.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      object.body.applyTorqueImpulse({ x: impulse.z * 0.35, y: impulse.x * 0.35, z: impulse.y * 0.35 }, true);
    }
    return boosted;
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
    this.status = `${PROJECTILES[id].name}: ${PROJECTILES[id].description}`;
  }

  private adjustPower(delta: number): void {
    if (!this.shotAvailable || this.phase !== "aim") {
      return;
    }
    this.powerScale = THREE.MathUtils.clamp(this.powerScale + delta, 0.65, 1.45);
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
    this.cameraRig.resize(window.innerWidth, window.innerHeight);
  }
}

async function boot(): Promise<void> {
  await RAPIER.init();
  const game = new Game();
  game.start();
}

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function distancePointToSegment(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const segment = b.clone().sub(a);
  const lengthSq = segment.lengthSq();
  if (lengthSq < 0.0001) {
    return point.distanceTo(a);
  }
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(segment) / lengthSq, 0, 1);
  return point.distanceTo(a.add(segment.multiplyScalar(t)));
}

boot().catch((error: unknown) => {
  console.error(error);
  document.body.innerHTML = `<pre style="color:#fff;background:#111;padding:24px;white-space:pre-wrap">${String(error)}</pre>`;
});

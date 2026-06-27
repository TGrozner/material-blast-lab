import * as THREE from "three";
import { beforeAll, describe, expect, test } from "vitest";
import type { MaterialDefinition } from "../../src/materialCatalog";
import { PhysicsWorld } from "../../src/physics";
import { initializeRapierCompat } from "../../src/rapierInit";

const metal: MaterialDefinition = {
  id: "metal",
  name: "Metal",
  key: "4",
  color: new THREE.Color(0x3a4652),
  dustColor: new THREE.Color(0x8ca3b5),
  density: 4.2,
  massFactor: 4.2,
  friction: 0.54,
  restitution: 0.12,
  fractureThreshold: 66,
  fragmentCount: [5, 9],
  angularResponse: 1.75,
  fragmentLife: 30,
  description: "test metal"
};

describe("support release triggers", () => {
  beforeAll(async () => {
    await initializeRapierCompat();
  });

  test("can release support objects below a high weak point", () => {
    const physics = new PhysicsWorld(new THREE.Scene());
    const renderMaterial = new THREE.MeshBasicMaterial();
    const support = physics.addDynamicBox({
      label: "lower crane support",
      material: metal,
      renderMaterial,
      position: new THREE.Vector3(0, 5, 0),
      size: new THREE.Vector3(1, 10, 1),
      category: "structure",
      supportGroupId: "crane-test",
      destructible: false,
      canFracture: false,
      bodyType: "fixed"
    });
    const weakPoint = physics.addDynamicBox({
      label: "upper crane weak point",
      material: metal,
      renderMaterial,
      position: new THREE.Vector3(0, 12, 0),
      size: new THREE.Vector3(0.5, 0.5, 0.5),
      category: "structure",
      supportGroupId: "crane-test",
      supportReleaseRadius: 3,
      supportReleaseHeight: 1,
      supportReleaseLowerHeight: 8,
      supportReleaseFallDirection: new THREE.Vector3(1, 0, 0),
      bodyType: "fixed"
    });

    physics.step(1 / 60);

    expect(physics.destabilizeUnsupportedStructures(weakPoint, new THREE.Vector3(0, 12, 0))).toBe(1);
    expect(physics.flushPendingSupportReleases(10, 0)).toBe(1);
    expect(support.bodyType).toBe("dynamic");

    physics.world.free();
  });
});

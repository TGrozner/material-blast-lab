import * as THREE from "three";

export type MaterialId = "wood" | "glass" | "concrete" | "metal" | "rubber" | "foam" | "bioGel";

export interface MaterialDefinition {
  id: MaterialId;
  name: string;
  key: string;
  color: THREE.Color;
  dustColor: THREE.Color;
  density: number;
  massFactor: number;
  friction: number;
  restitution: number;
  fractureThreshold: number;
  fragmentCount: [number, number];
  angularResponse: number;
  fragmentLife: number;
  description: string;
}

export class MaterialCatalog {
  readonly order: MaterialId[] = ["wood", "glass", "concrete", "metal", "rubber", "foam", "bioGel"];
  readonly definitions: Record<MaterialId, MaterialDefinition>;

  private readonly renderMaterials = new Map<MaterialId, THREE.Material>();
  private readonly chargeMaterial = new THREE.MeshStandardMaterial({
    color: 0x69f7ff,
    emissive: 0x1ed7ff,
    emissiveIntensity: 2.4,
    roughness: 0.22,
    metalness: 0.3
  });

  constructor() {
    this.definitions = {
      wood: {
        id: "wood",
        name: "Wood",
        key: "1",
        color: new THREE.Color(0xb86f34),
        dustColor: new THREE.Color(0xc08a4a),
        density: 0.72,
        massFactor: 1.15,
        friction: 0.72,
        restitution: 0.18,
        fractureThreshold: 17,
        fragmentCount: [9, 16],
        angularResponse: 1.05,
        fragmentLife: 20,
        description: "Medium mass, splinters into warm cuboids."
      },
      glass: {
        id: "glass",
        name: "Glass",
        key: "2",
        color: new THREE.Color(0x83f4ff),
        dustColor: new THREE.Color(0xb6fbff),
        density: 0.38,
        massFactor: 0.62,
        friction: 0.18,
        restitution: 0.58,
        fractureThreshold: 8,
        fragmentCount: [18, 30],
        angularResponse: 1.35,
        fragmentLife: 16,
        description: "Light, slick, and eager to become shards."
      },
      concrete: {
        id: "concrete",
        name: "Concrete",
        key: "3",
        color: new THREE.Color(0x858981),
        dustColor: new THREE.Color(0x9c9b91),
        density: 2.2,
        massFactor: 2.75,
        friction: 0.92,
        restitution: 0.08,
        fractureThreshold: 25,
        fragmentCount: [10, 18],
        angularResponse: 0.62,
        fragmentLife: 28,
        description: "Heavy, dusty, and slow to move."
      },
      metal: {
        id: "metal",
        name: "Metal",
        key: "4",
        color: new THREE.Color(0x3a4652),
        dustColor: new THREE.Color(0x8ca3b5),
        density: 4.2,
        massFactor: 4.2,
        friction: 0.54,
        restitution: 0.12,
        fractureThreshold: 34,
        fragmentCount: [5, 9],
        angularResponse: 1.75,
        fragmentLife: 30,
        description: "Very heavy, throws fewer spinning beams."
      },
      rubber: {
        id: "rubber",
        name: "Rubber",
        key: "5",
        color: new THREE.Color(0xe94573),
        dustColor: new THREE.Color(0xff6c92),
        density: 0.95,
        massFactor: 1.0,
        friction: 0.88,
        restitution: 0.82,
        fractureThreshold: 29,
        fragmentCount: [6, 11],
        angularResponse: 1.2,
        fragmentLife: 22,
        description: "Springy medium-weight blocks."
      },
      foam: {
        id: "foam",
        name: "Foam / Plastic",
        key: "6",
        color: new THREE.Color(0xf5d56f),
        dustColor: new THREE.Color(0xffe8a8),
        density: 0.18,
        massFactor: 0.35,
        friction: 0.24,
        restitution: 0.34,
        fractureThreshold: 11,
        fragmentCount: [11, 20],
        angularResponse: 1.55,
        fragmentLife: 14,
        description: "Very light and flies far."
      },
      bioGel: {
        id: "bioGel",
        name: "Bio-Gel",
        key: "G",
        color: new THREE.Color(0xb91d5f),
        dustColor: new THREE.Color(0xf04f8d),
        density: 0.62,
        massFactor: 0.82,
        friction: 0.68,
        restitution: 0.28,
        fractureThreshold: 10,
        fragmentCount: [12, 24],
        angularResponse: 1.45,
        fragmentLife: 18,
        description: "Fictional arcade gel for synthetic lab dummies."
      }
    };

    for (const id of this.order) {
      this.renderMaterials.set(id, this.createRenderMaterial(id));
    }
  }

  get(id: MaterialId): MaterialDefinition {
    return this.definitions[id];
  }

  getRenderMaterial(id: MaterialId): THREE.Material {
    const material = this.renderMaterials.get(id);
    if (!material) {
      throw new Error(`Unknown material ${id}`);
    }
    return material;
  }

  getChargeMaterial(): THREE.Material {
    return this.chargeMaterial;
  }

  next(id: MaterialId, direction = 1): MaterialId {
    const index = this.order.indexOf(id);
    const nextIndex = (index + direction + this.order.length) % this.order.length;
    return this.order[nextIndex];
  }

  private createRenderMaterial(id: MaterialId): THREE.Material {
    const def = this.get(id);

    if (id === "glass") {
      return new THREE.MeshPhysicalMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.42,
        roughness: 0.22,
        metalness: 0,
        transmission: 0.15,
        thickness: 0.3,
        depthWrite: false,
        envMapIntensity: 0.75
      });
    }

    if (id === "metal") {
      return new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.38,
        metalness: 0.82
      });
    }

    if (id === "rubber") {
      return new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.84,
        metalness: 0.02
      });
    }

    if (id === "foam") {
      return new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.78,
        metalness: 0.0,
        map: makeSpeckleTexture("#f8df8b", "#fff3c4", 0.22)
      });
    }

    if (id === "bioGel") {
      return new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.52,
        metalness: 0,
        emissive: new THREE.Color(0x3a0018),
        emissiveIntensity: 0.22,
        map: makeSpeckleTexture("#9f1850", "#f26aa0", 0.4)
      });
    }

    if (id === "wood") {
      return new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.65,
        metalness: 0,
        map: makeWoodTexture()
      });
    }

    return new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: 0.93,
      metalness: 0,
      map: makeSpeckleTexture("#777b75", "#a5a49d", 0.48)
    });
  }
}

function makeWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas unavailable");
  }

  const gradient = ctx.createLinearGradient(0, 0, 192, 0);
  gradient.addColorStop(0, "#7f461f");
  gradient.addColorStop(0.5, "#c17b38");
  gradient.addColorStop(1, "#8c4c22");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 192, 192);
  ctx.globalAlpha = 0.42;
  for (let y = 0; y < 192; y += 7) {
    const wobble = Math.sin(y * 0.11) * 7 + Math.sin(y * 0.03) * 11;
    ctx.strokeStyle = y % 21 === 0 ? "#522b14" : "#e0a55a";
    ctx.lineWidth = y % 21 === 0 ? 1.8 : 0.9;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(60, y + wobble, 118, y - wobble, 192, y + wobble * 0.4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSpeckleTexture(base: string, speckle: string, density: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas unavailable");
  }

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < canvas.width * canvas.height * density * 0.02; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = Math.random() * 2.2 + 0.5;
    ctx.globalAlpha = Math.random() * 0.5 + 0.2;
    ctx.fillStyle = speckle;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.2, 1.2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

import * as THREE from "three";

export type GraphicAssetId =
  | "arenaFloor"
  | "arenaWall"
  | "cannonDeck"
  | "decalAtlas"
  | "materialAtlas"
  | "skylineBackdrop";

const GRAPHIC_ASSET_PATHS: Record<GraphicAssetId, string> = {
  arenaFloor: "assets/graphics/arena-floor.png",
  arenaWall: "assets/graphics/arena-wall.png",
  cannonDeck: "assets/graphics/cannon-deck.png",
  decalAtlas: "assets/graphics/premium-decal-atlas.png",
  materialAtlas: "assets/graphics/premium-material-atlas.png",
  skylineBackdrop: "assets/graphics/skyline-backdrop.png"
};

const textureLoader = new THREE.TextureLoader();
const atlasTileCache = new Map<string, THREE.Texture>();

interface TextureOptions {
  repeat?: [number, number];
  wrap?: THREE.Wrapping;
  colorSpace?: THREE.ColorSpace;
  anisotropy?: number;
}

export function graphicAssetUrl(id: GraphicAssetId): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${GRAPHIC_ASSET_PATHS[id]}`;
}

export function graphicTexture(id: GraphicAssetId, options: TextureOptions = {}): THREE.Texture {
  const texture = textureLoader.load(graphicAssetUrl(id));
  configureTexture(texture, options);
  return texture;
}

export function materialAtlasTile(tileIndex: number): THREE.Texture {
  return atlasTile("materialAtlas", tileIndex, false);
}

export function decalAtlasTile(tileIndex: number): THREE.Texture {
  return atlasTile("decalAtlas", tileIndex, true);
}

function atlasTile(id: Extract<GraphicAssetId, "decalAtlas" | "materialAtlas">, tileIndex: number, transparent: boolean): THREE.Texture {
  const cacheKey = `${id}:${tileIndex}`;
  const cached = atlasTileCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const columns = 4;
  const rows = 4;
  const tileX = tileIndex % columns;
  const tileY = Math.floor(tileIndex / columns);
  const texture = graphicTexture(id, {
    wrap: THREE.ClampToEdgeWrapping,
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: transparent ? 4 : 8
  });

  texture.repeat.set(1 / columns, 1 / rows);
  texture.offset.set(tileX / columns, 1 - (tileY + 1) / rows);
  atlasTileCache.set(cacheKey, texture);
  return texture;
}

function configureTexture(texture: THREE.Texture, options: TextureOptions): void {
  texture.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
  texture.wrapS = options.wrap ?? THREE.RepeatWrapping;
  texture.wrapT = options.wrap ?? THREE.RepeatWrapping;
  texture.anisotropy = options.anisotropy ?? 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  if (options.repeat) {
    texture.repeat.set(options.repeat[0], options.repeat[1]);
  }
}

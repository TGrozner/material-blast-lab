import * as THREE from "three";

export type GraphicAssetId =
  | "arenaFloor"
  | "arenaWall"
  | "cannonDeck"
  | "decalAtlas"
  | "materialAtlas";

interface GraphicAssetPath {
  webp: string;
  fallback: string;
}

const GRAPHIC_ASSET_PATHS: Record<GraphicAssetId, GraphicAssetPath> = {
  arenaFloor: {
    webp: "assets/graphics/generated/arena-floor.webp",
    fallback: "assets/graphics/arena-floor.png"
  },
  arenaWall: {
    webp: "assets/graphics/generated/arena-wall.webp",
    fallback: "assets/graphics/arena-wall.png"
  },
  cannonDeck: {
    webp: "assets/graphics/generated/cannon-deck.webp",
    fallback: "assets/graphics/cannon-deck.png"
  },
  decalAtlas: {
    webp: "assets/graphics/generated/premium-decal-atlas.webp",
    fallback: "assets/graphics/premium-decal-atlas.png"
  },
  materialAtlas: {
    webp: "assets/graphics/generated/premium-material-atlas.webp",
    fallback: "assets/graphics/premium-material-atlas.png"
  }
};

const imageLoader = new THREE.ImageLoader();
const imageCache = new Map<GraphicAssetId, Promise<HTMLImageElement>>();
const textureCache = new Map<string, THREE.Texture>();
const atlasTileCache = new Map<string, THREE.Texture>();

interface TextureOptions {
  repeat?: [number, number];
  wrap?: THREE.Wrapping;
  colorSpace?: THREE.ColorSpace;
  anisotropy?: number;
}

export function graphicAssetUrl(id: GraphicAssetId): string {
  return assetUrl(GRAPHIC_ASSET_PATHS[id].webp);
}

export function preloadGraphicTextures(ids: readonly GraphicAssetId[] = Object.keys(GRAPHIC_ASSET_PATHS) as GraphicAssetId[]): Promise<void> {
  return Promise.all(ids.map((id) => loadGraphicImage(id))).then(() => undefined);
}

function graphicFallbackAssetUrl(id: GraphicAssetId): string {
  return assetUrl(GRAPHIC_ASSET_PATHS[id].fallback);
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${path}`;
}

export function graphicTexture(id: GraphicAssetId, options: TextureOptions = {}): THREE.Texture {
  const cacheKey = textureCacheKey(id, options);
  const cached = textureCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const texture = createManagedTexture(id, options);
  textureCache.set(cacheKey, texture);
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
  const texture = createManagedTexture(id, {
    wrap: THREE.ClampToEdgeWrapping,
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: transparent ? 4 : 8
  });

  texture.repeat.set(1 / columns, 1 / rows);
  texture.offset.set(tileX / columns, 1 - (tileY + 1) / rows);
  atlasTileCache.set(cacheKey, texture);
  return texture;
}

function createManagedTexture(id: GraphicAssetId, options: TextureOptions): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = `${id} generated texture`;
  configureTexture(texture, options);
  void loadGraphicImage(id)
    .then((image) => {
      texture.image = image;
      texture.needsUpdate = true;
    })
    .catch((error: unknown) => {
      console.warn(`Downtown Mayhem: texture failed to load for ${id}.`, error);
    });
  return texture;
}

function loadGraphicImage(id: GraphicAssetId): Promise<HTMLImageElement> {
  const cached = imageCache.get(id);
  if (cached) {
    return cached;
  }

  const promise = loadImage(graphicAssetUrl(id)).catch(() => loadImage(graphicFallbackAssetUrl(id)));
  imageCache.set(id, promise);
  return promise;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    imageLoader.load(url, resolve, undefined, reject);
  });
}

function textureCacheKey(id: GraphicAssetId, options: TextureOptions): string {
  return [
    id,
    options.repeat?.join("x") ?? "",
    options.wrap ?? "",
    options.colorSpace ?? "",
    options.anisotropy ?? ""
  ].join("|");
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

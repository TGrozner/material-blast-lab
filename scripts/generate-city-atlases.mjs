import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const graphicsDir = resolve(rootDir, "public/assets/graphics");
const atlasSize = 1024;
const tileSize = 256;

async function main() {
  await writeIfChanged(
    resolve(graphicsDir, "premium-material-atlas.png"),
    encodePng(atlasSize, atlasSize, generateMaterialAtlas())
  );
  await writeIfChanged(resolve(graphicsDir, "premium-decal-atlas.png"), encodePng(atlasSize, atlasSize, generateDecalAtlas()));
}

async function writeIfChanged(path, buffer) {
  try {
    const existing = await readFile(path);
    if (existing.equals(buffer)) {
      return;
    }
  } catch {
    // The caller will surface write failures; missing sources are expected on first generation.
  }
  await writeFile(path, buffer);
  console.log(`generated ${path}`);
}

function generateMaterialAtlas() {
  const pixels = createPixels(0, 0, 0, 255);
  drawMetalTile(pixels, 0, [54, 68, 76], [88, 104, 112], 13);
  drawPanelTile(pixels, 1, [35, 43, 50], [68, 78, 88], 28, 27);
  drawConcreteTile(pixels, 2, [88, 96, 98], [126, 130, 126], 19);
  drawCorrugatedTile(pixels, 3, [74, 84, 90], [101, 112, 118], 17);
  drawHazardTile(pixels, 4);
  drawRollupDoorTile(pixels, 5);
  drawAsphaltTile(pixels, 6);
  drawPaintedTile(pixels, 7, [222, 188, 74], [246, 217, 104], 31);
  drawGlassTile(pixels, 8);
  drawConcretePanelTile(pixels, 9);
  drawMetalTile(pixels, 10, [112, 124, 130], [168, 178, 180], 43);
  drawPanelTile(pixels, 11, [62, 52, 82], [108, 94, 138], 36, 57);
  drawRoofTarTile(pixels, 12);
  drawBrickTile(pixels, 13);
  drawWoodTile(pixels, 14);
  drawLightConcreteTile(pixels, 15);
  return pixels;
}

function generateDecalAtlas() {
  const pixels = createPixels(255, 255, 255, 0);
  drawScuffDecal(pixels, 0);
  drawCrackDecal(pixels, 1);
  drawPatchDecal(pixels, 2);
  drawHazardStripeDecal(pixels, 3);
  drawScorchDecal(pixels, 4);
  drawArrowDecal(pixels, 5);
  drawDustDecal(pixels, 6);
  drawCurbWearDecal(pixels, 7);
  drawGlassDecal(pixels, 8);
  drawTireDecal(pixels, 9);
  drawDrainDecal(pixels, 10);
  drawOilDecal(pixels, 11);
  drawPotholeDecal(pixels, 12);
  drawPosterDecal(pixels, 13);
  drawScratchDecal(pixels, 14);
  drawLoadingStencilDecal(pixels, 15);
  return pixels;
}

function createPixels(r, g, b, a) {
  const pixels = Buffer.alloc(atlasSize * atlasSize * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = r;
    pixels[index + 1] = g;
    pixels[index + 2] = b;
    pixels[index + 3] = a;
  }
  return pixels;
}

function fillTile(pixels, tile, base, variance, seed) {
  eachTilePixel(tile, (x, y, localX, localY) => {
    const grain = noise(localX, localY, seed) - 0.5;
    const streak = (noise(localX, Math.floor(localY / 6), seed + 71) - 0.5) * 0.5;
    const shade = Math.round((grain + streak) * variance);
    setPixel(pixels, x, y, [base[0] + shade, base[1] + shade, base[2] + shade], 255);
  });
}

function drawMetalTile(pixels, tile, base, highlight, seed) {
  fillTile(pixels, tile, base, 18, seed);
  const { x, y } = tileOrigin(tile);
  for (let localY = 10; localY < tileSize; localY += 18) {
    drawRect(pixels, x, y + localY, tileSize, 1, [base[0] - 18, base[1] - 18, base[2] - 18], 255);
  }
  for (let localX = 14; localX < tileSize; localX += 32) {
    drawRect(pixels, x + localX, y + 8, 2, tileSize - 16, [highlight[0], highlight[1], highlight[2]], 70);
  }
  for (let localX = 28; localX < tileSize; localX += 50) {
    for (let localY = 28; localY < tileSize; localY += 54) {
      drawCircle(pixels, x + localX, y + localY, 3, [28, 34, 39], 255);
      drawCircle(pixels, x + localX - 1, y + localY - 1, 1, [180, 188, 188], 190);
    }
  }
  drawRandomScratches(pixels, tile, seed + 101, [205, 213, 214], 24);
}

function drawPanelTile(pixels, tile, base, line, spacing, seed) {
  fillTile(pixels, tile, base, 14, seed);
  const { x, y } = tileOrigin(tile);
  for (let localX = 0; localX <= tileSize; localX += spacing) {
    drawRect(pixels, x + localX, y, 2, tileSize, [line[0] - 24, line[1] - 24, line[2] - 24], 255);
    drawRect(pixels, x + localX + 2, y, 1, tileSize, line, 170);
  }
  for (let localY = 38; localY < tileSize; localY += 54) {
    drawRect(pixels, x, y + localY, tileSize, 2, [line[0] - 30, line[1] - 30, line[2] - 30], 255);
    drawRect(pixels, x, y + localY + 2, tileSize, 1, line, 150);
  }
}

function drawConcreteTile(pixels, tile, base, mark, seed) {
  fillTile(pixels, tile, base, 22, seed);
  const { x, y } = tileOrigin(tile);
  for (let localX = 64; localX < tileSize; localX += 64) {
    drawRect(pixels, x + localX, y, 2, tileSize, [64, 70, 71], 170);
  }
  for (let localY = 64; localY < tileSize; localY += 64) {
    drawRect(pixels, x, y + localY, tileSize, 2, [64, 70, 71], 170);
  }
  for (let index = 0; index < 14; index += 1) {
    const localX = Math.floor(rand(seed + index * 17) * 214) + 18;
    const localY = Math.floor(rand(seed + index * 31) * 214) + 18;
    drawBlob(pixels, x + localX, y + localY, 8 + Math.floor(rand(seed + index * 7) * 18), mark, 42);
  }
  drawJaggedLine(pixels, tile, [[22, 188], [72, 168], [104, 184], [156, 148], [214, 158]], [42, 48, 50], 130);
}

function drawCorrugatedTile(pixels, tile) {
  fillTile(pixels, tile, [76, 87, 92], 13, 73);
  const { x, y } = tileOrigin(tile);
  for (let localX = 8; localX < tileSize; localX += 14) {
    drawRect(pixels, x + localX, y, 3, tileSize, [42, 50, 55], 150);
    drawRect(pixels, x + localX + 3, y, 2, tileSize, [118, 130, 134], 90);
  }
  for (let localY = 36; localY < tileSize; localY += 58) {
    drawRect(pixels, x + 12, y + localY, tileSize - 24, 2, [38, 44, 48], 175);
  }
}

function drawHazardTile(pixels, tile) {
  fillTile(pixels, tile, [112, 52, 38], 28, 91);
  const { x, y } = tileOrigin(tile);
  drawRect(pixels, x + 15, y + 164, 226, 46, [42, 34, 25], 255);
  for (let offset = -60; offset < 260; offset += 36) {
    drawDiagonalBand(pixels, x + offset, y + 164, 18, 90, [226, 176, 57], 255);
  }
  drawRect(pixels, x + 22, y + 32, 212, 3, [52, 25, 22], 180);
  drawRect(pixels, x + 22, y + 92, 212, 2, [52, 25, 22], 145);
  drawBlob(pixels, x + 196, y + 64, 36, [36, 19, 16], 70);
}

function drawRollupDoorTile(pixels, tile) {
  fillTile(pixels, tile, [74, 82, 86], 12, 103);
  const { x, y } = tileOrigin(tile);
  drawFrame(pixels, x + 24, y + 20, 208, 214, [33, 40, 44], 255, 5);
  for (let localY = 34; localY < 222; localY += 13) {
    drawRect(pixels, x + 30, y + localY, 196, 2, [42, 49, 52], 255);
    drawRect(pixels, x + 30, y + localY + 2, 196, 1, [122, 134, 138], 110);
  }
  drawRect(pixels, x + 104, y + 174, 48, 9, [22, 27, 30], 190);
}

function drawAsphaltTile(pixels, tile) {
  fillTile(pixels, tile, [22, 26, 28], 22, 127);
  const { x, y } = tileOrigin(tile);
  for (let index = 0; index < 2400; index += 1) {
    const localX = Math.floor(rand(index * 7 + 2) * tileSize);
    const localY = Math.floor(rand(index * 13 + 5) * tileSize);
    const tone = 25 + Math.floor(rand(index * 19 + 11) * 42);
    setPixel(pixels, x + localX, y + localY, [tone, tone + 2, tone + 3], 255);
  }
  drawRect(pixels, x + 74, y, 10, tileSize, [12, 15, 17], 95);
  drawRect(pixels, x + 152, y, 8, tileSize, [10, 13, 15], 80);
}

function drawPaintedTile(pixels, tile, base, high, seed) {
  fillTile(pixels, tile, base, 16, seed);
  const { x, y } = tileOrigin(tile);
  for (let localX = 22; localX < tileSize; localX += 48) {
    drawRect(pixels, x + localX, y + 18, 4, tileSize - 36, [high[0], high[1], high[2]], 80);
  }
  for (let index = 0; index < 30; index += 1) {
    const cx = x + 16 + Math.floor(rand(seed + index * 11) * 224);
    const cy = y + 16 + Math.floor(rand(seed + index * 23) * 224);
    drawBlob(pixels, cx, cy, 4 + Math.floor(rand(seed + index * 37) * 12), [65, 58, 42], 85);
  }
}

function drawGlassTile(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  fillTile(pixels, tile, [54, 100, 112], 16, 151);
  for (let localX = 0; localX <= tileSize; localX += 42) {
    drawRect(pixels, x + localX, y, 3, tileSize, [28, 52, 62], 210);
    drawRect(pixels, x + localX + 3, y, 2, tileSize, [126, 196, 205], 92);
  }
  for (let localY = 0; localY <= tileSize; localY += 48) {
    drawRect(pixels, x, y + localY, tileSize, 3, [24, 48, 58], 205);
    drawRect(pixels, x, y + localY + 3, tileSize, 2, [122, 198, 210], 76);
  }
  for (let offset = -120; offset < 260; offset += 92) {
    drawDiagonalBand(pixels, x + offset, y + 10, 8, 360, [173, 234, 236], 70);
  }
}

function drawConcretePanelTile(pixels, tile) {
  fillTile(pixels, tile, [72, 80, 84], 18, 181);
  const { x, y } = tileOrigin(tile);
  for (let localX = 48; localX < tileSize; localX += 80) {
    drawRect(pixels, x + localX, y + 8, 2, tileSize - 16, [43, 49, 52], 170);
  }
  for (let localY = 42; localY < tileSize; localY += 72) {
    drawRect(pixels, x + 8, y + localY, tileSize - 16, 2, [43, 49, 52], 170);
  }
  drawRandomScratches(pixels, tile, 181, [175, 183, 184], 18);
}

function drawRoofTarTile(pixels, tile) {
  fillTile(pixels, tile, [31, 38, 42], 16, 211);
  const { x, y } = tileOrigin(tile);
  for (let localX = 28; localX < tileSize; localX += 64) {
    drawRect(pixels, x + localX, y + 10, 3, tileSize - 20, [18, 24, 27], 180);
  }
  for (let localY = 48; localY < tileSize; localY += 76) {
    drawRect(pixels, x + 10, y + localY, tileSize - 20, 2, [55, 64, 68], 82);
  }
  drawRect(pixels, x + 138, y + 70, 70, 44, [42, 49, 52], 115);
  drawRect(pixels, x + 34, y + 156, 94, 50, [19, 24, 27], 100);
}

function drawBrickTile(pixels, tile) {
  fillTile(pixels, tile, [100, 72, 54], 18, 241);
  const { x, y } = tileOrigin(tile);
  for (let localY = 0; localY < tileSize; localY += 22) {
    drawRect(pixels, x, y + localY, tileSize, 2, [55, 43, 36], 190);
    const offset = localY % 44 === 0 ? 0 : 34;
    for (let localX = -offset; localX < tileSize; localX += 68) {
      drawRect(pixels, x + localX, y + localY, 2, 22, [55, 43, 36], 160);
    }
  }
  drawBlob(pixels, x + 190, y + 72, 26, [42, 31, 26], 45);
}

function drawWoodTile(pixels, tile) {
  fillTile(pixels, tile, [105, 68, 38], 24, 271);
  const { x, y } = tileOrigin(tile);
  for (let localX = 32; localX < tileSize; localX += 42) {
    drawRect(pixels, x + localX, y, 3, tileSize, [58, 35, 20], 180);
  }
  for (let localY = 14; localY < tileSize; localY += 28) {
    drawRect(pixels, x, y + localY, tileSize, 1, [150, 98, 50], 62);
  }
  drawJaggedLine(pixels, tile, [[12, 70], [70, 82], [128, 68], [194, 96], [244, 84]], [53, 32, 18], 130);
}

function drawLightConcreteTile(pixels, tile) {
  fillTile(pixels, tile, [178, 178, 166], 20, 307);
  const { x, y } = tileOrigin(tile);
  for (let localX = 0; localX <= tileSize; localX += 72) {
    drawRect(pixels, x + localX, y, 2, tileSize, [126, 124, 116], 150);
  }
  for (let localY = 0; localY <= tileSize; localY += 64) {
    drawRect(pixels, x, y + localY, tileSize, 2, [126, 124, 116], 150);
  }
  drawBlob(pixels, x + 72, y + 176, 24, [105, 105, 100], 35);
  drawBlob(pixels, x + 192, y + 72, 18, [240, 238, 218], 32);
}

function drawScuffDecal(pixels, tile) {
  for (let index = 0; index < 32; index += 1) {
    drawDecalLine(pixels, tile, 25 + rand(index) * 206, 25 + rand(index + 9) * 206, 54 + rand(index + 19) * 88, -0.3 + rand(index + 29) * 0.6, 1 + Math.floor(rand(index + 39) * 4), 56);
  }
}

function drawCrackDecal(pixels, tile) {
  drawJaggedLine(pixels, tile, [[26, 122], [70, 106], [104, 128], [146, 94], [198, 116], [232, 92]], [255, 255, 255], 210);
  drawJaggedLine(pixels, tile, [[112, 128], [98, 166], [126, 210]], [255, 255, 255], 150);
}

function drawPatchDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  drawRect(pixels, x + 36, y + 42, 176, 152, [255, 255, 255], 72);
  drawFrame(pixels, x + 36, y + 42, 176, 152, [255, 255, 255], 150, 3);
  for (let localY = 58; localY < 190; localY += 32) {
    drawRect(pixels, x + 48, y + localY, 152, 2, [255, 255, 255], 88);
  }
}

function drawHazardStripeDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  for (let offset = -160; offset < 300; offset += 42) {
    drawDiagonalBand(pixels, x + offset, y - 20, 20, 330, [255, 255, 255], 255);
  }
  drawFrame(pixels, x + 18, y + 18, 220, 220, [255, 255, 255], 160, 3);
}

function drawScorchDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  for (let radius = 108; radius > 18; radius -= 12) {
    drawBlob(pixels, x + 128, y + 128, radius, [255, 255, 255], Math.max(18, 118 - radius));
  }
  for (let index = 0; index < 12; index += 1) {
    drawDecalLine(pixels, tile, 128, 128, 60 + rand(index) * 80, rand(index + 33) * Math.PI * 2, 2, 54);
  }
}

function drawArrowDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  drawRect(pixels, x + 108, y + 66, 40, 116, [255, 255, 255], 245);
  drawTriangle(pixels, x + 128, y + 34, x + 68, y + 100, x + 188, y + 100, [255, 255, 255], 245);
  drawRect(pixels, x + 58, y + 200, 140, 12, [255, 255, 255], 135);
  drawRect(pixels, x + 78, y + 222, 100, 8, [255, 255, 255], 90);
}

function drawDustDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  for (let index = 0; index < 90; index += 1) {
    drawBlob(
      pixels,
      x + 12 + Math.floor(rand(index * 5) * 232),
      y + 12 + Math.floor(rand(index * 7) * 232),
      3 + Math.floor(rand(index * 11) * 14),
      [255, 255, 255],
      12 + Math.floor(rand(index * 13) * 44)
    );
  }
}

function drawCurbWearDecal(pixels, tile) {
  for (let index = 0; index < 11; index += 1) {
    drawDecalLine(pixels, tile, 34, 24 + index * 19, 184, 0.02 + rand(index) * 0.08, 3, 58 + Math.floor(rand(index + 5) * 80));
  }
  drawDecalLine(pixels, tile, 52, 206, 160, -0.08, 5, 150);
}

function drawGlassDecal(pixels, tile) {
  for (let index = 0; index < 18; index += 1) {
    drawDecalLine(pixels, tile, 128, 128, 22 + rand(index) * 112, rand(index + 17) * Math.PI * 2, 1, 145);
  }
  for (let index = 0; index < 16; index += 1) {
    const { x, y } = tileOrigin(tile);
    drawTriangle(
      pixels,
      x + 40 + rand(index) * 176,
      y + 44 + rand(index + 3) * 172,
      x + 40 + rand(index + 5) * 176,
      y + 44 + rand(index + 7) * 172,
      x + 40 + rand(index + 11) * 176,
      y + 44 + rand(index + 13) * 172,
      [255, 255, 255],
      64
    );
  }
}

function drawTireDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  for (const centerX of [88, 168]) {
    for (let localY = 12; localY < 244; localY += 18) {
      drawRect(pixels, x + centerX - 14, y + localY, 28, 10, [255, 255, 255], 105);
      drawRect(pixels, x + centerX - 10, y + localY + 10, 20, 4, [255, 255, 255], 55);
    }
  }
}

function drawDrainDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  drawFrame(pixels, x + 58, y + 58, 140, 140, [255, 255, 255], 210, 5);
  for (let localX = 74; localX < 190; localX += 18) {
    drawRect(pixels, x + localX, y + 68, 4, 120, [255, 255, 255], 180);
  }
  for (let localY = 78; localY < 180; localY += 32) {
    drawRect(pixels, x + 68, y + localY, 120, 3, [255, 255, 255], 105);
  }
}

function drawOilDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  drawBlob(pixels, x + 116, y + 134, 70, [255, 255, 255], 105);
  drawBlob(pixels, x + 164, y + 112, 36, [255, 255, 255], 70);
  drawBlob(pixels, x + 84, y + 168, 30, [255, 255, 255], 62);
}

function drawPotholeDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  drawBlob(pixels, x + 128, y + 128, 84, [255, 255, 255], 118);
  drawBlob(pixels, x + 118, y + 118, 46, [255, 255, 255], 170);
  drawJaggedLine(pixels, tile, [[38, 126], [86, 114], [128, 128], [176, 100], [222, 112]], [255, 255, 255], 150);
}

function drawPosterDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  drawRect(pixels, x + 48, y + 36, 160, 184, [255, 255, 255], 68);
  drawRect(pixels, x + 62, y + 56, 132, 24, [255, 255, 255], 210);
  drawRect(pixels, x + 62, y + 98, 90, 14, [255, 255, 255], 145);
  drawRect(pixels, x + 62, y + 128, 116, 14, [255, 255, 255], 105);
  drawRect(pixels, x + 62, y + 166, 74, 14, [255, 255, 255], 132);
}

function drawScratchDecal(pixels, tile) {
  for (let index = 0; index < 24; index += 1) {
    drawDecalLine(
      pixels,
      tile,
      18 + rand(index * 5) * 218,
      24 + rand(index * 7) * 208,
      38 + rand(index * 11) * 80,
      -0.9 + rand(index * 13) * 1.8,
      1,
      95 + Math.floor(rand(index * 17) * 95)
    );
  }
}

function drawLoadingStencilDecal(pixels, tile) {
  const { x, y } = tileOrigin(tile);
  drawFrame(pixels, x + 34, y + 54, 188, 148, [255, 255, 255], 160, 4);
  for (let index = 0; index < 4; index += 1) {
    drawRect(pixels, x + 62 + index * 34, y + 88, 16, 82, [255, 255, 255], 205);
  }
  drawRect(pixels, x + 54, y + 178, 148, 8, [255, 255, 255], 145);
}

function drawRandomScratches(pixels, tile, seed, color, count) {
  for (let index = 0; index < count; index += 1) {
    drawDecalLine(
      pixels,
      tile,
      16 + rand(seed + index * 3) * 224,
      18 + rand(seed + index * 5) * 220,
      22 + rand(seed + index * 7) * 64,
      -0.35 + rand(seed + index * 11) * 0.7,
      1,
      50 + Math.floor(rand(seed + index * 13) * 70),
      color
    );
  }
}

function drawDecalLine(pixels, tile, startX, startY, length, angle, width, alpha, color = [255, 255, 255]) {
  const { x, y } = tileOrigin(tile);
  const steps = Math.max(2, Math.round(length));
  for (let step = 0; step < steps; step += 1) {
    const t = step / Math.max(1, steps - 1);
    const px = x + Math.round(startX + Math.cos(angle) * length * t);
    const py = y + Math.round(startY + Math.sin(angle) * length * t);
    drawCircle(pixels, px, py, width, color, alpha);
  }
}

function drawJaggedLine(pixels, tile, points, color, alpha) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    drawDecalLine(pixels, tile, x0, y0, Math.hypot(dx, dy), Math.atan2(dy, dx), 1, alpha, color);
  }
}

function drawBlob(pixels, centerX, centerY, radius, color, alpha) {
  const radiusSq = radius * radius;
  for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y += 1) {
    for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) {
        continue;
      }
      const edge = 1 - Math.sqrt(distSq) / radius;
      blendPixel(pixels, x, y, color, Math.round(alpha * edge));
    }
  }
}

function drawDiagonalBand(pixels, x, y, width, length, color, alpha) {
  for (let offset = 0; offset < length; offset += 1) {
    for (let inset = -width; inset <= width; inset += 1) {
      blendPixel(pixels, Math.round(x + offset + inset), Math.round(y + offset), color, alpha);
    }
  }
}

function drawTriangle(pixels, x0, y0, x1, y1, x2, y2, color, alpha) {
  const minX = Math.floor(Math.min(x0, x1, x2));
  const maxX = Math.ceil(Math.max(x0, x1, x2));
  const minY = Math.floor(Math.min(y0, y1, y2));
  const maxY = Math.ceil(Math.max(y0, y1, y2));
  const area = edge(x0, y0, x1, y1, x2, y2);
  if (area === 0) {
    return;
  }
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const w0 = edge(x1, y1, x2, y2, x, y);
      const w1 = edge(x2, y2, x0, y0, x, y);
      const w2 = edge(x0, y0, x1, y1, x, y);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        blendPixel(pixels, x, y, color, alpha);
      }
    }
  }
}

function edge(x0, y0, x1, y1, x2, y2) {
  return (x2 - x0) * (y1 - y0) - (y2 - y0) * (x1 - x0);
}

function drawFrame(pixels, x, y, width, height, color, alpha, thickness) {
  drawRect(pixels, x, y, width, thickness, color, alpha);
  drawRect(pixels, x, y + height - thickness, width, thickness, color, alpha);
  drawRect(pixels, x, y, thickness, height, color, alpha);
  drawRect(pixels, x + width - thickness, y, thickness, height, color, alpha);
}

function drawRect(pixels, x, y, width, height, color, alpha) {
  const minX = Math.max(0, Math.floor(x));
  const minY = Math.max(0, Math.floor(y));
  const maxX = Math.min(atlasSize, Math.ceil(x + width));
  const maxY = Math.min(atlasSize, Math.ceil(y + height));
  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      blendPixel(pixels, px, py, color, alpha);
    }
  }
}

function drawCircle(pixels, centerX, centerY, radius, color, alpha) {
  const radiusSq = radius * radius;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSq) {
        blendPixel(pixels, x, y, color, alpha);
      }
    }
  }
}

function blendPixel(pixels, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= atlasSize || y >= atlasSize || alpha <= 0) {
    return;
  }
  const index = (Math.floor(y) * atlasSize + Math.floor(x)) * 4;
  const srcAlpha = Math.min(255, alpha) / 255;
  const dstAlpha = pixels[index + 3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
  if (outAlpha <= 0) {
    return;
  }
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = clampByte((color[channel] * srcAlpha + pixels[index + channel] * dstAlpha * (1 - srcAlpha)) / outAlpha);
  }
  pixels[index + 3] = clampByte(outAlpha * 255);
}

function setPixel(pixels, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= atlasSize || y >= atlasSize) {
    return;
  }
  const index = (y * atlasSize + x) * 4;
  pixels[index] = clampByte(color[0]);
  pixels[index + 1] = clampByte(color[1]);
  pixels[index + 2] = clampByte(color[2]);
  pixels[index + 3] = alpha;
}

function eachTilePixel(tile, callback) {
  const { x, y } = tileOrigin(tile);
  for (let localY = 0; localY < tileSize; localY += 1) {
    for (let localX = 0; localX < tileSize; localX += 1) {
      callback(x + localX, y + localY, localX, localY);
    }
  }
}

function tileOrigin(tile) {
  return {
    x: (tile % 4) * tileSize,
    y: Math.floor(tile / 4) * tileSize
  };
}

function rand(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function noise(x, y, seed) {
  return rand(x * 0.173 + y * 0.271 + seed * 0.037);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function encodePng(width, height, pixels) {
  const scanlineLength = width * 4 + 1;
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * scanlineLength;
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

await main();

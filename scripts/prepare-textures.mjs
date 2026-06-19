import { access, mkdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const graphicsDir = resolve("public/assets/graphics");
const generatedDir = join(graphicsDir, "generated");
const sourceFiles = [
  "arena-floor.png",
  "arena-wall.png",
  "cannon-deck.png",
  "premium-decal-atlas.png",
  "premium-material-atlas.png"
];

await mkdir(generatedDir, { recursive: true });

const ffmpeg = await hasCommand("ffmpeg");
if (!ffmpeg) {
  await ensureExistingGeneratedTextures();
  console.warn("ffmpeg not found; using existing generated WebP textures.");
  process.exit(0);
}

for (const sourceName of sourceFiles) {
  const sourcePath = join(graphicsDir, sourceName);
  const targetPath = join(generatedDir, `${basename(sourceName, ".png")}.webp`);
  if (!(await shouldRegenerate(sourcePath, targetPath))) {
    continue;
  }
  await run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sourcePath,
    "-c:v",
    "libwebp",
    "-quality",
    "82",
    "-compression_level",
    "6",
    targetPath
  ]);
  console.log(`prepared texture ${sourceName} -> ${targetPath}`);
}

async function ensureExistingGeneratedTextures() {
  for (const sourceName of sourceFiles) {
    const targetPath = join(generatedDir, `${basename(sourceName, ".png")}.webp`);
    await access(targetPath);
  }
}

async function shouldRegenerate(sourcePath, targetPath) {
  try {
    const [source, target] = await Promise.all([stat(sourcePath), stat(targetPath)]);
    return source.mtimeMs > target.mtimeMs;
  } catch {
    return true;
  }
}

async function hasCommand(command) {
  try {
    await run(command, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: dirname(resolve("package.json")),
      stdio: options.stdio ?? "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown"}`));
      }
    });
  });
}

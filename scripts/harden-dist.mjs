import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const JavaScriptObfuscator = require("javascript-obfuscator");

const defaultDistDir = fileURLToPath(new URL("../dist/", import.meta.url));
const distDir = resolve(process.env.DIST_DIR ?? defaultDistDir);
const distAssetsDir = join(distDir, "assets");
const includeVendor = process.env.OBFUSCATE_VENDOR === "true";

const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  ignoreImports: true,
  numbersToExpressions: true,
  renameGlobals: false,
  seed: 20260616,
  selfDefending: false,
  simplify: true,
  sourceMap: false,
  splitStrings: false,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.35,
  stringArrayEncoding: ["base64"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.45,
  target: "browser",
  transformObjectKeys: false,
  unicodeEscapeSequence: false
};

const jsFiles = (await listFiles(distAssetsDir)).filter((file) => extname(file) === ".js").sort();
const appFiles = jsFiles.filter((file) => basename(file).startsWith("app-"));
const targetFiles = includeVendor ? jsFiles : appFiles;

if (targetFiles.length === 0) {
  throw new Error("No JavaScript application chunks found in dist/assets.");
}

const replacements = new Map();

for (const file of targetFiles) {
  const oldName = basename(file);
  const before = await readFile(file, "utf8");
  const result = JavaScriptObfuscator.obfuscate(before, obfuscationOptions);
  const after = result.getObfuscatedCode();
  const newName = hashedFileName(oldName, after);
  const newPath = join(dirname(file), newName);

  await writeFile(file, after);

  if (newName !== oldName) {
    await rename(file, newPath);
    replacements.set(oldName, newName);
  }

  console.log(
    `hardened ${oldName} -> ${newName} ` +
      `${formatSize(Buffer.byteLength(before))} -> ${formatSize(Buffer.byteLength(after))} ` +
      `(gzip ${formatSize(gzipSize(after))}, br ${formatSize(brotliSize(after))})`
  );
}

await rewriteDistReferences(replacements);

if (!includeVendor) {
  for (const file of jsFiles.filter((file) => !targetFiles.includes(file))) {
    console.log(`left vendor chunk minified-only: ${basename(file)}`);
  }
}

function hashedFileName(fileName, source) {
  const hash = createHash("sha256").update(source).digest("base64url").slice(0, 8);
  const rewritten = fileName.replace(/-[A-Za-z0-9_-]+\.js$/, `-${hash}.js`);

  return rewritten === fileName ? `${fileName.slice(0, -3)}-${hash}.js` : rewritten;
}

async function rewriteDistReferences(replacementMap) {
  if (replacementMap.size === 0) {
    return;
  }

  const textFiles = (await listFiles(distDir))
    .filter((file) => [".html", ".js", ".css", ".json", ".md"].includes(extname(file)))
    .sort();

  for (const file of textFiles) {
    let source = await readFile(file, "utf8");
    const originalSource = source;

    for (const [from, to] of replacementMap) {
      source = source.replaceAll(from, to);
    }

    if (source !== originalSource) {
      await writeFile(file, source);
    }
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : path;
    })
  );

  return files.flat();
}

function gzipSize(source) {
  return gzipSync(source, { level: 9 }).byteLength;
}

function brotliSize(source) {
  return brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11
    }
  }).byteLength;
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KiB`;
}

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("service worker generator", () => {
  test("generates a cache policy limited to precache URLs without query variants", async () => {
    const distDir = await mkdtemp(join(tmpdir(), "downtown-mayhem-sw-"));
    try {
      await mkdir(join(distDir, "assets"));
      await writeFile(join(distDir, "index.html"), "<div id=\"app\"></div>", "utf8");
      await writeFile(join(distDir, "assets", "app.js"), "console.log('ok');", "utf8");

      await execFileAsync(process.execPath, [new URL("../../scripts/write-service-worker.mjs", import.meta.url).pathname], {
        env: {
          ...process.env,
          BASE_PATH: "/downtown-mayhem/",
          DIST_DIR: distDir
        }
      });

      const source = await readFile(join(distDir, "sw.js"), "utf8");

      expect(source).toContain("const PRECACHE_URL_SET = new Set(PRECACHE_URLS);");
      expect(source).toContain("if (url.search) {");
      expect(source).toContain("return PRECACHE_URL_SET.has(url.pathname) ? url.pathname : null;");
      expect(source).toContain("await cache.put(BASE_PATH, response.clone());");
      expect(source).not.toContain("cache.put(request, response.clone())");
    } finally {
      await rm(distDir, { recursive: true, force: true });
    }
  });
});

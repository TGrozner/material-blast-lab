import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const basePath = process.env.BASE_PATH ?? "/";
const PERF_LOG_ENDPOINT = "/__downtown-mayhem/perf-log";
const PERF_LOG_DIR = path.resolve(process.cwd(), process.env.DOWNTOWN_MAYHEM_PERF_DIR ?? "test-results/perf-logs");

export default defineConfig({
  base: basePath,
  plugins: [downtownMayhemPerfLogPlugin()],
  build: {
    cssMinify: "lightningcss",
    license: true,
    minify: "oxc",
    reportCompressedSize: true,
    chunkSizeWarningLimit: 2300,
    sourcemap: false,
    target: "baseline-widely-available",
    rolldownOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        codeSplitting: {
          minSize: 20000,
          groups: [
            {
              name: "vendor-three",
              test: /[/\\]node_modules[/\\]three[/\\]/
            },
            {
              name: "vendor-rapier",
              test: /[/\\]node_modules[/\\]@dimforge[/\\]rapier3d-compat[/\\]/
            }
          ]
        },
        entryFileNames: "assets/app-[hash].js",
        minifyInternalExports: true
      }
    }
  }
});

function downtownMayhemPerfLogPlugin(): Plugin {
  return {
    name: "downtown-mayhem-perf-log",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(PERF_LOG_ENDPOINT, (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        void writePerfLogRequest(req, res).catch(next);
      });
    }
  };
}

async function writePerfLogRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readRequestBody(req, 2_000_000);
  const payload = JSON.parse(body) as { sessionId?: unknown };
  const sessionId = sanitizePerfSessionId(payload.sessionId);
  const record = {
    receivedAt: new Date().toISOString(),
    ...payload,
    sessionId
  };

  await fs.mkdir(PERF_LOG_DIR, { recursive: true });
  await Promise.all([
    fs.appendFile(path.join(PERF_LOG_DIR, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`, "utf8"),
    fs.writeFile(path.join(PERF_LOG_DIR, "latest-session.txt"), `${sessionId}\n`, "utf8"),
    fs.writeFile(path.join(PERF_LOG_DIR, "latest.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8")
  ]);

  res.statusCode = 204;
  res.end();
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Perf log payload exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sanitizePerfSessionId(value: unknown): string {
  const fallback = new Date().toISOString().replaceAll(/[.:]/g, "-");
  if (typeof value !== "string") {
    return fallback;
  }
  const safe = value.replaceAll(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96);
  return safe || fallback;
}

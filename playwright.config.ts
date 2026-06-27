import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4175);
const host = "127.0.0.1";
const baseURL = `http://${host}:${port}/`;
const browserChannel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : "chrome");
const reuseExistingServer = !process.env.CI && process.env.DOWNTOWN_MAYHEM_PERF_SMOKE !== "true";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    actionTimeout: 2_000,
    navigationTimeout: 5_000,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
    channel: browserChannel,
    launchOptions: {
      args: ["--enable-unsafe-swiftshader"]
    }
  },
  webServer: {
    command: `npm run dev -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    timeout: 30_000,
    reuseExistingServer
  }
});

import { expect, test } from "@playwright/test";

test("renders the city trial, keeps the mobile HUD contained, and fires one shot", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator(".hud")).toBeVisible();
  await expect(page.locator(".hud [data-role='chamber']")).toHaveText("Quarantine Junction");
  await expect(page.getByRole("button", { name: "FIRE" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Hammer" })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(hasRenderableCanvasSize)).toBe(true);
  await expect.poll(() => page.evaluate(hasWebglContext)).toBe(true);
  await expect.poll(() => page.evaluate(currentBodyCount)).toBeGreaterThan(350);
  await expect.poll(() => page.evaluate(currentBodyCount)).toBeLessThan(700);
  await expect(page.evaluate(isHudWithinViewport)).resolves.toBe(true);

  await page.keyboard.press("Space");

  await expect(page.getByRole("button", { name: "FIRE" })).toBeDisabled();
  expect(consoleErrors).toEqual([]);
});

function hasRenderableCanvasSize(): boolean {
  const canvas = document.querySelector("canvas");
  return canvas instanceof HTMLCanvasElement && canvas.width >= 300 && canvas.height >= 300;
}

function hasWebglContext(): boolean {
  const canvas = document.querySelector("canvas");
  return canvas instanceof HTMLCanvasElement && Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}

function currentBodyCount(): number {
  return Number(document.querySelector(".hud [data-role='bodies']")?.textContent ?? 0);
}

function isHudWithinViewport(): boolean {
  const hud = document.querySelector(".hud");
  if (!hud) {
    return false;
  }
  const elements = [hud, ...Array.from(hud.querySelectorAll("*"))];
  return elements.every((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= window.innerWidth + 1;
  });
}

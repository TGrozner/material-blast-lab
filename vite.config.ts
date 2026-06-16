import { defineConfig } from "vite";

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath
});

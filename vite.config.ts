import { defineConfig } from "vite";

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  build: {
    cssMinify: "lightningcss",
    license: true,
    minify: "oxc",
    reportCompressedSize: true,
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
              name: "vendor-three-webgpu",
              test: /[/\\]node_modules[/\\]three[/\\](?:build[/\\]three\.webgpu|src[/\\](?:Three\.WebGPU|renderers[/\\](?:common|webgpu|webgl-fallback)|nodes|materials[/\\]nodes|lights[/\\]webgpu))/
            },
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

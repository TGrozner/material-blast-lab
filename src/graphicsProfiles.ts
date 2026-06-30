import * as THREE from "three";
import { GRAPHICS_QUALITY_LABELS, type GameSettings, type GraphicsQuality } from "./settings";

export interface GraphicsLightingProfile {
  background: THREE.ColorRepresentation;
  fog: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
  exposure: number;
  ambientSky: THREE.ColorRepresentation;
  ambientGround: THREE.ColorRepresentation;
  ambientIntensity: number;
  sunColor: THREE.ColorRepresentation;
  sunIntensity: number;
  skyFillColor: THREE.ColorRepresentation;
  skyFillIntensity: number;
  shadowMapSize: number;
}

export interface CanvasGradeProfile {
  filter: string;
  boxShadow: string;
}

export function settingsStatus(settings: GameSettings): string {
  return `${GRAPHICS_QUALITY_LABELS[settings.graphicsQuality]}, WebGL renderer, ${Math.round(settings.masterVolume * 100)}% volume, ${Math.round(settings.cameraShake * 100)}% shake`;
}

export function graphicsLightingProfile(quality: GraphicsQuality): GraphicsLightingProfile {
  switch (quality) {
    case "performance":
      return {
        background: 0x8fc7dc,
        fog: 0xcfd2c5,
        fogNear: 58,
        fogFar: 138,
        exposure: 1.09,
        ambientSky: 0x9fd1dc,
        ambientGround: 0xa47b4a,
        ambientIntensity: 0.86,
        sunColor: 0xffc474,
        sunIntensity: 3.02,
        skyFillColor: 0x6faec6,
        skyFillIntensity: 0.34,
        shadowMapSize: 1536
      };
    case "balanced":
      return {
        background: 0x81bed8,
        fog: 0xcac8b7,
        fogNear: 52,
        fogFar: 128,
        exposure: 1.13,
        ambientSky: 0x93c8d8,
        ambientGround: 0x9e7242,
        ambientIntensity: 0.88,
        sunColor: 0xffb85f,
        sunIntensity: 3.18,
        skyFillColor: 0x64a8c2,
        skyFillIntensity: 0.37,
        shadowMapSize: 1536
      };
    case "cinematic":
      return {
        background: 0x72aec8,
        fog: 0xc7bca3,
        fogNear: 46,
        fogFar: 118,
        exposure: 1.19,
        ambientSky: 0x8ec1d0,
        ambientGround: 0x9a6a3a,
        ambientIntensity: 0.92,
        sunColor: 0xffad55,
        sunIntensity: 3.34,
        skyFillColor: 0x5d9fbd,
        skyFillIntensity: 0.42,
        shadowMapSize: 2048
      };
  }
}

export function canvasGradeProfile(quality: GraphicsQuality): CanvasGradeProfile {
  switch (quality) {
    case "performance":
      return {
        filter: "none",
        boxShadow: "none"
      };
    case "balanced":
      return {
        filter: "contrast(1.06) saturate(0.96) sepia(0.05)",
        boxShadow: "inset 0 0 62px rgba(5, 13, 18, 0.16)"
      };
    case "cinematic":
      return {
        filter: "contrast(1.095) saturate(0.94) sepia(0.08)",
        boxShadow: "inset 0 0 98px rgba(5, 13, 18, 0.22)"
      };
  }
}

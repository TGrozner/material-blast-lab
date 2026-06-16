import * as THREE from "three";

export interface RandomSource {
  next(): number;
}

export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  reset(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

export function createRunSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

export function randomRange(rng: RandomSource, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

export function randomInt(rng: RandomSource, min: number, max: number): number {
  return Math.floor(randomRange(rng, min, max + 1));
}

export function randomUnitVector(rng: RandomSource): THREE.Vector3 {
  return new THREE.Vector3(rng.next() - 0.5, rng.next() - 0.2, rng.next() - 0.5).normalize();
}

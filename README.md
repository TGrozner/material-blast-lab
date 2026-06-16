# Material Blast Lab

Material Blast Lab is a compact browser arcade physics toy built with Vite, TypeScript, Three.js, and Rapier3D. The current prototype mode is **Cannon Trial**: choose one fictional sci-fi projectile, aim from behind a lab cannon, fire once, then watch the destructible chamber fracture into debris, bio-gel splashes, chain reactions, camera shake, slow motion, and a destruction score.

This is not a realistic explosive simulator and does not model real devices, weapons tactics, humans, civilians, zombies, or elimination scoring. The gore is stylized arcade bio-gel from synthetic non-human lab specimens.

For the current product direction and replayability goals, see
[`docs/game-direction.md`](docs/game-direction.md).

## Install and Run

```sh
npm install
npm run dev
```

Open the local Vite URL printed in the terminal.

Production build:

```sh
npm run build
```

Production build for GitHub Pages:

```sh
npm run build:pages
```

Fast validation:

```sh
npm test
```

`npm test` runs the Vitest unit suite first, then Playwright smoke tests against
a local Vite server. Browser smoke coverage checks boot, mobile HUD layout,
level population/body-count budget, projectile selection, final score reveal,
and retry reset.

Focused browser/build validation:

```sh
npm run test:smoke
npm run build
```

To audit Pages hardening without mutating the primary `dist` directory, build
once, copy the artifact, then point the hardening script at the copy:

```sh
npm run build
AUDIT_DIST=$(mktemp -d)
cp -R dist/. "$AUDIT_DIST/"
DIST_DIR="$AUDIT_DIST" npm run harden:dist
```

## Controls

- Mouse move: aim the cannon
- Left click / Space: fire the one available shot
- 1-5: choose projectile
- +/-: adjust shot power
- [ and ]: adjust projectile size
- R: reset the current chamber
- C: clear dynamic debris
- Tab: switch test chamber

## Projectiles

- Kinetic Slug: fast, heavy, tight impact damage
- Scatter Pod: fragments into small physical shards on impact
- Pulse Orb: broad shockwave that pushes the chamber
- Gel Burst: bio-gel splash specialist
- Gravity Hammer: slower heavy local smash

## Chambers

- Quarantine Junction: dense city containment with a central hazard core and protected clinic/shelter zones
- Breaker Yard: short direct-damage yard with two small protected booths
- Gel Switchback: compact side-chain lane around a glass gel depot and protected archive
- Clinic Crosswind: restraint drill with target depot stacks flanked by protected clinic pods

## Score

The score appears after the shot settles for a few seconds:

- Structure Damage
- Material Chaos
- Bio-Gel Splash
- Chain Reaction Bonus
- Remaining Debris Motion
- Total Score

## Architecture

- `src/main.ts`: game loop, shot phases, impact handling, triggers, scoring
- `src/physics.ts`: Rapier world wrapper, fixed timestep, physics object metadata
- `src/materialCatalog.ts`: material behavior and procedural Three.js materials
- `src/destruction.ts`: blast impulses and practical cuboid fracture replacement
- `src/projectile.ts`: projectile definitions and launch system
- `src/cannon.ts`: procedural cannon, aiming, recoil, trajectory preview
- `src/levels.ts`: test chamber setup
- `src/bioGore.ts`: synthetic bio-gel dummy spawning and splash reactions
- `src/scoring.ts`: arcade score breakdown
- `src/vfx.ts`: particles, shockwave, bio-gel splats, point light flash, screen flash
- `src/cameraRig.ts`: cannon, projectile-follow, and spectacle camera modes
- `src/input.ts`: mouse aiming and keyboard shortcuts
- `src/ui.ts`: HUD and final score panel

## CI/CD

GitHub Actions runs `npm ci`, `npm test`, and `npm run build:pages` on pushes and pull requests targeting `main`, so CI validates fast unit/browser behavior plus the same minified, split, and obfuscated artifact shape used by deployment.

GitHub Pages deployment runs on pushes to `main` and from manual workflow dispatch. The deploy workflow builds the Vite app with `BASE_PATH=/material-blast-lab/`, splits application and vendor chunks, obfuscates the first-party application chunk, uploads `dist`, and deploys it through the `github-pages` environment.

Published site:

```text
https://tgrozner.github.io/material-blast-lab/
```

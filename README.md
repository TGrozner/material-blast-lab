# Material Blast Lab

Material Blast Lab is a compact browser arcade physics toy built with Vite, TypeScript, Three.js, and Rapier3D. The current prototype mode is **Cannon Trial**: choose one fictional sci-fi projectile, aim from behind a city siege cannon, fire once, then watch the destructible city fracture into debris, vehicle wrecks, chain reactions, camera shake, slow motion, and a Mayhem Score.

This is not a realistic explosive simulator and does not model real devices or weapons tactics. The game is a fictional arcade object-destruction toy focused on readable chains and score mastery.

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
level population/object-count budget, projectile selection, final score reveal,
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
- 1-6: choose projectile
- R: reset the current chamber
- C: clear dynamic debris
- Tab: switch test chamber

## Projectiles

- Kinetic Slug: fast, heavy, tight impact damage
- Scatter Pod: fragments into small physical shards on impact
- Pulse Orb: broad shockwave that pushes the chamber
- Ripper Burst: rupture shell for opening dense streets and multiplying object breakage
- Gravity Hammer: slower heavy local smash
- Ignition Lance: delayed fire starter for chain reactions and building pops

## Chambers

- Hazard Junction: dense city block with a central hazard core, transformer relays, moving vehicles, cargo, and power lines
- Breaker Yard: short direct-damage yard with fragile relay booths and loose cargo
- Switchback Crush: compact side-chain lane around a glass depot, archive pods, service crates, and relays
- Crosswind Depot: crosswind depot route with volatile side pods and market debris

## Score

The score appears after the shot settles for a few seconds. Mayhem Score is the total run score and star-route target; Collateral Chaos is the secondary-destruction sub-score from debris, relays, vehicles, and loose objects.

- Object Damage
- Collateral Chaos
- Chain Reaction Bonus
- Remaining Debris Motion
- Mayhem Rating

## Architecture

- `src/main.ts`: game loop, shot phases, impact handling, triggers, scoring
- `src/physics.ts`: Rapier world wrapper, fixed timestep, physics object metadata
- `src/materialCatalog.ts`: material behavior and procedural Three.js materials
- `src/destruction.ts`: blast impulses and practical cuboid fracture replacement
- `src/projectile.ts`: projectile definitions and launch system
- `src/cannon.ts`: procedural cannon, aiming, recoil, trajectory preview
- `src/levels.ts`: test chamber setup
- `src/scoring.ts`: arcade score breakdown
- `src/vfx.ts`: particles, shockwave, debris splashes, point light flash, screen flash
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

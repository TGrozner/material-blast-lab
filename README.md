# Downtown Mayhem

Downtown Mayhem is a compact browser arcade physics toy built with Vite, TypeScript, Three.js, and Rapier3D. The prototype has two one-shot arcade modes: **Cannon Trial**, where you choose one fictional sci-fi projectile and fire it from a city siege cannon, and **RC Crash Run**, where you steer one small fictional RC-style plane into the city. Either way, the run ends in destructible city fractures, debris, vehicle wrecks, chain reactions, camera shake, slow motion, and a Mayhem Score.

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

## Modes

- Cannon Trial: aim from behind the cannon, fire one arcade projectile, then watch the city settle into a score
- RC Crash Run: start the plane manually, steer it in third person, then crash it into a building, object, or the ground for the same destruction and scoring flow

RC Crash Run does not include payload dropping, multiple aircraft, fuel, enemies, health, imported aircraft assets, or realistic aircraft simulation.

## Controls

### Cannon Trial

- Mouse move: aim the cannon
- Left click / Space: fire the one available shot
- 1-4: choose projectile
- R: retry the current district
- C: clear dynamic debris during the run
- Tab: switch district

### RC Crash Run

- Start Run button / Space: launch the run from the ready state
- W/S or ArrowUp/ArrowDown: pitch
- A/D or ArrowLeft/ArrowRight: yaw
- Shift: boost
- R: retry the current district
- C: clear dynamic debris during the run
- Touch: drag in the lower play area to steer, and hold the lower-right Boost button while airborne

## Projectiles

- Normal Shell: standard cannon shell with a readable medium explosion
- Fragmentation Cluster: weaker first hit that seeds explosive clusters around impact
- Impulse Orb: broad pressure radius with limited destructive force outside the core
- Heavy Penetrator: direct-impact round that punches through solid buildings without exploding

## Chambers

- Hazard Junction: dense city block with a central hazard core, transformer relays, moving vehicles, cargo, and power lines
- Breaker Yard: full breaker district with a concrete spine, transformer yards, relay towers, fuel traffic, and dense blocks
- Switchback Crush: full glass-and-foam district with archive towers, baffles, service traffic, and redirect paths

## Score

The score appears after the shot settles for a few seconds. Mayhem Score is the total run score and star target; Collateral Chaos is the secondary-destruction sub-score from debris, relays, vehicles, and loose objects.

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
- `src/aircraft.ts`: arcade RC plane controller and procedural plane visual
- `src/cannon.ts`: procedural cannon, aiming, recoil, trajectory preview
- `src/levels.ts`: test chamber setup
- `src/scoring.ts`: arcade score breakdown
- `src/vfx.ts`: particles, shockwave, debris splashes, point light flash, screen flash
- `src/cameraRig.ts`: cannon, projectile-follow, aircraft chase, and spectacle camera modes
- `src/input.ts`: mouse aiming, keyboard shortcuts, and touch flight input
- `src/ui.ts`: HUD and final score panel

## CI/CD

GitHub Actions runs `npm ci`, `npm test`, and `npm run build:pages` on pushes and pull requests targeting `main`, so CI validates fast unit/browser behavior plus the same minified, split, and obfuscated artifact shape used by deployment.

GitHub Pages deployment runs on pushes to `main` and from manual workflow dispatch. The deploy workflow builds the Vite app with `BASE_PATH=/downtown-mayhem/`, splits application and vendor chunks, obfuscates the first-party application chunk, uploads `dist`, and deploys it through the `github-pages` environment.

Published site:

```text
https://tgrozner.github.io/downtown-mayhem/
```

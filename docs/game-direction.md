# Game Direction: Sticky Arcade Loop

Last updated: 2026-06-18

This document captures the direction we want to align on after auditing
Deadly Dispatch. It is a product/design reference for future work, not a
requirement to copy that game wholesale.

## North Star

Downtown Mayhem should become a compact one-shot arcade physics game:
pick a mission, choose a fictional sci-fi projectile/loadout, fire once, watch
a satisfying destruction chain, then get a clear result that makes retrying or
moving to the next mission feel natural.

Runs should be short, readable, and replayable. The addictive part should come
from mastery, score chasing, chained destruction, volatile hazards, object
breakage, and visible progression.

## What We Learned

Deadly Dispatch is sticky because it wraps each action in a complete game loop:

1. Choose a mode.
2. Pick or advance a level.
3. Configure a default-viable payload under constraints.
4. Execute one decisive action.
5. Watch a strong feedback sequence.
6. Receive stars, score, currency, and next-level progression.

The important transferable patterns are:

- A playable-looking animated scene behind the first screen.
- A small number of clear entry points: three level cards and Settings.
- Future content visible early through level lists, stars, and current
  mission state.
- One default viable loadout so the first run is fast.
- Knobs that create mastery after the first run, not before it.
- Post-run reward ceremony: score count-up, rating, stars, best-score callout,
  and next-level reveal.
- Game-feel settings that signal polish: camera shake, impact intensity,
  graphics/performance, audio buses, FPS.
- Basic telemetry or local analytics hooks for the core loop, even before any
  backend exists.

## What We Should Not Copy

Downtown Mayhem should keep its own fiction and safety boundary:

- Do not pivot into real-world weapons, real explosive tactics, or realistic
  victim simulation.
- Keep projectiles fictional and sci-fi, including ignition/fire effects as
  arcade hazards rather than realistic weapon guidance.
- Keep the focus on fictional destructible objects, vehicles, cargo, and
  readable hazard chains rather than characters or victim simulation.
- Do not add monetization until the free loop is already compelling.
- Do not overwhelm the first session with a long catalogue before the player has
  experienced one good run.

## Target Game Loop

The main mode should become Arcade:

1. **Level Select**: show a compact campaign path, stars, lock state, best score,
   and current mission.
2. **Mission Brief**: show the target district, volatile hazards, three objectives,
   and the reward/rating thresholds.
3. **Loadout**: provide a compact projectile choice where every payload is
   viable without extra power or size tuning.
4. **Aim And Fire**: preserve the current fast one-shot cannon loop.
5. **Spectacle**: keep camera follow, slow motion, shake, particles, score
   popups, and chained reactions.
6. **Results**: animate score, rating, stars, new best, objective completion,
   and unlock/next-level state.
7. **Retry Or Next**: make either action a single click/key press.

The menu should stay as a direct three-level selector with settings one click
away. A separate Free Play mode is intentionally out unless it gains genuinely
different rules.

## Progression Model

Start local and simple. A `localStorage` save is enough for the first durable
version:

- best score per level
- best rating per level
- stars per level
- attempts per level
- last selected projectile/loadout
- highest unlocked Arcade level
- total stars

No account, server, or purchase flow is needed for this phase.

## Scoring And Stars

The current scoring categories are a good base:

- Mayhem Score is the total run score used for stars, best score, and rating.
- Collateral Chaos is only the secondary-destruction sub-score from debris,
  vehicles, relays, loose props, and non-primary breakage.
- Object Damage
- Collateral Chaos
- Chain Bonus
- Motion Bonus
- Mayhem Score
- Mayhem Rating

Add a star layer on top of the existing score:

- 1 star: mission score reached.
- 2 stars: stronger score route reached.
- 3 stars: high score route reached and mission-specific bonus objective
  completed.

Every level should define its own thresholds. Avoid global thresholds that make
some levels accidentally trivial or impossible.

## Level Design Principles

Each Arcade level should have:

- one obvious target district
- multiple volatile hazards that are worth detonating
- at least one tempting chain-reaction route
- one clean-shot solution and one messy-high-score solution
- a readable camera angle before firing
- an objective that can be understood in under five seconds

First target: build five strong levels before attempting a large catalogue.

Suggested initial level arc:

1. Basic target damage.
2. Chain reaction tutorial.
3. Hazard-route mastery.
4. Projectile-specific mastery.
5. Combined challenge with a high-score route.

## UX Priorities

Highest priority:

- Replace pure sandbox startup with a title/menu that shows the live scene.
- Keep the three-level selector readable.
- Add persistent level stars/best scores.
- Add a results ceremony with animated score and stars.
- Add a compact level-select path.

Medium priority:

- Add loadout budget constraints.
- Add mission-specific objectives.
- Add settings for intensity, camera shake, audio, and performance.
- Add lightweight local analytics events for screen transitions and run results.

Later:

- More levels.
- Daily/weekly challenges.
- Shareable result summaries.
- Premium/paywall experiments, only after retention is proven.

## Acceptance Criteria For Future Changes

Gameplay work should support at least one of these outcomes:

- makes the first run clearer or faster
- makes retrying more rewarding
- makes score mastery more legible
- adds durable progression
- increases spectacle without hiding gameplay state
- creates more meaningful projectile/loadout decisions
- improves level readability or objective clarity

Avoid changes that only add controls, numbers, or visual noise without improving
the fire-watch-score-retry loop.

## Current Local Baseline

As of this note, the project already has a strong short loop:

- phase machine: aim, flight, spectacle, scored
- one-shot cannon firing
- four projectile types
- chain triggers
- volatile hazard chains
- score popups
- delayed score reveal
- four active object-destruction city levels with per-level cannon placement
- four projectile types: Normal, Fragmentation, Impulse, and Heavy

The missing layer is not more raw destruction. The missing layer is structure:
Arcade progression, persistent results, objective thresholds, and a stronger
post-run ceremony.

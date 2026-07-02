# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A multiplayer 2D side-scrolling MOBA demo in the shape of Awesomenauts, built on the `@cjgammon/gamekit` engine (and its `@cjgammon/gamekit-server`), consumed as normal published npm dependencies. See `CONTEXT.md` for the domain glossary (Match, Team, Character, Map, Lane, Minion, Tower, Base, Solar, Upgrade, Primary/Secondary Ability) and `docs/adr/` for architectural decisions.

## Engine reference (`@cjgammon/gamekit`)

This repo consumes the engine as a published npm dependency, not a monorepo package, so its architectural rationale (the "why") lives in the engine's own repo, not in this one's `node_modules`. Full source + docs: `/Users/cjgammon/Desktop/repos/github.com/cjgammon/gamekit` (its `CLAUDE.md` is the canonical architecture doc — read it directly for anything not summarized below, and whenever the summary looks stale against the installed package version).

**Frame loop** — logic and rendering are decoupled:

```
accumulator += realDt
while accumulator >= fixedStep:
  fixedUpdate(fixedStep)   ← physics, motion, game logic (deterministic, server-compatible)
  accumulator -= fixedStep
update(realDt)             ← animation, tweens, sweep dead entities (exactly once/frame)
render()
```

Anything that must match the server's fixed tick (default 20 Hz) goes in `fixedUpdate` (this is where Minion AI, damage, and Ability logic belong); purely visual work (animation, tweens) goes in `update`. `Entity` integrates motion in `fixedUpdate` in this order: acceleration → drag → `maxVelocity` clamp → position.

**Coordinate model** — absolute world coordinates. `Group` is a logical container, not a transform node; it does not offset children.

**Class hierarchy**:

```
Entity            base object — transform, motion, lifecycle hooks, onDestroy signal
  Sprite          adds texture/frames/named animations
  Group<T>        typed collection, itself an Entity; forwards updates, sweeps dead children
Scene             owns root Group, Camera, timers, tweens; overlap()/collide() helpers
Game              fixed-timestep loop + scene management
Signal<T>         typed event emitter used throughout
```

`scene.overlap()` / `scene.collide()` (AABB-based) handle basic collision — this is what Minion-vs-Tower, Character-vs-Minion, projectile-vs-Character combat should build on. `Camera.follow` (with lerp + deadzone) is the seam for a per-player side-scrolling camera. `Tilemap` is the seam for platform/ledge collision.

**Multiplayer model** — server runs the same headless core loop at a fixed tick (default 20 Hz), serializes state after each tick, broadcasts over a from-scratch binary-codec WebSocket. Clients buffer snapshots and interpolate remote entities ~100ms behind real time, and predict + reconcile the local player (`NetClient.predict` / `_reconcileLocal`). Net logic sits behind a `Transport` interface (`MemoryTransport` for tests, `WebSocketTransport` in the browser). This is the model Character movement *and* predicted Abilities (dash) should use — see the "Dash prediction" decision in `CONTEXT.md`.

**Reference implementation to study**: `examples/pong` in the gamekit repo is the closest existing example of this repo's shape — authoritative server (`ServerGame` + custom player factory + server-owned entities via `net.spawn`), `NetScene`/`NetClient` prediction+interpolation, synced game state via `net.setState`/`client.onState`, and a `RenderGame` (WebGPU) client. `docs/tutorial-pong.md` in that repo walks through it end to end.

**Server runtime note**: the WS server targets Node's `http` upgrade — run it on Node, not Bun (a Bun `node:http` quirk drops the browser handshake).

**We own this engine.** `@cjgammon/gamekit` and `@cjgammon/gamekit-server` aren't a third-party dependency — they're our own package, developed in the sibling repo above. If this project needs an engine feature that doesn't exist yet, or hits an engine bug, the right move is often to fix or add it upstream in the gamekit repo (following its own CLAUDE.md/CONTEXT.md conventions and test suite), bump its version, and pull the update in here — not to work around it in app code. Judgment call: a one-off demo-specific need can stay in this repo; anything a second consumer of the engine would plausibly want belongs upstream (see ADR-0001 for how we've drawn this line before — lobby/room management stayed here because it was judged demo-specific at the time).

## Agent skills

### Issue tracker

Issues live in GitHub Issues (cjgammon/multiplayer-game) via the gh CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

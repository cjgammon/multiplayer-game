# gamekit 0.2.0 — the reconciliation kinematic-state fix landed upstream

**Status**: upstream fix merged into the engine (gamekit PR #14, 2026-07-02);
published as `@cjgammon/gamekit` / `@cjgammon/gamekit-server` **0.2.0**. This
repo's bootstrap slice (PR #12) carries downstream workarounds that become
partly redundant once we upgrade.

## What changed upstream

The stutter this repo found (predicted Character pops a few px on every
snapshot during jump arcs) was proposed back to the engine as
`docs/proposals/reconciliation-kinematic-state.md` there, and is now fixed:

1. **Snapshots carry velocity.** `SnapshotEntity` has `vx`/`vy`;
   `NetClient._reconcileLocal` restores `entity.velocity` (not just the
   transform) before replaying unacked inputs. Momentum/gravity movers now
   reconcile correctly with no app-side help.
2. **The `SimulateFn` contract is documented**, and the
   `applyNetState`-before-replay ordering our workaround relies on is now a
   **documented guarantee** (previously an implementation accident).
3. **Predicted local entity render-interpolates** (`interpolate = true` on
   spawn), so it no longer steps ~3 rendered frames at a time at 20Hz.
4. **`NetScene` predicts before the camera step** (new `Scene.preCamera()`
   seam), so a camera following the local Character no longer trails it by
   one tick.

⚠️ 0.2.0 is a **wire-format change** (snapshot entities carry two extra f32s).
Client and server packages must be upgraded together — mixed 0.1.x/0.2.x
peers will not decode each other's snapshots.

## What this repo should do on upgrade

Bump both deps to `^0.2.0`, then revisit the bootstrap workarounds:

- **Remove `vx`/`vy` from `Character.netState()` / `applyNetState()`** — the
  engine now syncs and restores velocity itself.
- **Keep `grounded` / `prevJump` in `netState()`/`applyNetState()`** — the
  engine only restores *kinematic* state (transform + velocity). Non-kinematic
  simulate state still travels via this hook, which is now the documented,
  contract-backed mechanism (safe to rely on).
- **Remove any `interpolate = true` / camera-order workarounds** if the
  bootstrap slice added them — both behaviors are engine defaults now.

The upstream regression tests (`tests/net/reconciliation.test.ts` in gamekit)
cover the deterministic repro this repo produced, so a future engine refactor
can't silently reintroduce the stutter.

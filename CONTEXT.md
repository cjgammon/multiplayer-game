# multiplayer-game

A multiplayer 2D side-scrolling MOBA in the shape of Awesomenauts, built on the `@cjgammon/gamekit` engine: two teams push AI Minions along Lanes toward each other's Base.

## Language

**Match**:
A single game session between two Teams, ending when one Team's Base core is destroyed.

**Team**:
A group of 3 player-controlled Characters sharing a Base. 3v3, matching Awesomenauts.

**Character** (Naut):
A player-controlled entity with platform-style movement (gravity, jump, Tilemap collision) and a unique set of Abilities, chosen at Match start.
_Avoid_: Player, hero, champion

**Map**:
Defines the arena layout for a Match, including one or more Lanes and the two Teams' Bases. Not fixed to a single layout — different Maps may have different Lane counts/shapes (e.g. a top and bottom Lane that converge).

**Lane**:
A path along a Map that Minions walk from one Base toward the other, fighting anything in their way. A Map can define more than one Lane.

**Minion**:
An AI-controlled unit that spawns periodically at a Base and walks a Lane toward the enemy Base, attacking enemies (Minions, Towers, Characters) in its path.

**Tower**:
A defensive structure along a Lane that must be destroyed before Minions or Characters can damage anything further down that Lane, including the Base.

**Base**:
A Team's home structure at the end of its Lane(s). Invulnerable until all of that Lane's Towers are destroyed; losing its core ends the Match for that Team.

**Solar**:
Currency dropped by defeated Minions and Characters, collected on the Map and spent at a Character's own Base on temporary per-Match Upgrades.
_Avoid_: Gold, currency, points

**Upgrade**:
A temporary, per-Match improvement (e.g. damage, speed) bought with Solar at a Character's own Base. Does not persist beyond the Match.
_Avoid_: Item, purchase, buff

**Primary Ability**:
A Character's main cooldown-limited attack (e.g. a projectile or a melee swing).

**Secondary Ability**:
A Character's supporting cooldown-limited ability distinct from its Primary Ability (e.g. a dash or charge), used for repositioning or closing distance.

## Decisions so far

- Full MOBA loop (Lanes, Minions, Towers, Base) — not a stripped-down combat sandbox.
- 3v3 team size, matching Awesomenauts.
- Platform-style movement (gravity + jump + Tilemap collision), not free top-down movement.
- Lane count/shape is Map-defined, not hardcoded — must support maps with multiple Lanes.
- 2 Characters at launch, simple kits (e.g. one ranged, one melee/dash) — enough to prove the Character/Ability abstraction generalizes.
- Timed respawn at own Base on death — no lives/elimination.
- Solar economy + per-Match Upgrades are in scope.
- Lobby: room codes, team + Character select, ready-up before Match start. Lives in this repo's app code, not in `@cjgammon/gamekit-server` itself (see ADR-0001).
- Character picks are not unique per Match — duplicates allowed.
- Ranged Character: projectile Primary Ability + dash Secondary Ability.
- Melee Character: melee-swing Primary Ability + dash/charge Secondary Ability.
- Dash/movement abilities are predicted client-side and reconciled, same as base movement.
- Visual style starts as plain colored shapes (no art pipeline yet); expected to be replaced with sprite art later.
- Towers gate the Base: a Team's Base is invulnerable until that Lane's Tower(s) are destroyed.
- 1 Tower per Lane (no tiers) for this demo.
- Depends on `@cjgammon/gamekit` and `@cjgammon/gamekit-server` as normal published npm packages (not a local file:/link dependency), even while both are still evolving.

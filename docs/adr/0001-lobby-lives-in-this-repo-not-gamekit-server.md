---
status: accepted
---

# Lobby/room management lives in this repo, not gamekit-server

3v3 Matches need room codes, multiple concurrent Matches, and a pre-Match lobby (team/character select, ready-up) — none of which `@cjgammon/gamekit-server` currently has (it runs a single `NetServer` over a single `ServerGame`, one process = one match). We considered building first-class multi-room/session support into `gamekit-server` itself, but chose to keep all lobby state and room routing in this repo's own app code, calling into `NetServer`/`ServerGame` (consumed as a published npm dependency) once per Match. This avoids committing the engine's public API to a multi-room shape before a second real use case justifies it.

**Revisit**: if a future project needs the same room/lobby pattern, consider extracting it into `gamekit-server` as a reusable feature.

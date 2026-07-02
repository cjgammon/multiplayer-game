#!/usr/bin/env bash
# wt-dev.sh <http-port> — entry point for wt-preview's WT_DEV_CMD.
#
# wt assigns one stable port per worktree (starting at WT_BASE_PORT=5173)
# and appends it as the final arg here. This project needs two ports per
# worktree — Vite's HTTP server and the game's WebSocket server (hardcoded
# to 39500 otherwise) — so we derive the second from the same offset wt
# already assigned, keeping both stable and collision-free across worktrees.
set -euo pipefail

HTTP_PORT="${1:?usage: wt-dev.sh <port>}"
WS_PORT=$((39500 + HTTP_PORT - 5173))

export VITE_DEV_PORT="$HTTP_PORT"
export PORT="$WS_PORT"
export VITE_WS_PORT="$WS_PORT"

exec npm run dev

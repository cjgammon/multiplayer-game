// client.js — browser client, rendered with WebGPU. Shows a pre-Match lobby
// (room codes, Team + Character select, ready-up — see room.js on the server)
// before handing the same already-open WebSocket to the connected-Character
// flow from #1: predicts + reconciles the local Character, remote Characters
// are interpolated ~100ms behind real time by NetClient (no config needed —
// see gamekit's NetClient).
import { Signal, Sprite, Tilemap } from "@cjgammon/gamekit";
import {
  RenderGame,
  isWebGPUAvailable,
  mountUnsupportedNotice,
} from "@cjgammon/gamekit/renderer";
import {
  TICK_RATE, PORT, TILE, TEAMS, CHARACTERS,
  stepCharacter,
} from "../shared/shared.js";
import { getMap, buildMapData, worldSize } from "../shared/maps.js";
import { PROJECTILE_W, PROJECTILE_H, PROJECTILE_COOLDOWN } from "../shared/projectiles.js";
import { MSG } from "../shared/protocol.js";
import { createWorldScene } from "./match-view.js";

const canvas = document.getElementById("view");

if (!isWebGPUAvailable()) {
  mountUnsupportedNotice(canvas);
} else {
  main();
}

/** Wraps the WebSocket the lobby already opened as a gamekit `Transport`, so
 *  the Match connect flow reuses that one connection instead of opening a
 *  second — the server hands this same connection to `ServerGame.accept()`
 *  the moment it sees every player in the Room ready. */
class LiveTransport {
  onMessage = new Signal();
  onClose = new Signal();

  constructor(ws) {
    this._ws = ws;
    // The lobby's JSON protocol never needed binary frames, so the socket was
    // never switched off the WebSocket default of "blob". The Match protocol
    // (NetClient's binary codec) needs ArrayBuffer — gamekit's own
    // WebSocketTransport sets this in its constructor for the same reason;
    // we must do it too since we're handing off an already-open socket
    // instead of letting NetClient/WebSocketTransport open its own.
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) => this.onMessage.emit(e.data);
    ws.onclose = () => this.onClose.emit();
  }

  send(data) {
    if (this._ws.readyState === WebSocket.OPEN) this._ws.send(data);
  }

  close() {
    this._ws.close();
  }
}

function main() {
  const lobbyEl = document.getElementById("lobby");
  const landingEl = document.getElementById("landing");
  const roomEl = document.getElementById("room");
  const createBtn = document.getElementById("create-room");
  const joinBtn = document.getElementById("join-room");
  const joinCodeInput = document.getElementById("join-code");
  const landingError = document.getElementById("landing-error");
  const roomCodeEl = document.getElementById("room-code");
  const playerListEl = document.getElementById("player-list");
  const teamPickerEl = document.getElementById("team-picker");
  const characterPickerEl = document.getElementById("character-picker");
  const readyToggle = document.getElementById("ready-toggle");
  const roomError = document.getElementById("room-error");
  const hintEl = document.getElementById("hint");

  let ws = null;
  let latestState = null;
  let devPanelJumpBtn = null;
  const pending = [];

  function send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pending.push(msg);
      return;
    }
    ws.send(JSON.stringify(msg));
  }

  for (const team of TEAMS) {
    const btn = document.createElement("button");
    btn.textContent = `Team ${team}`;
    btn.dataset.team = team;
    btn.addEventListener("click", () => send({ k: MSG.PICK_TEAM, team }));
    teamPickerEl.appendChild(btn);
  }
  for (const character of CHARACTERS) {
    const btn = document.createElement("button");
    btn.textContent = character.name;
    btn.dataset.character = character.id;
    btn.addEventListener("click", () => send({ k: MSG.PICK_CHARACTER, character: character.id }));
    characterPickerEl.appendChild(btn);
  }
  // Only one Character exists so far (from #1) — pre-select the sole option.
  send({ k: MSG.PICK_CHARACTER, character: CHARACTERS[0].id }); // queued until the socket opens

  function connect(onOpenMsg) {
    ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.onopen = () => {
      ws.send(JSON.stringify(onOpenMsg));
      for (const msg of pending.splice(0)) ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (e) => onLobbyMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (!latestState) landingError.textContent = "Connection lost.";
    };
  }

  function onLobbyMessage(msg) {
    if (msg.k === MSG.ROOM_STATE) {
      latestState = msg;
      roomError.textContent = "";
      renderRoom(msg);
      return;
    }
    if (msg.k === MSG.ERROR) {
      (latestState ? roomError : landingError).textContent = msg.message;
      return;
    }
    if (msg.k === MSG.MATCH_START) {
      startMatch(new LiveTransport(ws));
      return;
    }
  }

  function renderRoom(state) {
    landingEl.hidden = true;
    roomEl.hidden = false;
    roomCodeEl.textContent = state.code;

    playerListEl.replaceChildren();
    for (const p of state.players) {
      const li = document.createElement("li");
      li.textContent = `${p.id === state.you ? "You" : `Player ${p.id}`} — ${
        p.team ? `Team ${p.team}` : "no Team"
      }, ${p.character ?? "no Character"}, ${p.ready ? "ready" : "not ready"}`;
      if (p.id === state.you) li.classList.add("you");
      playerListEl.appendChild(li);
    }

    const me = state.players.find((p) => p.id === state.you);
    for (const btn of teamPickerEl.children) {
      btn.setAttribute("aria-pressed", String(btn.dataset.team === me.team));
    }
    for (const btn of characterPickerEl.children) {
      btn.setAttribute("aria-pressed", String(btn.dataset.character === me.character));
    }
    readyToggle.disabled = !me.team;
    readyToggle.textContent = me.ready ? "Unready" : "Ready";
    readyToggle.setAttribute("aria-pressed", String(me.ready));
  }

  createBtn.addEventListener("click", () => {
    landingError.textContent = "";
    connect({ k: MSG.CREATE_ROOM });
  });

  setupDevPanel();

  // Dev-only shortcut, mounted straight into the real lobby flow: it calls
  // the SAME connect()/send() this file already uses, rather than a second
  // module speaking the lobby wire protocol on its own — the next dev tool
  // added here should follow the same shape (dev-only via hostname check,
  // drive real app functions instead of duplicating protocol logic).
  function setupDevPanel() {
    if (location.hostname !== "localhost") return;

    const panelEl = document.getElementById("dev-panel");
    const tabEl = document.getElementById("dev-panel-tab");
    const bodyEl = document.getElementById("dev-panel-body");
    const jumpBtn = document.getElementById("dev-panel-jump");

    panelEl.hidden = false;

    function toggle() {
      bodyEl.hidden = !bodyEl.hidden;
    }
    tabEl.addEventListener("click", toggle);
    window.addEventListener("keydown", (e) => {
      if (e.code === "Backquote") toggle();
    });

    jumpBtn.addEventListener("click", () => {
      if (jumpBtn.disabled) return;
      // "Full auto-flow regardless of current state" means this can fire
      // while a previous connection is still open (e.g. mid lobby, not yet
      // ready) — close it first so its stray room-state broadcasts can't
      // clobber the fresh room's latestState.
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      pending.length = 0;
      landingError.textContent = "";
      connect({ k: MSG.CREATE_ROOM });
      send({ k: MSG.PICK_CHARACTER, character: CHARACTERS[0].id });
      send({ k: MSG.PICK_TEAM, team: TEAMS[0] });
      send({ k: MSG.SET_READY, ready: true });
    });

    devPanelJumpBtn = jumpBtn;
  }

  joinBtn.addEventListener("click", () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    landingError.textContent = "";
    connect({ k: MSG.JOIN_ROOM, code });
  });

  readyToggle.addEventListener("click", () => {
    const me = latestState.players.find((p) => p.id === latestState.you);
    send({ k: MSG.SET_READY, ready: !me.ready });
  });

  function startMatch(transport) {
    lobbyEl.hidden = true;
    canvas.hidden = false;
    hintEl.hidden = false;
    if (devPanelJumpBtn) devPanelJumpBtn.disabled = true;

    // Selects which Map to render — must match the server's MAP_ID env var
    // (both build the Tilemap locally from the same data; see maps.js).
    const mapId = new URLSearchParams(location.search).get("map") || "singleLane";
    const map = getMap(mapId);
    const { width: WORLD_W, height: WORLD_H } = worldSize(map);

    // Built locally from the same shared data the server uses — the map is
    // static, so it isn't sent over the wire; both sides must agree on it byte
    // for byte or client-side collision (prediction + collide) would diverge.
    const tilemap = new Tilemap(map.cols, map.rows, TILE, TILE, buildMapData(map));
    tilemap.tint = 0x445566;

    // Views, entity factory, and the NetScene subclass live in match-view.js
    // — this only wires them up with the map-specific tilemap/bounds and the
    // prediction callback (which client.js needs a direct `tilemap`
    // reference for anyway, since it must run the SAME movement the server
    // runs).
    const scene = createWorldScene({
      transport,
      tilemap,
      worldBounds: { minX: 0, minY: 0, maxX: WORLD_W, maxY: WORLD_H },
      simulate: (entity, input, dt) => stepCharacter(entity, input, dt, tilemap),
    });

    RenderGame.create(canvas, { fov: WORLD_W, tickRate: TICK_RATE }).then((game) => {
      game.switchScene(scene);
      game.start();
    });

    // Send input on change; prediction + sending happen each tick. `fire`
    // isn't predicted (see match-view.js's ProjectileView) — it's just
    // relayed to the server, which edge-triggers/cooldown-gates it (see
    // projectiles.js's stepPrimaryAbility) the same way `jump` is
    // edge-triggered locally.
    const input = { left: false, right: false, jump: false, fire: false };
    // Tracks the last movement direction, mirroring server.js's
    // Character.facing purely locally — used only to place the muzzle flash
    // below on the correct side; the server derives its own copy the same
    // way from the same input, so this never needs to be synced.
    let localFacing = 1;
    // Real time (not tick-based — this fires from a DOM event, off the fixed
    // step), mirroring PROJECTILE_COOLDOWN so the flash doesn't fire faster
    // than the server would actually spawn a Projectile. This is a cosmetic
    // gate only, not authoritative — the server still independently
    // cooldown-gates the real shot.
    let nextFlashReadyAt = 0;

    // Immediate, local-only feedback for a fire press: the real Projectile
    // isn't predicted (see the comment above), so without this a press feels
    // laggy — it's ~100ms+ (interpolation buffer + round trip) before
    // anything appears. Not net-synced, so other players never see it; it
    // exists purely to make pressing F feel responsive. Spawn math mirrors
    // server.js's Character._firePrimary exactly, so the flash lines up with
    // where the real Projectile will appear moments later.
    function spawnMuzzleFlash(facing) {
      const local = scene.client.entities.get(scene.client.you);
      if (!local) return;
      const flash = new Sprite();
      flash.width = PROJECTILE_W;
      flash.height = PROJECTILE_H;
      flash.tint = 0xffffff;
      // setPosition (not a plain x/y assignment) snaps prevX/prevY to match —
      // otherwise the Entity default constructs at (0, 0) and this Sprite's
      // first interpolated frame smears in from the top-left corner of the
      // world instead of just appearing at the muzzle.
      flash.setPosition(
        facing > 0 ? local.x + local.width : local.x - PROJECTILE_W,
        local.y + local.height / 2 - PROJECTILE_H / 2,
      );
      scene.add(flash);
      scene.tween(flash, { scaleX: 2.5, scaleY: 2.5 }, 0.12, {
        onComplete: () => flash.kill(),
      });
    }

    const KEYS = {
      ArrowLeft: "left", KeyA: "left",
      ArrowRight: "right", KeyD: "right",
      ArrowUp: "jump", KeyW: "jump", Space: "jump",
      KeyF: "fire",
    };
    function setKey(e, down) {
      const dir = KEYS[e.code];
      if (!dir || input[dir] === down) return;
      input[dir] = down;
      if (down && dir === "left") localFacing = -1;
      if (down && dir === "right") localFacing = 1;
      if (down && dir === "fire") {
        const now = performance.now();
        if (now >= nextFlashReadyAt) {
          nextFlashReadyAt = now + PROJECTILE_COOLDOWN * 1000;
          spawnMuzzleFlash(localFacing);
        }
      }
      scene.client.setLocalInput(input); // predicted + sent automatically
      e.preventDefault();
    }
    window.addEventListener("keydown", (e) => setKey(e, true));
    window.addEventListener("keyup", (e) => setKey(e, false));

    // Match end: the server sets {winner} via net.setState once a Base is
    // destroyed (see server.js's MinionDirector._endMatch) — surfaced here
    // since it's the only observable sign the Match is over (no HUD/text
    // rendering pipeline yet).
    const winnerEl = document.getElementById("winner");
    scene.client.onState.add((state) => {
      if (!state || state.winner === undefined) return;
      winnerEl.textContent = `Team ${state.winner} wins!`;
      winnerEl.style.display = "block";
    });
  }
}

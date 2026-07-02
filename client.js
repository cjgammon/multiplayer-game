// client.js — browser client, rendered with WebGPU. Shows a pre-Match lobby
// (room codes, Team + Character select, ready-up — see room.js on the server)
// before handing the same already-open WebSocket to the connected-Character
// flow from #1: predicts + reconciles the local Character, remote Characters
// are interpolated ~100ms behind real time by NetClient (no config needed —
// see gamekit's NetClient).
import { Signal, Sprite, Tilemap, createEntityFactory } from "@cjgammon/gamekit";
import { NetScene } from "@cjgammon/gamekit/net";
import {
  RenderGame,
  isWebGPUAvailable,
  mountUnsupportedNotice,
} from "@cjgammon/gamekit/renderer";
import {
  TICK_RATE, PORT, TILE, MAP_COLS, MAP_ROWS, WORLD_W, WORLD_H,
  CHAR_W, CHAR_H, DRAG_X, MAX_VEL_X, MAX_VEL_Y, TEAMS, CHARACTERS,
  buildMapData, stepCharacter,
} from "./shared.js";

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
    btn.addEventListener("click", () => send({ k: "pick-team", team }));
    teamPickerEl.appendChild(btn);
  }
  for (const character of CHARACTERS) {
    const btn = document.createElement("button");
    btn.textContent = character.name;
    btn.dataset.character = character.id;
    btn.addEventListener("click", () => send({ k: "pick-character", character: character.id }));
    characterPickerEl.appendChild(btn);
  }
  // Only one Character exists so far (from #1) — pre-select the sole option.
  send({ k: "pick-character", character: CHARACTERS[0].id }); // queued until the socket opens

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
    if (msg.k === "room-state") {
      latestState = msg;
      roomError.textContent = "";
      renderRoom(msg);
      return;
    }
    if (msg.k === "error") {
      (latestState ? roomError : landingError).textContent = msg.message;
      return;
    }
    if (msg.k === "match-start") {
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
    connect({ k: "create-room" });
  });

  joinBtn.addEventListener("click", () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code) return;
    landingError.textContent = "";
    connect({ k: "join-room", code });
  });

  readyToggle.addEventListener("click", () => {
    const me = latestState.players.find((p) => p.id === latestState.you);
    send({ k: "set-ready", ready: !me.ready });
  });

  function startMatch(transport) {
    lobbyEl.hidden = true;
    canvas.hidden = false;
    hintEl.hidden = false;

    // Built locally from the same shared data the server uses — the map is
    // static, so it isn't sent over the wire; both sides must agree on it byte
    // for byte or client-side collision (prediction + collide) would diverge.
    const tilemap = new Tilemap(MAP_COLS, MAP_ROWS, TILE, TILE, buildMapData());
    tilemap.tint = 0x445566;

    // Untextured Sprite → renders as a solid tinted box (no art pipeline yet).
    // Config (size/drag/maxVelocity) must match the server's Character exactly
    // so client-side prediction integrates identically.
    class CharacterView extends Sprite {
      constructor() {
        super();
        this.width = CHAR_W;
        this.height = CHAR_H;
        this.drag.set(DRAG_X, 0);
        this.maxVelocity.set(MAX_VEL_X, MAX_VEL_Y);
      }

      // Reads the payload the server's Character.netState() sends. gamekit
      // 0.2.0 restores velocity automatically before reconciliation replay;
      // grounded/prevJump are app-specific jump-edge state it doesn't know
      // about, so we still restore those ourselves — applyNetState is
      // guaranteed to run before the replay (see SimulateFn's doc comment).
      applyNetState(state) {
        if (!state) return;
        if (state.color !== undefined) this.tint = state.color;
        if (state.grounded !== undefined) this._grounded = state.grounded;
        if (state.prevJump !== undefined) this._prevJump = state.prevJump;
      }
    }

    const factory = createEntityFactory({
      character: () => new CharacterView(),
    });

    class WorldScene extends NetScene {
      create() {
        this.add(tilemap);
        this.camera.bounds = { minX: 0, minY: 0, maxX: WORLD_W, maxY: WORLD_H };
      }

      update(dt) {
        super.update(dt);
        // Start following the local Character as soon as it's spawned.
        // (gamekit 0.2.0 predicts the local player in Scene's preCamera seam,
        // before the camera follows, and spawns it with interpolate = true —
        // no app-side workaround needed for either anymore.)
        if (!this._following) {
          const local = this.client.entities.get(this.client.you);
          if (local) {
            this.camera.follow(local, 0.2);
            this.camera.snapToTarget();
            this._following = true;
          }
        }
      }
    }

    const scene = new WorldScene(transport, factory, {
      // Predict OUR Character by running the SAME movement the server runs.
      simulate: (entity, input, dt) => stepCharacter(entity, input, dt, tilemap),
    });

    RenderGame.create(canvas, { fov: WORLD_W, tickRate: TICK_RATE }).then((game) => {
      game.switchScene(scene);
      game.start();
    });

    // Send input on change; prediction + sending happen each tick.
    const input = { left: false, right: false, jump: false };
    const KEYS = {
      ArrowLeft: "left", KeyA: "left",
      ArrowRight: "right", KeyD: "right",
      ArrowUp: "jump", KeyW: "jump", Space: "jump",
    };
    function setKey(e, down) {
      const dir = KEYS[e.code];
      if (!dir || input[dir] === down) return;
      input[dir] = down;
      scene.client.setLocalInput(input); // predicted + sent automatically
      e.preventDefault();
    }
    window.addEventListener("keydown", (e) => setKey(e, true));
    window.addEventListener("keyup", (e) => setKey(e, false));
  }
}

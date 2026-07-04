// room.js — lobby/room state and routing (per ADR-0001, this lives in app
// code, not in @cjgammon/gamekit-server). A Room holds players through room
// code entry, Team + Character select, and ready-up; LobbyManager owns the
// set of open Rooms and speaks the JSON lobby protocol over each connection's
// Transport until that connection is handed off to a per-Match ServerGame.
import { MSG } from "../shared/protocol.js";
import { MAX_TEAM_SIZE, MAX_ROOM_SIZE } from "../shared/shared.js";

const ROOM_CODE_LENGTH = 4;
// Excludes visually ambiguous characters (0/O, 1/I/L).
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(existingCodes) {
  let code;
  do {
    code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
  } while (existingCodes.has(code));
  return code;
}

/** One pre-Match room: its players, their Team/Character/ready state, and
 *  whether the Match has started. Transport-agnostic. */
class Room {
  code;
  players = new Map(); // id -> { id, transport, team, character, ready }
  playerOrder = []; // join order — becomes NetServer connection order at Match start
  started = false;

  constructor(code) {
    this.code = code;
  }

  addPlayer(id, transport) {
    this.players.set(id, { id, transport, team: null, character: null, ready: false });
    this.playerOrder.push(id);
  }

  removePlayer(id) {
    this.players.delete(id);
    this.playerOrder = this.playerOrder.filter((pid) => pid !== id);
  }

  get isEmpty() {
    return this.players.size === 0;
  }

  get isFull() {
    return this.players.size >= MAX_ROOM_SIZE;
  }

  /** How many players (other than `excludingId`, if given) are on `team`. */
  teamSize(team, excludingId) {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.team === team && p.id !== excludingId) count++;
    }
    return count;
  }

  get allReady() {
    return this.players.size > 0 && [...this.players.values()].every((p) => p.ready);
  }

  toState(forId) {
    return {
      k: MSG.ROOM_STATE,
      code: this.code,
      you: forId,
      players: this.playerOrder.map((id) => {
        const p = this.players.get(id);
        return { id: p.id, team: p.team, character: p.character, ready: p.ready };
      }),
    };
  }
}

/** Owns all open Rooms and the lobby protocol for every connection: routes
 *  create/join/pick/ready messages, broadcasts room-state, and hands a
 *  Room's players off to `onMatchStart` (one call per Match) once every
 *  player in the Room is ready. */
export class LobbyManager {
  constructor({ onMatchStart }) {
    this._rooms = new Map(); // code -> Room
    this._onMatchStart = onMatchStart;
    this._nextPlayerId = 1;
    this._listeners = new Map(); // transport -> lobby message listener
  }

  handleConnection(transport) {
    let room = null;
    let playerId = null;

    const send = (t, msg) => t.send(JSON.stringify(msg));

    const broadcast = () => {
      for (const p of room.players.values()) send(p.transport, room.toState(p.id));
    };

    const startMatchIfReady = () => {
      if (!room.allReady) return;
      room.started = true;
      for (const p of room.players.values()) {
        const listener = this._listeners.get(p.transport);
        if (listener) {
          p.transport.onMessage.remove(listener);
          this._listeners.delete(p.transport);
        }
        send(p.transport, { k: MSG.MATCH_START });
      }
      this._onMatchStart(room);
    };

    const listener = (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return; // ignore malformed lobby messages
      }

      if (msg.k === MSG.CREATE_ROOM) {
        if (room) return; // already in a room
        playerId = this._nextPlayerId++;
        const code = generateRoomCode(new Set(this._rooms.keys()));
        room = new Room(code);
        this._rooms.set(code, room);
        room.addPlayer(playerId, transport);
        broadcast();
        return;
      }

      if (msg.k === MSG.JOIN_ROOM) {
        if (room) return; // already in a room
        const target = this._rooms.get(msg.code);
        if (!target || target.started) {
          send(transport, { k: MSG.ERROR, message: "Room not found." });
          return;
        }
        if (target.isFull) {
          send(transport, { k: MSG.ERROR, message: "Room is full." });
          return;
        }
        playerId = this._nextPlayerId++;
        room = target;
        room.addPlayer(playerId, transport);
        broadcast();
        return;
      }

      if (!room || room.started) return;
      const me = room.players.get(playerId);

      if (msg.k === MSG.PICK_TEAM) {
        if (room.teamSize(msg.team, playerId) >= MAX_TEAM_SIZE) {
          send(transport, { k: MSG.ERROR, message: "That Team is full." });
          return;
        }
        me.team = msg.team;
        me.ready = false; // re-confirm readiness against the new choice
        broadcast();
        return;
      }

      if (msg.k === MSG.PICK_CHARACTER) {
        me.character = msg.character;
        me.ready = false; // re-confirm readiness against the new choice
        broadcast();
        return;
      }

      if (msg.k === MSG.SET_READY) {
        if (msg.ready && !me.team) {
          send(transport, { k: MSG.ERROR, message: "Pick a Team before readying up." });
          return;
        }
        me.ready = msg.ready;
        broadcast();
        startMatchIfReady();
        return;
      }
    };

    this._listeners.set(transport, listener);
    transport.onMessage.add(listener);

    transport.onClose.add(() => {
      if (!room || room.started) return;
      room.removePlayer(playerId);
      this._listeners.delete(transport);
      if (room.isEmpty) {
        this._rooms.delete(room.code);
        return;
      }
      broadcast();
      startMatchIfReady();
    });
  }
}

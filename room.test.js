import { describe, it, expect, vi } from "vitest";
import { LobbyManager, generateRoomCode, ROOM_CODE_ALPHABET } from "./room.js";
import { MAX_TEAM_SIZE, MAX_ROOM_SIZE } from "./shared.js";

// A minimal stand-in for the gamekit `Transport` interface (onMessage/onClose
// Signals + send/close) so lobby logic can be tested without real sockets.
class FakeTransport {
  constructor() {
    this._messageListeners = [];
    this._closeListeners = [];
    this.sent = [];
  }
  onMessage = {
    add: (fn) => this._messageListeners.push(fn),
    remove: (fn) => {
      const i = this._messageListeners.indexOf(fn);
      if (i !== -1) this._messageListeners.splice(i, 1);
    },
  };
  onClose = {
    add: (fn) => this._closeListeners.push(fn),
  };
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  receive(msg) {
    const data = JSON.stringify(msg);
    for (const fn of this._messageListeners.slice()) fn(data);
  }
  simulateClose() {
    for (const fn of this._closeListeners.slice()) fn();
  }
  lastSent() {
    return this.sent[this.sent.length - 1];
  }
  sentOfKind(k) {
    return this.sent.filter((m) => m.k === k);
  }
}

function makeManager(onMatchStart = vi.fn()) {
  return { manager: new LobbyManager({ onMatchStart }), onMatchStart };
}

describe("generateRoomCode", () => {
  it("produces a code from the unambiguous alphabet", () => {
    const code = generateRoomCode(new Set());
    expect(code.length).toBeGreaterThan(0);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });

  it("avoids collisions with existing codes", () => {
    const first = generateRoomCode(new Set());
    const second = generateRoomCode(new Set([first]));
    expect(second).not.toBe(first);
  });
});

describe("LobbyManager", () => {
  it("creates a room and returns a room code to the creator", () => {
    const { manager } = makeManager();
    const t = new FakeTransport();
    manager.handleConnection(t);
    t.receive({ k: "create-room" });

    const state = t.lastSent();
    expect(state.k).toBe("room-state");
    expect(state.code).toMatch(/^[A-Z0-9]+$/);
    expect(state.players).toHaveLength(1);
    expect(state.players[0].id).toBe(state.you);
  });

  it("lets a second player join by room code", () => {
    const { manager } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const guest = new FakeTransport();
    manager.handleConnection(guest);
    guest.receive({ k: "join-room", code });

    expect(guest.lastSent().k).toBe("room-state");
    expect(guest.lastSent().players).toHaveLength(2);
    // The host is re-broadcast the updated room-state too.
    expect(host.lastSent().players).toHaveLength(2);
  });

  it("rejects joining an unknown room code", () => {
    const { manager } = makeManager();
    const t = new FakeTransport();
    manager.handleConnection(t);
    t.receive({ k: "join-room", code: "ZZZZ" });

    expect(t.lastSent().k).toBe("error");
  });

  it("lets a player pick a team and a character", () => {
    const { manager } = makeManager();
    const t = new FakeTransport();
    manager.handleConnection(t);
    t.receive({ k: "create-room" });
    t.receive({ k: "pick-team", team: "A" });
    t.receive({ k: "pick-character", character: "naut" });

    const state = t.lastSent();
    const me = state.players.find((p) => p.id === state.you);
    expect(me.team).toBe("A");
    expect(me.character).toBe("naut");
  });

  it("allows duplicate Character picks across players on a Team", () => {
    const { manager } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const guest = new FakeTransport();
    manager.handleConnection(guest);
    guest.receive({ k: "join-room", code });

    host.receive({ k: "pick-team", team: "A" });
    host.receive({ k: "pick-character", character: "naut" });
    guest.receive({ k: "pick-team", team: "A" });
    guest.receive({ k: "pick-character", character: "naut" });

    const state = guest.lastSent();
    expect(state.players.every((p) => p.character === "naut")).toBe(true);
  });

  it("rejects readying up before a Team is picked", () => {
    const { manager } = makeManager();
    const t = new FakeTransport();
    manager.handleConnection(t);
    t.receive({ k: "create-room" });
    t.receive({ k: "set-ready", ready: true });

    expect(t.lastSent().k).toBe("error");
  });

  it("un-readies a player who changes Team or Character after readying up", () => {
    const { manager } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;
    // A second (never-ready) player keeps the room open past the first
    // ready-up, so we can observe the un-ready without the Match starting.
    const guest = new FakeTransport();
    manager.handleConnection(guest);
    guest.receive({ k: "join-room", code });

    const lastRoomState = (t) => t.sentOfKind("room-state").at(-1);

    host.receive({ k: "pick-team", team: "A" });
    host.receive({ k: "set-ready", ready: true });
    expect(lastRoomState(host).players.find((p) => p.id === host.lastSent().you).ready).toBe(true);

    host.receive({ k: "pick-team", team: "B" });
    expect(lastRoomState(host).players.find((p) => p.id === lastRoomState(host).you).ready).toBe(false);

    host.receive({ k: "set-ready", ready: true });
    host.receive({ k: "pick-character", character: "naut" });
    expect(lastRoomState(host).players.find((p) => p.id === lastRoomState(host).you).ready).toBe(false);
  });

  it("does not start the Match until every player in the room is ready", () => {
    const { manager, onMatchStart } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const guest = new FakeTransport();
    manager.handleConnection(guest);
    guest.receive({ k: "join-room", code });

    host.receive({ k: "pick-team", team: "A" });
    host.receive({ k: "set-ready", ready: true });
    expect(onMatchStart).not.toHaveBeenCalled();

    guest.receive({ k: "pick-team", team: "B" });
    guest.receive({ k: "set-ready", ready: true });
    expect(onMatchStart).toHaveBeenCalledTimes(1);
  });

  it("starts the Match once a solo room's only player is ready", () => {
    const { manager, onMatchStart } = makeManager();
    const t = new FakeTransport();
    manager.handleConnection(t);
    t.receive({ k: "create-room" });
    t.receive({ k: "pick-team", team: "A" });
    t.receive({ k: "set-ready", ready: true });

    expect(onMatchStart).toHaveBeenCalledTimes(1);
  });

  it("sends match-start to every player and passes the room in join order", () => {
    const { manager, onMatchStart } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const guest = new FakeTransport();
    manager.handleConnection(guest);
    guest.receive({ k: "join-room", code });

    host.receive({ k: "pick-team", team: "A" });
    host.receive({ k: "set-ready", ready: true });
    guest.receive({ k: "pick-team", team: "B" });
    guest.receive({ k: "set-ready", ready: true });

    expect(host.sentOfKind("match-start")).toHaveLength(1);
    expect(guest.sentOfKind("match-start")).toHaveLength(1);

    const room = onMatchStart.mock.calls[0][0];
    expect(room.playerOrder).toHaveLength(2);
    const [firstId, secondId] = room.playerOrder;
    expect(room.players.get(firstId).transport).toBe(host);
    expect(room.players.get(secondId).transport).toBe(guest);
  });

  it("detaches its lobby message listener from each transport once the Match starts", () => {
    const { manager } = makeManager();
    const t = new FakeTransport();
    manager.handleConnection(t);
    t.receive({ k: "create-room" });
    t.receive({ k: "pick-team", team: "A" });
    t.receive({ k: "set-ready", ready: true });

    expect(t._messageListeners).toHaveLength(0);
  });

  it("ignores further lobby messages for a room once the Match has started", () => {
    const { manager } = makeManager();
    const t = new FakeTransport();
    manager.handleConnection(t);
    t.receive({ k: "create-room" });
    t.receive({ k: "pick-team", team: "A" });
    t.receive({ k: "set-ready", ready: true });
    const sentBefore = t.sent.length;

    t.receive({ k: "pick-team", team: "B" });
    expect(t.sent.length).toBe(sentBefore);
  });

  it("removes a disconnecting player from the room and rebroadcasts state", () => {
    const { manager } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const guest = new FakeTransport();
    manager.handleConnection(guest);
    guest.receive({ k: "join-room", code });

    guest.simulateClose();

    expect(host.lastSent().players).toHaveLength(1);
  });

  it("a disconnect that leaves everyone else ready starts the Match", () => {
    const { manager, onMatchStart } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const guest = new FakeTransport();
    manager.handleConnection(guest);
    guest.receive({ k: "join-room", code });

    host.receive({ k: "pick-team", team: "A" });
    host.receive({ k: "set-ready", ready: true });
    // guest never readies up — leaves instead.
    guest.simulateClose();

    expect(onMatchStart).toHaveBeenCalledTimes(1);
  });

  it("rejects picking a Team that already has MAX_TEAM_SIZE players (#11)", () => {
    const { manager } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const teammates = [];
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const t = new FakeTransport();
      manager.handleConnection(t);
      t.receive({ k: "join-room", code });
      t.receive({ k: "pick-team", team: "A" });
      teammates.push(t);
    }
    // Team A is now full (host never picked a Team, so this is exactly
    // MAX_TEAM_SIZE players on it).
    expect(teammates.at(-1).lastSent().players.filter((p) => p.team === "A")).toHaveLength(
      MAX_TEAM_SIZE,
    );

    host.receive({ k: "pick-team", team: "A" });
    expect(host.lastSent().k).toBe("error");
  });

  it("lets a player already on a Team re-confirm that same Team even once it's full", () => {
    const { manager } = makeManager();
    const players = [];
    let code;
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const t = new FakeTransport();
      manager.handleConnection(t);
      if (i === 0) {
        t.receive({ k: "create-room" });
        code = t.lastSent().code;
      } else {
        t.receive({ k: "join-room", code });
      }
      t.receive({ k: "pick-team", team: "A" });
      players.push(t);
    }

    // Re-picking the same (now-full) Team is not a new join, so it must
    // still succeed.
    players[0].receive({ k: "pick-team", team: "A" });
    const state = players[0].lastSent();
    expect(state.k).toBe("room-state");
    expect(state.players.find((p) => p.id === state.you).team).toBe("A");
  });

  it("rejects joining a room that already has MAX_ROOM_SIZE players (#11)", () => {
    const { manager } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    for (let i = 1; i < MAX_ROOM_SIZE; i++) {
      const t = new FakeTransport();
      manager.handleConnection(t);
      t.receive({ k: "join-room", code });
    }

    const overflow = new FakeTransport();
    manager.handleConnection(overflow);
    overflow.receive({ k: "join-room", code });

    expect(overflow.lastSent().k).toBe("error");
  });

  it("starts a full 3v3 (6-player) Match once everyone readies up (#11)", () => {
    const { manager, onMatchStart } = makeManager();
    const host = new FakeTransport();
    manager.handleConnection(host);
    host.receive({ k: "create-room" });
    const code = host.lastSent().code;

    const others = [];
    for (let i = 1; i < MAX_ROOM_SIZE; i++) {
      const t = new FakeTransport();
      manager.handleConnection(t);
      t.receive({ k: "join-room", code });
      others.push(t);
    }

    const all = [host, ...others];
    all.forEach((t, i) => {
      t.receive({ k: "pick-team", team: i % 2 === 0 ? "A" : "B" });
      t.receive({ k: "set-ready", ready: true });
    });

    expect(onMatchStart).toHaveBeenCalledTimes(1);
    const room = onMatchStart.mock.calls[0][0];
    expect(room.playerOrder).toHaveLength(MAX_ROOM_SIZE);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { PushController } from "../scripts/controller.js";
import { PopoutManager } from "../scripts/popouts.js";
import { MODULE_ID, REQUEST_PATH } from "../scripts/constants.js";
import { HookBus, NativePopoutFake, world } from "./helpers.mjs";

// In-process server contract simulation, not a Foundry server or Socket test.
function clients() {
  const sessions = new Map();
  for (const id of ["gm", "p1", "p2", "off"]) {
    const f = world();
    f.game.user = f.users.get(id);
    class ClientPopout extends NativePopoutFake {
      constructor(options) { super(options); f.windows.push(this); }
    }
    f.windows = [];
    f.hooks = new HookBus();
    f.popouts = new PopoutManager({ ChatPopout: ClientPopout, messages: f.game.messages, viewport: () => ({ width: 1024, height: 768 }) });
    f.controller = new PushController({ game: f.game, hooks: f.hooks, popouts: f.popouts,
      openPicker() {}, notify: { error: text => assert.fail(text) }, contextHook: "getChatMessageContextOptions" });
    f.controller.install();
    sessions.set(id, f);
  }
  const broadcast = async (actualSessionId, request) => {
    for (const f of sessions.values()) {
      f.message.flag = structuredClone(request);
      // The origin is supplied by this simulated server, not from the payload.
      f.hooks.call("updateChatMessage", f.message, { flags: { [MODULE_ID]: { request: structuredClone(request) } } }, {}, actualSessionId);
    }
    await new Promise(resolve => setImmediate(resolve));
  };
  for (const [id, f] of sessions) f.message.update = async data => {
    f.message.writes.push(data);
    await broadcast(id, data[REQUEST_PATH]);
    return f.message;
  };
  return { sessions, broadcast };
}

test("integrated client contracts: selected recipient only, all players and duplicate focus", async () => {
  const { sessions } = clients();
  const gm = sessions.get("gm"), a = sessions.get("p1"), b = sessions.get("p2");
  await gm.controller.push("message1", ["p1"]);
  assert.equal(gm.windows.length, 0);
  assert.equal(a.windows.length, 1);
  assert.equal(b.windows.length, 0);
  await gm.controller.push("message1", ["p1", "p2", "off"]);
  assert.equal(a.windows.length, 1);
  assert.equal(b.windows.length, 1);
  assert.equal(sessions.get("off").windows.length, 0);
  await a.windows[0].minimize();
  await gm.controller.push("message1", ["p1"]);
  assert.equal(a.windows[0].minimized, false);
  await a.windows[0].close();
  await gm.controller.push("message1", ["p1"]);
  assert.equal(a.windows.length, 2);
});

test("integrated client contracts: GM self-only and combined delivery use the same authenticated update", async () => {
  const { sessions } = clients();
  const gm = sessions.get("gm"), a = sessions.get("p1"), b = sessions.get("p2");
  await gm.controller.push("message1", ["gm"]);
  assert.equal(gm.windows.length, 1);
  assert.equal(a.windows.length, 0);
  assert.equal(b.windows.length, 0);
  await gm.controller.push("message1", ["gm", "p1"]);
  assert.equal(gm.windows.length, 1, "self window is reused");
  assert.equal(a.windows.length, 1);
  assert.equal(b.windows.length, 0);
});

test("integrated client contracts: forged identity and replay do not reach another client", async () => {
  const { sessions } = clients();
  const gm = sessions.get("gm"), a = sessions.get("p1"), b = sessions.get("p2");
  const forged = { protocol: 1, nonce: crypto.randomUUID(), messageId: "message1", recipients: ["p2", "gm"], issuedAt: Date.now(), senderId: "gm" };
  await a.message.update({ [REQUEST_PATH]: forged });
  assert.equal(b.windows.length, 0);
  assert.equal(gm.windows.length, 0);
  for (const f of sessions.values()) f.hooks.call("updateChatMessage", f.message, { content: "GM edits other data" }, {}, "gm");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.windows.length, 0);
  await gm.controller.push("message1", ["p2"]);
  assert.equal(b.windows.length, 1);
});

test("integrated client contracts: recipient's own system visibility overrides GM selection", async () => {
  const { sessions } = clients();
  sessions.get("p1").message.isContentVisible = false;
  await sessions.get("gm").controller.push("message1", ["p1", "p2"]);
  assert.equal(sessions.get("p1").windows.length, 0);
  assert.equal(sessions.get("p2").windows.length, 1);
});

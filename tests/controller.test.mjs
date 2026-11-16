import { test } from "node:test";
import assert from "node:assert/strict";
import { PushController } from "../scripts/controller.js";
import { MODULE_ID, REQUEST_PATH } from "../scripts/constants.js";
import { HookBus, world } from "./helpers.mjs";

function setup() {
  const fixture = world();
  const opened = [], picked = [], synced = [], closed = [];
  const hooks = new HookBus();
  const controller = new PushController({
    game: fixture.game, hooks, contextHook: "getChatMessageContextOptions",
    popouts: {
      open: async id => { opened.push(id); return true; },
      synchronize: async id => { synced.push(id); }, close: async id => { closed.push(id); },
      closeAll: async () => {}
    },
    openPicker: msg => picked.push(msg.id), notify: { error: error => { throw Error(error); } }
  });
  return { ...fixture, controller, opened, picked, hooks, synced, closed };
}

const diff = request => ({ flags: { [MODULE_ID]: { request } } });

test("GM menu appends without replacing existing items; player cannot see or use it", () => {
  const { game, controller, message, picked } = setup();
  const items = [{ name: "existing" }];
  controller.addContextOptions(items);
  assert.equal(items.length, 2);
  assert.equal(items[0].name, "existing");
  const target = { nodeType: 1, closest: () => ({ dataset: { messageId: message.id } }) };
  assert.equal(items[1].condition(target), true);
  items[1].callback(target);
  assert.deepEqual(picked, [message.id]);
  game.user = game.users.get("p1");
  assert.equal(items[1].condition(target), false);
  items[1].callback(target);
  assert.equal(picked.length, 1);
  const playerItems = [];
  controller.addContextOptions(playerItems);
  assert.equal(playerItems.length, 0);
});

test("single, multiple and all players: filter offline, duplicate, missing and GM IDs", async () => {
  const { controller, message } = setup();
  for (const [ids, expected] of [[["p1"], ["p1"]], [["p1", "p2"], ["p1", "p2"]], [["gm", "p1", "off", "p2", "p1", "missing"], ["p1", "p2"]]]) {
    assert.equal(await controller.push(message.id, ids), expected.length);
    assert.deepEqual(message.flag.recipients, expected);
    assert.deepEqual(Object.keys(message.writes.at(-1)), [REQUEST_PATH]);
    assert.equal("content" in message.flag, false);
    assert.equal("senderId" in message.flag, false);
  }
  await assert.rejects(controller.push(message.id, ["gm", "off"]), /DCP.NoRecipients/);
  await assert.rejects(controller.push("deleted", ["p1"]), /DCP.Unavailable/);
});

test("ordinary player cannot originate a push even via direct controller access", async () => {
  const { controller, game, message } = setup();
  game.user = game.users.get("p1");
  await assert.rejects(controller.push(message.id, ["p2"]), /DCP.GMOnly/);
  assert.equal(message.writes.length, 0);
});

test("receiver authenticates hook initiator, not claimed payload; no planted-flag activation", async () => {
  const { controller, game, message, opened } = setup();
  await controller.push(message.id, ["p1"]);
  message.flag.senderId = "gm";
  game.user = game.users.get("p1");
  assert.equal(await controller.receive(message, diff(message.flag), "p2"), false);
  assert.equal(await controller.receive(message, diff(message.flag), "unknown"), false);
  assert.equal(await controller.receive(message, { content: "GM later edited this" }, "gm"), false);
  assert.equal(await controller.receive(message, diff({ nonce: "different-nonce-value" }), "gm"), false);
  assert.equal(opened.length, 0);
  assert.equal(await controller.receive(message, diff(message.flag), "gm"), true);
  assert.equal(await controller.receive(message, diff(message.flag), "gm"), false);
  assert.deepEqual(opened, [message.id]);
});

test("receiver rejects inaccessible, blind, unaddressed, stale and offline requests", async () => {
  for (const mutate of [
    f => { f.message.visible = false; }, f => { f.message.isContentVisible = false; },
    f => { f.message.blind = true; }, f => { f.message.whisper = ["p2"]; },
    f => { f.message.flag.recipients = ["p2"]; }, f => { f.message.flag.issuedAt = 0; },
    f => { f.game.user.active = false; }
  ]) {
    const f = setup();
    await f.controller.push(f.message.id, ["p1"]);
    f.game.user = f.game.users.get("p1");
    mutate(f);
    assert.equal(await f.controller.receive(f.message, diff(f.message.flag), "gm"), false);
    assert.equal(f.opened.length, 0);
  }
});

test("whispers and blind rolls cannot be authorized to unrelated players at send time", async () => {
  const { controller, message } = setup();
  message.whisper = ["p1"];
  assert.equal(await controller.push(message.id, ["p1", "p2"]), 1);
  message.blind = true;
  await assert.rejects(controller.push(message.id, ["p1"]), /DCP.NoRecipients/);
});

test("hook lifecycle registers once, never replays persisted flags, and disposes", async () => {
  const { controller, hooks, game, message, opened, closed } = setup();
  await controller.push(message.id, ["p1"]);
  game.user = game.users.get("p1");
  controller.install(); controller.install();
  assert.equal(hooks.handlers.get("updateChatMessage").size, 1);
  assert.equal(opened.length, 0);
  hooks.call("updateChatMessage", message, diff(message.flag), {}, "gm");
  hooks.call("deleteChatMessage", message);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, [message.id]);
  assert.deepEqual(closed, [message.id]);
  await controller.dispose();
  assert.equal(hooks.handlers.get("updateChatMessage").size, 0);
});

test("two rapid server updates snapshot requests before an asynchronous lifecycle step", async () => {
  const { controller, hooks, game, message, opened } = setup();
  controller.install();
  await controller.push(message.id, ["p1"]);
  game.user = game.users.get("p1");
  hooks.call("updateChatMessage", message, diff(message.flag), {}, "gm");
  message.flag = { ...message.flag, nonce: crypto.randomUUID(), recipients: ["p2"] };
  hooks.call("updateChatMessage", message, diff(message.flag), {}, "gm");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, [message.id]);
});

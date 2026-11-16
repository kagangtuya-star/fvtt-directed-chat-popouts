import { test } from "node:test";
import assert from "node:assert/strict";
import { PopoutManager } from "../scripts/popouts.js";
import { NativePopoutFake, world } from "./helpers.mjs";

function setup(ChatPopout = NativePopoutFake) {
  NativePopoutFake.instances = [];
  const f = world();
  const viewport = { width: 1280, height: 720 };
  const manager = new PopoutManager({ ChatPopout, messages: f.game.messages, viewport: () => viewport });
  return { ...f, viewport, manager };
}

test("native popout gets original document, resizable nonmodal frame and bounded position", async () => {
  const { manager, message } = setup();
  assert.equal(await manager.open(message.id), true);
  const app = NativePopoutFake.instances[0];
  assert.equal(app.options.message, message);
  assert.deepEqual(app.options.window, { resizable: true, minimizable: true });
  assert(app.position.width <= 420 && app.position.height <= 520);
});

test("simultaneous duplicate pushes create one instance and restore minimized window", async () => {
  const { manager, message } = setup();
  await Promise.all([manager.open(message.id), manager.open(message.id), manager.open(message.id)]);
  assert.equal(NativePopoutFake.instances.length, 1);
  const app = NativePopoutFake.instances[0];
  await app.minimize();
  await manager.open(message.id);
  assert.equal(app.minimized, false);
  assert.equal(app.focuses, 4);
});

test("different messages coexist; close never deletes original and push reopens", async () => {
  const { manager, message, game } = setup();
  const second = { ...message, id: "message2" };
  game.messages.set(second.id, second);
  await manager.open(message.id); await manager.open(second.id);
  await manager.close(message.id);
  assert.equal(game.messages.get(message.id), message);
  assert.equal(NativePopoutFake.instances[1].rendered, true);
  await manager.open(message.id);
  assert.equal(NativePopoutFake.instances.length, 3);
  await manager.closeAll();
  assert(NativePopoutFake.instances.every(app => !app.rendered));
});

test("deletion and revoked visibility close windows; ordinary updates defer to core", async () => {
  const { manager, message, game } = setup();
  await manager.open(message.id);
  await manager.synchronize(message.id);
  assert.equal(NativePopoutFake.instances[0].rendered, true);
  message.isContentVisible = false;
  await manager.synchronize(message.id);
  assert.equal(NativePopoutFake.instances[0].rendered, false);
  assert.equal(await manager.open(message.id), false);
  message.isContentVisible = true;
  await manager.open(message.id);
  game.messages.delete(message.id);
  await manager.synchronize(message.id);
  assert.equal(NativePopoutFake.instances[1].rendered, false);
});

test("resize clamps windows to new viewport", async () => {
  const { manager, message, viewport } = setup();
  await manager.open(message.id);
  const app = NativePopoutFake.instances[0];
  app.setPosition({ left: 1000, top: 500, width: 900, height: 600 });
  Object.assign(viewport, { width: 320, height: 240 });
  manager.fitToViewport();
  assert(app.position.left + app.position.width <= 320);
  assert(app.position.top + app.position.height <= 240);
});

test("message deleted during slow native render leaves no stale popout", async () => {
  let finish;
  class SlowPopout extends NativePopoutFake {
    async render() { await new Promise(resolve => { finish = resolve; }); return super.render(); }
  }
  const { manager, message, game } = setup(SlowPopout);
  const opening = manager.open(message.id);
  game.messages.delete(message.id);
  const closing = manager.close(message.id);
  finish();
  assert.equal(await opening, false);
  await closing;
  assert.equal(NativePopoutFake.instances[0].rendered, false);
});

test("render failure cleans instance and allows retry", async () => {
  class BrokenPopout extends NativePopoutFake {
    async render() { throw new Error("render failed"); }
  }
  const { manager, message } = setup(BrokenPopout);
  await assert.rejects(manager.open(message.id), /render failed/);
  manager.ChatPopout = NativePopoutFake;
  assert.equal(await manager.open(message.id), true);
});

test("an already open core popout is reused via the public application registry", async () => {
  const { manager, message } = setup();
  const app = new NativePopoutFake({ message, position: { width: 300, height: 400, left: 0, top: 0 } });
  await app.render();
  await app.minimize();
  manager.instances = new Map([["native", app]]);
  assert.equal(await manager.open(message.id), true);
  assert.equal(NativePopoutFake.instances.length, 1);
  assert.equal(app.minimized, false);
});

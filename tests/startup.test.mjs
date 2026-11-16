import { test } from "node:test";
import assert from "node:assert/strict";
import { HookBus, NativePopoutFake, world } from "./helpers.mjs";

for (const generation of [13, 14]) {
  test(`v${generation}: actual entry registers the chat menu before ready`, async () => {
    const { game, message } = world();
    const hooks = new HookBus();
    hooks.once = (name, fn) => {
      const id = hooks.on(name, (...args) => { hooks.off(name, id); fn(...args); });
      return id;
    };
    game.release = { generation };
    globalThis.game = game;
    globalThis.Hooks = hooks;
    globalThis.foundry = { applications: {
      api: { ApplicationV2: NativePopoutFake },
      sidebar: { apps: { ChatPopout: NativePopoutFake } },
      instances: new Map()
    } };
    globalThis.innerWidth = 1280;
    globalThis.innerHeight = 720;
    globalThis.addEventListener = () => {};
    // UI applications are not initialized at setup. Do not capture a missing
    // notification application while registering listeners at this stage.
    globalThis.ui = undefined;
    NativePopoutFake.instances = [];

    await import(`../scripts/module.js?startup-test=${generation}`);
    hooks.call("init");
    hooks.call("setup");
    const items = [{ name: "existing" }];
    // Foundry constructs the ChatLog context menu while initializing UI,
    // between setup and ready. Keep the actual array from that first build.
    hooks.call("getChatMessageContextOptions", {}, items);
    assert.equal(items.length, 2, "first menu construction must include the module entry");
    assert.equal(items[0].name, "existing");
    assert.equal(items[1].name, "DCP.PushMenu");

    globalThis.ui = { notifications: { error: text => assert.fail(text) } };
    hooks.call("ready");
    const target = { nodeType: 1, closest: () => ({ dataset: { messageId: message.id } }) };
    assert.equal(items[1].condition(target), true);
    items[1].callback(target);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(NativePopoutFake.instances.length, 1, "stored first-menu callback opens the picker after ready");
    game.user = game.users.get("p1");
    assert.equal(items[1].condition(target), false);
    items[1].callback(target);
    assert.equal(NativePopoutFake.instances.length, 1, "players cannot invoke the stored GM callback");
    assert.equal(hooks.handlers.get("getChatMessageContextOptions").size, 1);
  });
}

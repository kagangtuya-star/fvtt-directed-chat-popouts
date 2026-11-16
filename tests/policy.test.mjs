import { test } from "node:test";
import assert from "node:assert/strict";
import { canRead, recipientBlock, recipientRows, SeenRequests, validRequest } from "../scripts/policy.js";
import { hostCapabilities, initialPosition, messageIdFromTarget } from "../scripts/compat.js";
import { world } from "./helpers.mjs";

test("recipients: online defaults, offline and GM exclusions, whisper author and blind", () => {
  const { message, users } = world();
  assert.deepEqual(recipientRows(message, users).filter(row => !row.blocked).map(row => row.id), ["p1", "p2"]);
  assert.equal(recipientBlock(message, users.get("off")), "Offline");
  message.whisper = ["p1"];
  assert.equal(recipientBlock(message, users.get("p2")), "Private");
  message.author = users.get("p2");
  assert.equal(recipientBlock(message, users.get("p2")), null);
  message.blind = true;
  assert.equal(recipientBlock(message, users.get("p1")), "Private");
});

test("recipient list includes the sending GM; self-delivery respects online state", () => {
  const { message, users } = world();
  users.set("otherGM", { id: "otherGM", name: "Other GM", active: true, isGM: true });
  const rows = recipientRows(message, users, "gm");
  assert.deepEqual(rows.map(row => row.id), ["gm", "p1", "p2", "off"]);
  assert.equal(rows[0].isSelf, true);
  assert.equal(rows[0].blocked, null);
  message.blind = true;
  message.whisper = ["gm"];
  assert.equal(recipientBlock(message, users.get("gm"), "gm"), null);
  assert.equal(recipientBlock(message, users.get("p1"), "gm"), "Private");
  assert.equal(recipientBlock(message, users.get("otherGM"), "gm"), "GMOnly");
  users.get("gm").active = false;
  assert.equal(recipientBlock(message, users.get("gm"), "gm"), "Offline");
});

test("message visibility requires both core getters, fails closed for missing data", () => {
  for (const message of [null, {}, { visible: true }, { visible: false, isContentVisible: true }, { visible: true, isContentVisible: false }]) {
    assert.equal(canRead(message), false);
  }
  assert.equal(canRead(world().message), true);
});

test("request schema rejects malformed, stale, future, oversized and wrong-recipient envelopes", () => {
  const { users, message } = world();
  const user = users.get("p1");
  const request = { protocol: 1, nonce: "12345678-1234-1234-1234-123456789abc", messageId: message.id, recipients: [user.id], issuedAt: 1000000 };
  assert.equal(validRequest(request, message.id, user, users, 1000000), true);
  for (const changes of [
    { protocol: 2 }, { messageId: "other" }, { nonce: "bad" }, { issuedAt: 0 },
    { issuedAt: 1030001 }, { issuedAt: NaN }, { issuedAt: "1000000" },
    { recipients: [] }, { recipients: ["p2"] }, { recipients: ["gm", "p1"] },
    { recipients: ["p1", "p1"] }, { recipients: ["missing", "p1"] }, { recipients: "p1" }
  ]) assert.equal(validRequest({ ...request, ...changes }, message.id, user, users, 1000000), false, JSON.stringify(changes));
  assert.equal(validRequest(request, message.id, users.get("gm"), users, 1000000), false);
  user.active = false;
  assert.equal(validRequest(request, message.id, user, users, 1000000), false);
});

test("duplicate cache expires and stays bounded", () => {
  const seen = new SeenRequests();
  assert.equal(seen.accept("a", 0), true);
  assert.equal(seen.accept("a", 100), false);
  assert.equal(seen.accept("a", 120001), true);
  for (let i = 0; i < 1025; i++) seen.accept(String(i), 120001);
  assert.equal(seen.accept("a", 120001), true);
});

test("GM recipients must match the authenticated sender, not a payload identity", () => {
  const { message, users } = world();
  users.set("otherGM", { id: "otherGM", active: true, isGM: true });
  const request = { protocol: 1, nonce: crypto.randomUUID(), messageId: message.id, recipients: ["gm", "p1"], issuedAt: 1000000 };
  assert.equal(validRequest(request, message.id, users.get("gm"), users, 1000000, "gm"), true);
  assert.equal(validRequest(request, message.id, users.get("p1"), users, 1000000, "gm"), true);
  assert.equal(validRequest({ ...request, senderId: "gm" }, message.id, users.get("gm"), users, 1000000, "otherGM"), false);
  assert.equal(validRequest({ ...request, recipients: ["otherGM"] }, message.id, users.get("otherGM"), users, 1000000, "gm"), false);
});

for (const generation of [13, 14]) test(`v${generation}: supported public API namespace and menu hook contract`, () => {
  class App {}
  class Popout {}
  const result = hostCapabilities({ game: { release: { generation } }, foundry: { applications: { api: { ApplicationV2: App }, sidebar: { apps: { ChatPopout: Popout } } } } });
  assert.equal(result.ChatPopout, Popout);
  assert.equal(result.ApplicationV2, App);
  assert.equal(result.contextHook, "getChatMessageContextOptions");
});

test("unsupported host fails clearly; menu accepts native elements and legacy wrappers", () => {
  assert.throws(() => hostCapabilities({ game: { release: { generation: 12 } } }), /DCP.Unsupported/);
  assert.throws(() => hostCapabilities({ game: { release: { generation: 14 } } }), /DCP.Unsupported/);
  const node = { nodeType: 1, closest: () => ({ dataset: { messageId: "abc" } }) };
  assert.equal(messageIdFromTarget(node), "abc");
  assert.equal(messageIdFromTarget([node]), "abc");
  assert.equal(messageIdFromTarget(null), null);
});

test("initial dimensions stay inside normal, tiny and mobile viewports", () => {
  for (const [width, height] of [[1920, 1080], [800, 600], [320, 240], [100, 90], [1, 1]]) {
    for (let n = 0; n < 10; n++) {
      const p = initialPosition({ width, height }, n);
      assert(p.left >= 0 && p.top >= 0 && p.width > 0 && p.height > 0);
      assert(p.left + p.width <= width && p.top + p.height <= height);
    }
  }
});

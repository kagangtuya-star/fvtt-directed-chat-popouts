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

test("compact styles bind to public frame elements and short cards fit their content", async () => {
  const part = height => ({
    classes: new Set(),
    classList: { add(name) { this.owner.classes.add(name); } },
    getBoundingClientRect: () => ({ height })
  });
  const makePart = height => {
    const node = part(height);
    node.classList.owner = node;
    return node;
  };
  class FramedPopout extends NativePopoutFake {
    constructor(options) {
      super(options);
      this.element.offsetHeight = 520;
      this.element.clientHeight = 518;
      this.window = {
        header: makePart(24), title: makePart(12), content: makePart(180),
        resize: makePart(16), controls: makePart(22), close: makePart(22)
      };
      this.window.content.querySelector = () => makePart(180);
    }
  }
  const { manager, message } = setup(FramedPopout);
  await manager.open(message.id);
  const app = NativePopoutFake.instances[0];
  assert.equal(app.position.height, 206, "card + compact header + borders, without an empty lower panel");
  assert(app.window.header.classes.has("dcp-popout-header"));
  assert(app.window.resize.classes.has("dcp-popout-resize"));
  assert(app.window.close.classes.has("dcp-popout-control"));
  app.window.content = makePart(300);
  app.window.content.querySelector = () => makePart(300);
  app.setPosition({ height: 650 });
  app.dispatchEvent(new Event("render"));
  assert(app.window.content.classes.has("dcp-popout-content"), "core frame updates regain their scoped styling");
  await manager.open(message.id);
  assert.equal(app.position.height, 326, "rerender and repeated pushes keep the card flush with the frame");
});

function observedWindow() {
  const frames = new Map();
  let next = 0;
  class Observer {
    static instances = [];
    targets = new Set();
    constructor(callback) { this.callback = callback; this.constructor.instances.push(this); }
    observe(node) { this.targets.add(node); }
    unobserve(node) { this.targets.delete(node); }
    disconnect() { this.targets.clear(); }
    trigger() { if (this.targets.size) this.callback(); }
  }
  class ResizeObserver extends Observer { static instances = []; }
  class MutationObserver extends Observer { static instances = []; }
  const layout = {
    ResizeObserver, MutationObserver,
    requestAnimationFrame(callback) { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
    assert.equal(frames.size, 0, "fitting must not schedule a feedback loop");
  };
  const node = height => ({ classList: { add() {} }, height,
    getBoundingClientRect() { return { height: this.height }; } });
  class ObservedPopout extends NativePopoutFake {
    constructor(options) {
      super(options);
      Object.assign(this.element, { offsetHeight: 520, clientHeight: 518 });
      this.card = node(180);
      this.window = { content: node(0), header: node(24) };
      this.window.content.querySelector = () => this.card;
      this.positions = 0;
    }
    setPosition(position) { this.positions++; super.setPosition(position); }
  }
  const f = setup(ObservedPopout);
  f.manager.layout = layout;
  return { ...f, flush, frames, node, ResizeObserver, MutationObserver };
}

test("card expansion, collapse, late image sizing and width reflow remain flush", async () => {
  const f = observedWindow();
  await f.manager.open(f.message.id);
  const app = NativePopoutFake.instances[0];
  f.flush();
  const observer = f.ResizeObserver.instances[0];
  for (const [content, expected] of [[380, 406], [90, 116], [1000, 520], [210, 236]]) {
    app.card.height = content;
    observer.trigger(); observer.trigger();
    assert.equal(f.frames.size, 1, "coalesce layout notifications");
    f.flush();
    assert.equal(app.position.height, expected);
  }
  const count = app.positions;
  observer.trigger(); f.flush();
  assert.equal(app.positions, count, "unchanged geometry must not call setPosition again");
  await f.manager.closeAll();
});

test("DOM replacement and core rerender rebind observers; close cancels pending work", async () => {
  const f = observedWindow();
  await f.manager.open(f.message.id);
  const app = NativePopoutFake.instances[0];
  f.flush();
  const oldCard = app.card;
  app.card = f.node(310);
  f.MutationObserver.instances[0].trigger(); f.flush();
  assert.equal(app.position.height, 336);
  assert(!f.ResizeObserver.instances[0].targets.has(oldCard));
  assert(f.ResizeObserver.instances[0].targets.has(app.card));
  app.card = f.node(120);
  app.dispatchEvent(new Event("render")); f.flush();
  assert.equal(app.position.height, 146);
  assert.equal(f.ResizeObserver.instances[0].targets.size, 0);
  f.ResizeObserver.instances.at(-1).trigger();
  assert.equal(f.frames.size, 1);
  await f.manager.closeAll();
  assert.equal(f.frames.size, 0);
  for (const observer of [...f.ResizeObserver.instances, ...f.MutationObserver.instances]) {
    assert.equal(observer.targets.size, 0);
    observer.trigger();
  }
  app.dispatchEvent(new Event("render"));
  app.dispatchEvent(new Event("position"));
  assert.equal(f.frames.size, 0, "closed windows have no live layout listeners");
});

test("manual resizing sets a scroll cap while short cards stay flush; restore and viewport resize refit", async () => {
  const f = observedWindow();
  await f.manager.open(f.message.id);
  const app = NativePopoutFake.instances[0];
  f.flush();
  app.setPosition({ width: 640, height: 650 }); f.flush();
  assert.equal(app.position.width, 640);
  assert.equal(app.position.height, 206, "dragging taller must not leave blank space");
  app.card.height = 1000;
  f.ResizeObserver.instances[0].trigger(); f.flush();
  assert.equal(app.position.height, 650, "long content uses the selected scroll cap");
  app.setPosition({ height: 300 }); f.flush();
  assert.equal(app.position.height, 300, "users can reduce the height for long content");
  await app.minimize();
  app.card.height = 90;
  f.ResizeObserver.instances[0].trigger(); f.flush();
  assert.equal(app.position.height, 300, "do not resize minimized frames");
  await app.maximize(); f.flush();
  assert.equal(app.position.height, 116);
  Object.assign(f.viewport, { width: 320, height: 120 });
  f.manager.fitToViewport(); f.flush();
  assert(app.position.height <= 112 && app.position.width <= 312);
  assert(app.position.top + app.position.height <= 120);
  await f.manager.closeAll();
});

test("long cards keep the initial height limit and scroll inside the content", async () => {
  class LongCardPopout extends NativePopoutFake {
    constructor(options) {
      super(options);
      this.element.offsetHeight = 520;
      this.element.clientHeight = 518;
      this.window = {
        content: { classList: { add() {} }, querySelector: () => ({ getBoundingClientRect: () => ({ height: 2000 }) }) },
        header: { classList: { add() {} }, getBoundingClientRect: () => ({ height: 24 }) }
      };
    }
  }
  const { manager, message } = setup(LongCardPopout);
  await manager.open(message.id);
  assert.equal(NativePopoutFake.instances[0].position.height, 520);
});

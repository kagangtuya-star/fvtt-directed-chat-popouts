export class Collection extends Map {
  [Symbol.iterator]() { return this.values(); }
}

export function world() {
  const users = new Collection([
    ["gm", { id: "gm", name: "GM", active: true, isGM: true }],
    ["p1", { id: "p1", name: "玩家甲", active: true, isGM: false }],
    ["p2", { id: "p2", name: "Player B", active: true, isGM: false }],
    ["off", { id: "off", name: "Offline", active: false, isGM: false }]
  ]);
  const message = {
    id: "message1", author: users.get("gm"), visible: true, isContentVisible: true,
    whisper: [], blind: false, flag: null, writes: [],
    getFlag() { return this.flag; },
    async update(data) { this.writes.push(data); this.flag = Object.values(data)[0]; return this; }
  };
  const game = {
    users, user: users.get("gm"), messages: new Collection([[message.id, message]]),
    i18n: { localize: key => key, format: (key, data) => `${key} ${JSON.stringify(data)}` }
  };
  return { game, users, message };
}

export class HookBus {
  next = 0;
  handlers = new Map();
  on(name, fn) {
    const id = ++this.next;
    if (!this.handlers.has(name)) this.handlers.set(name, new Map());
    this.handlers.get(name).set(id, fn);
    return id;
  }
  off(name, id) { this.handlers.get(name)?.delete(id); }
  call(name, ...args) { for (const fn of this.handlers.get(name)?.values() ?? []) fn(...args); }
}

export class NativePopoutFake extends EventTarget {
  static instances = [];
  constructor(options) {
    super();
    this.options = options;
    this.message = options.message;
    this.position = { ...options.position };
    this.rendered = false;
    this.minimized = false;
    this.focuses = 0;
    this.element = { classList: { add() {} } };
    NativePopoutFake.instances.push(this);
  }
  async render() { this.rendered = true; this.dispatchEvent(new Event("render")); return this; }
  async close() { this.rendered = false; this.dispatchEvent(new Event("close")); return this; }
  async minimize() { this.minimized = true; }
  async maximize() { this.minimized = false; }
  bringToFront() { this.focuses++; }
  setPosition(position) { Object.assign(this.position, position); }
}

// Small DOM contract double for the vanilla picker; this is not a browser.
export class ElementFake extends EventTarget {
  children = [];
  attributes = {};
  checked = false;
  disabled = false;
  constructor(tag) { super(); this.tagName = tag; }
  setAttribute(key, value) { this.attributes[key] = value; this[key] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  all(predicate) { return [...(predicate(this) ? [this] : []), ...this.children.flatMap(child => child.all(predicate))]; }
  async trigger(name) {
    this.dispatchEvent(new Event(name, { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
  }
}

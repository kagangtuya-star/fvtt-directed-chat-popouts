import { initialPosition } from "./compat.js";
import { canRead } from "./policy.js";

export class PopoutManager {
  #windows = new Map();

  #styleWindow(app) {
    app.element?.classList.add("dcp-popout");
    // Use public frame references instead of depending on core markup selectors.
    for (const [part, className] of Object.entries({
      header: "dcp-popout-header", title: "dcp-popout-title",
      content: "dcp-popout-content", resize: "dcp-popout-resize",
      controls: "dcp-popout-control", close: "dcp-popout-control"
    })) app.window?.[part]?.classList.add(className);
  }

  #fitCard(entry) {
    const { app } = entry;
    if (entry.closed || !app.rendered || app.minimized) return;
    const card = app.window?.content?.querySelector("[data-message-id]");
    const cardHeight = card?.getBoundingClientRect().height;
    const headerHeight = app.window?.header?.getBoundingClientRect().height;
    if (!cardHeight || !headerHeight) return;
    const borders = Math.max(0, app.element.offsetHeight - app.element.clientHeight);
    const viewport = this.viewport();
    const height = Math.max(1, Math.min(entry.heightLimit, viewport.height - 8,
      Math.ceil(cardHeight + headerHeight + borders)));
    const top = Math.max(0, Math.min(app.position.top, viewport.height - height));
    if (app.position.height === height && app.position.top === top) return;
    // Ignore our own position event; only a user's resize changes the scroll cap.
    entry.fitting = true;
    try { app.setPosition({ height, top }); }
    finally { entry.fitting = false; }
    entry.lastHeight = app.position.height;
  }

  #scheduleFit(entry) {
    if (entry.closed || entry.frame !== null) return;
    entry.frame = this.layout.requestAnimationFrame(() => {
      entry.frame = null;
      this.#fitCard(entry);
    });
  }

  #observeCard(entry) {
    entry.resizeObserver?.disconnect();
    entry.mutationObserver?.disconnect();
    const { app } = entry;
    const content = app.window?.content;
    const watchCard = () => {
      const card = content?.querySelector("[data-message-id]");
      if (card !== entry.card) {
        if (entry.card) entry.resizeObserver?.unobserve(entry.card);
        entry.card = card;
        if (card) entry.resizeObserver?.observe(card);
      }
      this.#scheduleFit(entry);
    };
    entry.card = null;
    if (this.layout.ResizeObserver && content) {
      entry.resizeObserver = new this.layout.ResizeObserver(() => this.#scheduleFit(entry));
      entry.resizeObserver.observe(app.element);
      if (app.window.header) entry.resizeObserver.observe(app.window.header);
    }
    if (this.layout.MutationObserver && content) {
      entry.mutationObserver = new this.layout.MutationObserver(watchCard);
      entry.mutationObserver.observe(content, { childList: true, subtree: true });
    }
    watchCard();
  }

  constructor({ ChatPopout, messages, viewport, instances = new Map(), layout = globalThis }) {
    Object.assign(this, { ChatPopout, messages, viewport, instances });
    this.layout = {
      ResizeObserver: layout.ResizeObserver, MutationObserver: layout.MutationObserver,
      requestAnimationFrame: callback => layout.requestAnimationFrame
        ? layout.requestAnimationFrame(callback) : setTimeout(callback, 0),
      cancelAnimationFrame: id => layout.cancelAnimationFrame
        ? layout.cancelAnimationFrame(id) : clearTimeout(id)
    };
  }

  async open(messageId) {
    const message = this.messages.get(messageId);
    if (!canRead(message)) return false;
    const previous = this.#windows.get(messageId);
    if (previous) {
      await previous.ready;
      if (this.#windows.get(messageId) !== previous) return this.open(messageId);
      if (previous.app.minimized) await previous.app.maximize();
      this.fitToViewport();
      previous.app.bringToFront();
      return true;
    }
    // Use the exact core class, preserving the system's renderChatPopout hooks
    // and core's formal ChatLog.renderMessage / ChatMessage.renderHTML path.
    const existing = Array.from(this.instances.values()).find(app =>
      app instanceof this.ChatPopout && app.message?.id === messageId && app.rendered);
    const app = existing ?? new this.ChatPopout({
      message, position: initialPosition(this.viewport(), this.#windows.size),
      window: { resizable: true, minimizable: true }
    });
    const entry = {
      app, ready: null, frame: null, closed: false, fitting: false,
      heightLimit: Number(existing?.position.height) || initialPosition(this.viewport()).height
    };
    this.#windows.set(messageId, entry);
    this.#styleWindow(app);
    app.addEventListener("close", () => {
      entry.closed = true;
      entry.resizeObserver?.disconnect();
      entry.mutationObserver?.disconnect();
      if (entry.frame !== null) this.layout.cancelAnimationFrame(entry.frame);
      app.removeEventListener("render", onRender);
      app.removeEventListener("position", onPosition);
      if (this.#windows.get(messageId) === entry) this.#windows.delete(messageId);
    }, { once: true });
    const onRender = () => {
      this.#styleWindow(app);
      this.#observeCard(entry);
      if (!canRead(this.messages.get(messageId))) {
        void app.close().catch(error => console.error("Directed Chat Popouts | close", error));
      }
    };
    const onPosition = () => {
      if (entry.fitting || app.minimized) return;
      if (entry.lastHeight !== undefined && app.position.height !== entry.lastHeight) {
        entry.heightLimit = Number(app.position.height) || entry.heightLimit;
      }
      entry.lastHeight = app.position.height;
      this.#scheduleFit(entry);
    };
    app.addEventListener("render", onRender);
    app.addEventListener("position", onPosition);
    entry.ready = (async () => {
      try {
        if (!existing) {
          await app.render({ force: true });
        } else onRender();
        if (app.minimized) await app.maximize();
        if (!canRead(this.messages.get(messageId))) {
          await app.close();
          return false;
        }
        app.bringToFront();
        this.fitToViewport();
        return true;
      } catch (error) {
        this.#windows.delete(messageId);
        await app.close().catch(() => {});
        throw error;
      }
    })();
    return entry.ready;
  }

  async synchronize(messageId) {
    if (!canRead(this.messages.get(messageId))) await this.close(messageId);
    // Core's registered document application handles ordinary message updates.
  }

  async close(messageId) {
    const entry = this.#windows.get(messageId);
    if (!entry) return;
    await entry.ready;
    await entry.app.close();
  }

  async closeAll() {
    await Promise.all(Array.from(this.#windows.keys(), id => this.close(id)));
  }

  fitToViewport() {
    const viewport = this.viewport();
    for (const entry of this.#windows.values()) {
      const { app } = entry;
      if (!app.rendered || app.minimized) continue;
      const bounds = initialPosition(viewport);
      const width = Math.max(1, Math.min(Number(app.position.width) || bounds.width, viewport.width - 8));
      const height = Math.max(1, Math.min(Number(app.position.height) || bounds.height, viewport.height - 8));
      entry.fitting = true;
      try {
        app.setPosition({
          width, height,
          left: Math.max(0, Math.min(app.position.left, viewport.width - width)),
          top: Math.max(0, Math.min(app.position.top, viewport.height - height))
        });
      } finally { entry.fitting = false; }
      this.#fitCard(entry);
      entry.lastHeight = app.position.height;
    }
  }
}

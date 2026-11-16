import { initialPosition } from "./compat.js";
import { canRead } from "./policy.js";

export class PopoutManager {
  #windows = new Map();

  constructor({ ChatPopout, messages, viewport, instances = new Map() }) {
    Object.assign(this, { ChatPopout, messages, viewport, instances });
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
    const entry = { app, ready: null };
    this.#windows.set(messageId, entry);
    app.element?.classList.add("dcp-popout");
    app.addEventListener("close", () => {
      if (this.#windows.get(messageId) === entry) this.#windows.delete(messageId);
    });
    app.addEventListener("render", () => {
      app.element?.classList.add("dcp-popout");
      if (!canRead(this.messages.get(messageId))) {
        void app.close().catch(error => console.error("Directed Chat Popouts | close", error));
      }
    });
    entry.ready = (async () => {
      try {
        if (!existing) await app.render({ force: true });
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
    for (const { app } of this.#windows.values()) {
      if (!app.rendered || app.minimized) continue;
      const bounds = initialPosition(viewport);
      const width = Math.max(1, Math.min(Number(app.position.width) || bounds.width, viewport.width - 8));
      const height = Math.max(1, Math.min(Number(app.position.height) || bounds.height, viewport.height - 8));
      app.setPosition({
        width, height,
        left: Math.max(0, Math.min(app.position.left, viewport.width - width)),
        top: Math.max(0, Math.min(app.position.top, viewport.height - height))
      });
    }
  }
}

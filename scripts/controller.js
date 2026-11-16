import { localize, MODULE_ID, PROTOCOL, REQUEST_FLAG, REQUEST_PATH } from "./constants.js";
import { canRead, recipientBlock, SeenRequests, validRequest } from "./policy.js";
import { messageIdFromTarget } from "./compat.js";

export class PushController {
  #seen = new SeenRequests();
  #hooks = [];

  constructor({ game, hooks, popouts, openPicker, notify, contextHook }) {
    Object.assign(this, { game, hooks, popouts, openPicker, notify, contextHook });
  }

  install() {
    if (this.#hooks.length) return;
    const on = (name, fn) => this.#hooks.push([name, this.hooks.on(name, fn)]);
    const run = fn => (...args) => {
      try { void Promise.resolve(fn(...args)).catch(error => this.report(error)); }
      catch (error) { this.report(error); }
    };
    on(this.contextHook, (_application, items) => this.addContextOptions(items));
    on("updateChatMessage", run(async (message, changes, _options, userId) => {
      // Validate the current flag synchronously, before a second update can
      // replace it. Two GMs may push the same message to different recipients.
      const opening = this.receive(message, changes, userId);
      await Promise.all([opening, this.popouts.synchronize(message.id)]);
    }));
    on("deleteChatMessage", run(message => this.popouts.close(message.id)));
  }

  async dispose() {
    for (const [name, id] of this.#hooks) this.hooks.off(name, id);
    this.#hooks = [];
    await this.popouts.closeAll();
  }

  report(error) {
    console.error("Directed Chat Popouts |", error);
    this.notify.error(error.message?.startsWith("DCP.")
      ? this.game.i18n.localize(error.message) : localize("Failed"));
  }

  addContextOptions(items) {
    if (!this.game.user.isGM || !Array.isArray(items)) return;
    items.push({
      name: "DCP.PushMenu",
      icon: '<i class="fa-solid fa-up-right-from-square" inert></i>',
      condition: target => this.game.user.isGM && canRead(this.game.messages.get(messageIdFromTarget(target))),
      callback: target => {
        if (!this.game.user.isGM) return;
        const message = this.game.messages.get(messageIdFromTarget(target));
        if (canRead(message)) this.openPicker(message);
      }
    });
  }

  async push(messageId, recipients) {
    if (!this.game.user.isGM) throw new Error("DCP.GMOnly");
    const message = this.game.messages.get(messageId);
    if (!canRead(message)) throw new Error("DCP.Unavailable");
    if (!Array.isArray(recipients)) throw new Error("DCP.NoRecipients");
    const eligible = [...new Set(recipients)].filter(id => {
      const user = this.game.users.get(id);
      return user && !recipientBlock(message, user);
    });
    if (!eligible.length) throw new Error("DCP.NoRecipients");
    const request = {
      protocol: PROTOCOL, nonce: crypto.randomUUID(), messageId,
      recipients: eligible, issuedAt: Date.now()
    };
    // Core's authenticated document socket workflow supplies userId to the hook.
    // Never accept a sender ID claimed in a payload. No HTML is transmitted.
    await message.update({ [REQUEST_PATH]: request });
    return eligible.length;
  }

  async receive(message, changes, userId) {
    const sender = this.game.users.get(userId);
    if (!sender?.isGM) return false;
    // A later GM content edit must not activate a flag planted by a player.
    const changed = changes?.flags?.[MODULE_ID]?.[REQUEST_FLAG];
    const nonce = changed?.nonce ?? changes?.[`${REQUEST_PATH}.nonce`]
      ?? changes?.[REQUEST_PATH]?.nonce;
    if (typeof nonce !== "string") return false;
    const request = message.getFlag(MODULE_ID, REQUEST_FLAG);
    if (nonce !== request?.nonce || !canRead(message)) return false;
    if (recipientBlock(message, this.game.user)) return false;
    if (!validRequest(request, message.id, this.game.user, this.game.users)) return false;
    if (!this.#seen.accept(`${message.id}:${nonce}`)) return false;
    return this.popouts.open(message.id);
  }
}

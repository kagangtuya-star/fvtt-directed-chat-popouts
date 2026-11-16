import { MODULE_ID, localize } from "./constants.js";
import { hostCapabilities, viewportSize } from "./compat.js";
import { PopoutManager } from "./popouts.js";
import { recipientPickerClass } from "./picker.js";
import { PushController } from "./controller.js";

Hooks.once("ready", () => {
  let capabilities;
  try { capabilities = hostCapabilities(); }
  catch (error) {
    console.error("Directed Chat Popouts |", error);
    ui.notifications.error(localize("Unsupported"));
    return;
  }
  const popouts = new PopoutManager({
    ChatPopout: capabilities.ChatPopout, instances: capabilities.instances, messages: game.messages,
    viewport: () => viewportSize()
  });
  const Picker = recipientPickerClass(capabilities.ApplicationV2);
  const pickers = new Map();
  const controller = new PushController({
    game, hooks: Hooks, popouts, notify: ui.notifications, contextHook: capabilities.contextHook,
    openPicker: message => {
      let picker = pickers.get(message.id);
      if (!picker) {
        picker = new Picker(message, controller);
        pickers.set(message.id, picker);
        picker.addEventListener("close", () => pickers.delete(message.id));
      }
      void picker.render({ force: true }).then(() => picker.bringToFront()).catch(error => controller.report(error));
    }
  });
  controller.install();
  const refreshPickers = () => {
    for (const picker of pickers.values()) {
      if (!picker.sending) void picker.render({ force: true }).catch(error => controller.report(error));
    }
  };
  Hooks.on("userConnected", refreshPickers);
  Hooks.on("updateUser", refreshPickers);
  Hooks.on("deleteUser", refreshPickers);
  Hooks.on("deleteChatMessage", message => {
    const picker = pickers.get(message.id);
    if (picker) void picker.close().catch(error => controller.report(error));
  });
  globalThis.addEventListener("resize", () => popouts.fitToViewport());
  console.info(`${MODULE_ID} | ready`);
});

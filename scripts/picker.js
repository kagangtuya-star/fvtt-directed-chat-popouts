import { initialPosition, viewportSize } from "./compat.js";
import { localize } from "./constants.js";
import { recipientRows } from "./policy.js";

function element(tag, { text, className, ...attributes } = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export function recipientPickerClass(ApplicationV2) {
  return class RecipientPicker extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["dcp-recipient-picker"],
      window: { title: "DCP.PickerTitle", icon: "fa-solid fa-users", resizable: true, minimizable: false },
      position: { width: 420, height: 460 }
    };

    constructor(message, controller) {
      super({ position: initialPosition(viewportSize()) });
      this.message = message;
      this.controller = controller;
      this.selected = new Set(recipientRows(message, game.users, game.user.id).filter(row => !row.blocked && !row.isGM).map(row => row.id));
      this.sending = false;
    }

    get title() { return localize("PickerTitle"); }

    async _renderHTML() {
      const form = element("form", { className: "dcp-picker-form" });
      form.append(element("p", { text: localize("PickerHelp") }));
      const toolbar = element("div", { className: "dcp-selection-actions" });
      const all = element("button", { type: "button", text: localize("SelectAll") });
      const none = element("button", { type: "button", text: localize("SelectNone") });
      toolbar.append(all, none);
      form.append(toolbar);
      const list = element("div", { className: "dcp-recipient-list", role: "group", "aria-label": localize("Recipients") });
      const rows = recipientRows(this.message, game.users, game.user.id);
      this.selected = new Set(rows.filter(row => !row.blocked && this.selected.has(row.id)).map(row => row.id));
      const checks = [];
      for (const row of rows) {
        const label = element("label", { className: `dcp-recipient${row.blocked ? " dcp-unavailable" : ""}` });
        const input = element("input", { type: "checkbox", value: row.id, name: "recipients" });
        input.checked = !row.blocked && this.selected.has(row.id);
        input.disabled = !!row.blocked || this.sending;
        const status = row.active ? localize("Online") : localize("Offline");
        const name = row.isSelf && row.isGM ? localize("SelfGM", { name: row.name }) : row.name;
        label.append(input, element("span", { className: "dcp-user-name", text: name }),
          element("span", { className: "dcp-user-status", text: row.blocked === "Private" ? `${status} · ${localize("Private")}` : status }));
        list.append(label);
        checks.push(input);
      }
      if (!rows.length) list.append(element("p", { text: localize("NoPlayers") }));
      form.append(list, element("p", { className: "dcp-privacy-note", text: localize("PrivacyNote") }));
      const footer = element("footer", { className: "dcp-picker-footer" });
      const push = element("button", { type: "submit", text: localize(this.sending ? "Sending" : "Push") });
      const cancel = element("button", { type: "button", text: localize("Cancel") });
      footer.append(push, cancel);
      form.append(footer);
      const sync = () => {
        this.selected = new Set(checks.filter(input => input.checked && !input.disabled).map(input => input.value));
        push.disabled = this.sending || !this.selected.size;
      };
      for (const input of checks) input.addEventListener("change", sync);
      all.disabled = none.disabled = this.sending;
      all.addEventListener("click", () => { checks.filter(input => !input.disabled).forEach(input => { input.checked = true; }); sync(); });
      none.addEventListener("click", () => { checks.forEach(input => { input.checked = false; }); sync(); });
      cancel.disabled = this.sending;
      cancel.addEventListener("click", () => { void this.close(); });
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (this.sending || !this.selected.size) return;
        this.sending = true;
        push.disabled = all.disabled = none.disabled = cancel.disabled = true;
        checks.forEach(input => { input.disabled = true; });
        push.textContent = localize("Sending");
        try {
          const count = await this.controller.push(this.message.id, [...this.selected]);
          ui.notifications.info(localize("Sent", { count }));
          await this.close();
        } catch (error) {
          this.controller.report(error);
          this.sending = false;
          await this.render({ force: true });
        }
      });
      push.disabled = this.sending || !checks.some(input => input.checked && !input.disabled);
      return form;
    }

    _replaceHTML(result, content) { content.replaceChildren(result); }
  };
}

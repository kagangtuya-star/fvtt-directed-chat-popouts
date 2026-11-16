import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recipientPickerClass } from "../scripts/picker.js";
import { ElementFake, world } from "./helpers.mjs";

class AppFake {
  constructor(options) { this.options = options; }
  async close() { this.closed = true; }
  async render() { this.form = await this._renderHTML(); }
}

beforeEach(() => {
  globalThis.document = { createElement: tag => new ElementFake(tag) };
  globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
  globalThis.ui = { notifications: { info() {} } };
});

async function setup() {
  const f = world();
  globalThis.game = f.game;
  const sent = [], errors = [];
  const controller = {
    push: async (id, ids) => { sent.push([id, ids]); return ids.length; },
    report: error => errors.push(error)
  };
  const Picker = recipientPickerClass(AppFake);
  const picker = new Picker(f.message, controller);
  await picker.render();
  const inputs = () => picker.form.all(node => node.tagName === "input");
  const button = key => picker.form.all(node => node.tagName === "button" && node.textContent === `DCP.${key}`)[0];
  return { ...f, picker, sent, errors, inputs, button, controller };
}

test("picker defaults online players, renders offline disabled, safely renders names", async () => {
  const { picker, inputs, users } = await setup();
  assert.deepEqual([...picker.selected], ["p1", "p2"]);
  assert.equal(inputs().length, 3);
  assert.equal(inputs().find(input => input.value === "off").disabled, true);
  users.get("p1").name = '<img src=x onerror="alert(1)">';
  await picker.render();
  const name = picker.form.all(node => node.className === "dcp-user-name")[0];
  assert.equal(name.textContent, users.get("p1").name);
  assert.equal(name.children.length, 0);
});

test("clear/select all never selects offline users; empty selection disables push", async () => {
  const { picker, inputs, button } = await setup();
  await button("SelectNone").trigger("click");
  assert.equal(button("Push").disabled, true);
  assert.equal(picker.selected.size, 0);
  await button("SelectAll").trigger("click");
  assert.equal(button("Push").disabled, false);
  assert.deepEqual([...picker.selected], ["p1", "p2"]);
  assert.equal(inputs().find(input => input.value === "off").checked, false);
});

test("individual selection submits once and closes", async () => {
  const { picker, inputs, sent } = await setup();
  const second = inputs().find(input => input.value === "p2");
  second.checked = false;
  await second.trigger("change");
  await picker.form.trigger("submit");
  await picker.form.trigger("submit");
  assert.deepEqual(sent, [["message1", ["p1"]]]);
  assert.equal(picker.closed, true);
});

test("online status refresh removes disconnected recipients without erasing remaining choice", async () => {
  const { picker, inputs, users, button } = await setup();
  users.get("p2").active = false;
  await picker.render();
  assert.equal(inputs().find(input => input.value === "p2").checked, false);
  assert.equal(inputs().find(input => input.value === "p2").disabled, true);
  users.get("p1").active = false;
  await picker.render();
  assert.equal(button("Push").disabled, true);
});

test("push error restores usable form; cancellation sends nothing", async () => {
  const { picker, controller, errors, button, sent } = await setup();
  controller.push = async () => { throw Error("disconnected"); };
  await picker.form.trigger("submit");
  assert.equal(errors[0].message, "disconnected");
  assert.equal(picker.sending, false);
  assert.equal(button("Push").disabled, false);
  await button("Cancel").trigger("click");
  assert.equal(picker.closed, true);
  assert.equal(sent.length, 0);
});

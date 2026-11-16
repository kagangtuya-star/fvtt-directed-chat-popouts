export const MODULE_ID = "directed-chat-popouts";
export const REQUEST_FLAG = "request";
export const REQUEST_PATH = `flags.${MODULE_ID}.${REQUEST_FLAG}`;
export const PROTOCOL = 1;
export const MAX_AGE_MS = 120_000;
export const FUTURE_TOLERANCE_MS = 30_000;

export function localize(key, data) {
  const id = `DCP.${key}`;
  return data ? game.i18n.format(id, data) : game.i18n.localize(id);
}

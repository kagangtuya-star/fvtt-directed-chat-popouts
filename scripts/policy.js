import { FUTURE_TOLERANCE_MS, MAX_AGE_MS, PROTOCOL } from "./constants.js";

// The receiving client's visibility getters remain authoritative for systems.
export function recipientBlock(message, user) {
  if (user.isGM) return "GMOnly";
  if (!user.active) return "Offline";
  if (message.blind) return "Private";
  const whisper = message.whisper ?? [];
  const authorId = message.author?.id ?? message.user?.id ?? message.user;
  if (whisper.length && !whisper.includes(user.id) && authorId !== user.id) return "Private";
  return null;
}

export function recipientRows(message, users) {
  return Array.from(users).filter(user => !user.isGM).map(user => ({
    id: user.id, name: user.name, active: user.active === true,
    blocked: recipientBlock(message, user)
  }));
}

export function canRead(message) {
  return !!message && message.visible === true && message.isContentVisible === true;
}

export function validRequest(request, messageId, user, users, now = Date.now()) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return false;
  if (request.protocol !== PROTOCOL || request.messageId !== messageId) return false;
  if (typeof request.nonce !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(request.nonce)) return false;
  if (!Number.isSafeInteger(request.issuedAt)
    || now - request.issuedAt > MAX_AGE_MS || request.issuedAt - now > FUTURE_TOLERANCE_MS) return false;
  const ids = request.recipients;
  if (!Array.isArray(ids) || !ids.length || ids.length > users.size) return false;
  if (new Set(ids).size !== ids.length) return false;
  if (ids.some(id => typeof id !== "string" || !users.get(id) || users.get(id).isGM)) return false;
  return user?.active === true && !user.isGM && ids.includes(user.id);
}

export class SeenRequests {
  #entries = new Map();

  accept(key, now = Date.now()) {
    for (const [id, time] of this.#entries) {
      if (now - time > MAX_AGE_MS) this.#entries.delete(id);
    }
    if (this.#entries.has(key)) return false;
    if (this.#entries.size >= 1024) this.#entries.delete(this.#entries.keys().next().value);
    this.#entries.set(key, now);
    return true;
  }
}

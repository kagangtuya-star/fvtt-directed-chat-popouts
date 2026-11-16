// Both supported generations expose the same public APIs.
export function hostCapabilities(host = globalThis) {
  const generation = Number(host.game.release.generation);
  const ApplicationV2 = host.foundry?.applications?.api?.ApplicationV2;
  const ChatPopout = host.foundry?.applications?.sidebar?.apps?.ChatPopout;
  if (![13, 14].includes(generation) || !ApplicationV2 || !ChatPopout) {
    throw new Error("DCP.Unsupported");
  }
  return { ApplicationV2, ChatPopout, instances: host.foundry.applications.instances, contextHook: "getChatMessageContextOptions" };
}

export function messageIdFromTarget(target) {
  const element = target?.nodeType === 1 ? target : target?.[0];
  return element?.closest?.("[data-message-id]")?.dataset.messageId ?? null;
}

export function initialPosition(viewport, offset = 0) {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const margin = Math.min(16, vw / 8, vh / 8);
  const width = Math.min(420, vw - margin * 2);
  const height = Math.min(520, vh - margin * 2);
  const step = (offset % 6) * 24;
  return {
    width, height,
    left: Math.min(Math.max(margin, (vw - width) / 2 + step), vw - width - margin),
    top: Math.min(Math.max(margin, (vh - height) / 3 + step), vh - height - margin)
  };
}

export function viewportSize(host = globalThis) {
  return { width: host.innerWidth, height: host.innerHeight };
}

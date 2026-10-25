import type { SonaStore } from "./storage/index.js";
export type SidebarEntry = { name?: string; pinned?: boolean };
export type SidebarState = Record<string, SidebarEntry>;
export function updateSidebar(
  store: SonaStore,
  kind: string,
  id: string,
  input: unknown,
) {
  if (!["agents", "studies", "sessions"].includes(kind))
    throw new Error("Unknown sidebar item type.");
  const collection =
    kind === "agents"
      ? store.agents
      : kind === "studies"
        ? store.studies
        : store.sessions;
  collection.get(id);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("An item update is required.");
  const change = input as SidebarEntry;
  const next: SidebarEntry = {};
  if ("name" in change) {
    if (
      typeof change.name !== "string" ||
      !change.name.trim() ||
      change.name.trim().length > 120
    )
      throw new Error("Use a name between 1 and 120 characters.");
    next.name = change.name.trim();
  }
  if ("pinned" in change) {
    if (typeof change.pinned !== "boolean")
      throw new Error("Pinned must be true or false.");
    next.pinned = change.pinned;
  }
  if (!Object.keys(next).length)
    throw new Error("Provide a name or pin preference.");
  const state = store.metadata.get<SidebarState>("sidebar") ?? {};
  const key = `${kind}:${id}`;
  state[key] = { ...state[key], ...next };
  if (next.name && kind === "agents") {
    const current = store.agents.get(id);
    store.agents.updateDraft(
      id,
      { ...current.draft, name: next.name },
      next.name,
    );
    delete state[key].name;
  } else if (next.name && kind === "studies") {
    store.studies.save({ ...store.studies.get(id), name: next.name });
    delete state[key].name;
  }
  store.metadata.set("sidebar", state);
  return state;
}

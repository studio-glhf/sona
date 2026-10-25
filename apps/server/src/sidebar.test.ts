import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./storage/index.js";
import { updateSidebar } from "./sidebar.js";
import { defaultAgentConfig } from "../../../packages/agent-core/src/index.js";
it("persists names and pins without rewriting captured session snapshots", () => {
  const dir = mkdtempSync(join(tmpdir(), "sona-sidebar-"));
  let store = createStore(dir);
  try {
    const agent = store.agents.create({
      name: "Original",
      draft: defaultAgentConfig("Original"),
    });
    const session = store.sessions.start({
      kind: "quick",
      agentId: agent.id,
      processingAccepted: true,
    });
    const snapshot = store.sessions.get(session.id).snapshot;
    updateSidebar(store, "agents", agent.id, { name: "Renamed", pinned: true });
    expect(store.agents.get(agent.id).name).toBe("Renamed");
    expect(store.agents.get(agent.id).draft.name).toBe("Renamed");
    updateSidebar(store, "sessions", session.id, {
      name: "Microphone check",
      pinned: true,
    });
    expect(store.sessions.get(session.id).snapshot).toEqual(snapshot);
    store.close();
    store = createStore(dir);
    expect(
      store.metadata.get<any>("sidebar")[`sessions:${session.id}`],
    ).toEqual({ name: "Microphone check", pinned: true });
    expect(
      store.metadata.get<any>("sidebar")[`agents:${agent.id}`].pinned,
    ).toBe(true);
    expect(() => store.agents.delete(agent.id)).toThrow("related sessions");
    store.sessions.delete(session.id);
    store.agents.delete(agent.id);
    expect(store.agents.list()).toHaveLength(0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("validates item identity and metadata before saving", () => {
  const dir = mkdtempSync(join(tmpdir(), "sona-sidebar-invalid-")),
    store = createStore(dir);
  try {
    const agent = store.agents.create({
      name: "Fixture",
      draft: defaultAgentConfig(),
    });
    for (const value of [
      { name: " " },
      { name: "a".repeat(121) },
      { pinned: "yes" },
      {},
    ])
      expect(() => updateSidebar(store, "agents", agent.id, value)).toThrow();
    expect(() =>
      updateSidebar(store, "unknown", agent.id, { pinned: true }),
    ).toThrow();
    expect(() =>
      updateSidebar(store, "agents", "missing", { pinned: true }),
    ).toThrow();
    expect(store.metadata.get("sidebar")).toBeUndefined();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

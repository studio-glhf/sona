import { describe, it, expect, vi } from "vitest";
import {
  ConnectionManager,
  importPlugin,
  googleCalendarDefinition,
  MemoryOAuthProvider,
  McpConnection,
} from "../src/index.js";
const callback = "http://127.0.0.1:4317/api/oauth/callback";
const definition = () => ({
  ...googleCalendarDefinition(),
  id: "external",
  endpoint: "https://example.com/mcp",
  oauth: undefined,
});
describe("external import versus local credential authority", () => {
  it.each([
    { ...definition(), tokenEnv: "OPENAI_API_KEY" },
    {
      ...definition(),
      oauth: {
        scopes: [],
        allowedOrigins: [],
        clientIdEnv: "OPENAI_PROJECT_ID",
        clientSecretEnv: "OPENAI_ADMIN_KEY",
      },
    },
    {
      mcpServers: {
        x: {
          url: "https://example.com/mcp",
          oauth: {
            scopes: [],
            allowedOrigins: [],
            clientSecretEnv: "OPENAI_ADMIN_KEY",
          },
        },
      },
    },
    {
      mcp: {
        mcpServers: {
          x: { url: "https://example.com/mcp", tokenEnv: "OPENAI_API_KEY" },
        },
      },
    },
    {
      ...definition(),
      reviewVersion: 1,
      credentialBindingHash: "publisher-forged",
    },
  ])(
    "rejects publisher-selected credentials or forged provenance %#",
    (input) => {
      expect(() => importPlugin(input)).toThrow();
    },
  );
  it("resets full-definition approvals and resources without discarding descriptive instructions", () => {
    const [result] = importPlugin({
      ...definition(),
      instructions: "Published guidance",
      instructionsApproved: true,
      tools: { read: { effect: "read", schemaHash: "publisher" } },
      resourceBindings: { test: "publisher-choice" },
    });
    expect(result).toMatchObject({
      instructions: "Published guidance",
      instructionsApproved: false,
      tools: {},
    });
    expect(result.resourceBindings).toBeUndefined();
  });
  it("preserves explicitly local bindings across restart and blocks destination changes", async () => {
    const records: any[] = [];
    const local = { ...definition(), tokenEnv: "OWNER_TOKEN" };
    const manager = new ConnectionManager({
      callbackUrl: callback,
      env: { OWNER_TOKEN: "synthetic-owner-token" },
      persistence: {
        save: (r) => {
          records.push(structuredClone(r));
        },
      },
    });
    const [saved] = await manager.importLocalDefinition(local);
    const tamperedFactory = vi.fn();
    const changed = new ConnectionManager({
      callbackUrl: callback,
      records: records.map((r) => ({
        ...r,
        endpoint: "https://attacker.example/mcp",
      })),
      mcpFactory: tamperedFactory,
    });
    expect((await changed.connect(local.id)).status).toBe(
      "needs-configuration",
    );
    expect(tamperedFactory).not.toHaveBeenCalled();
    await changed.close();
    const observed: string[] = [];
    const factory = vi.fn((d: any, c: string, e: any) => {
      const client = new McpConnection(d, c, e);
      client.connect = async () => {
        observed.push(client.auth.tokens()?.access_token ?? "");
        return [];
      };
      return client;
    });
    const fresh = new ConnectionManager({
      callbackUrl: callback,
      env: { OWNER_TOKEN: "synthetic-owner-token" },
      records,
      mcpFactory: factory,
    });
    expect((await fresh.connect(local.id)).status).toBe("ready");
    expect(observed).toEqual(["synthetic-owner-token"]);
    await expect(
      fresh.updateDefinition(local.id, {
        ...local,
        endpoint: "https://attacker.example/mcp",
      }),
    ).rejects.toThrow("private binding");
    expect(saved.credentialBindingHash).toBeTruthy();
    // A replacement must actually remove omitted credentials, not retain stale optional fields.
    await fresh.updateDefinition(local.id, definition());
    expect(fresh.getPublic(local.id).tokenEnv).toBeUndefined();
    expect(fresh.getPublic(local.id).credentialBindingHash).toBeUndefined();
    await fresh.connect(local.id);
    expect(observed.at(-1)).toBe("");
    await manager.close();
    await fresh.close();
  });
  it("quarantines unmarked legacy credentials and approvals before constructing a client", async () => {
    const factory = vi.fn();
    const legacy: any = {
      ...definition(),
      tokenEnv: "OPENAI_API_KEY",
      instructionsApproved: true,
      tools: { read: { effect: "read", schemaHash: "publisher" } },
      status: "ready",
      accountVerified: true,
      discoveredTools: [],
      reuseVerified: false,
    };
    const manager = new ConnectionManager({
      callbackUrl: callback,
      env: { OPENAI_API_KEY: "synthetic-unrelated-secret" },
      records: [legacy],
      mcpFactory: factory,
    });
    expect(manager.getPublic(legacy.id)).toMatchObject({
      instructionsApproved: false,
      tools: {},
    });
    expect((await manager.connect(legacy.id)).error).toContain(
      "reviewed server credential",
    );
    expect(factory).not.toHaveBeenCalled();
    await expect(
      manager.updateDefinition(legacy.id, {
        ...definition(),
        tokenEnv: "OPENAI_API_KEY",
      }),
    ).rejects.toThrow();
    await manager.close();
  });
  it.each([
    callback,
    "http://localhost:4320/api/oauth/callback",
    "http://127.0.0.1:4317/api/connections/oauth/callback",
  ])("constructs the real client for supported callback %s", (url) => {
    expect(() => new McpConnection(definition(), url, {})).not.toThrow();
  });
  it.each([
    "https://attacker.example/api/oauth/callback",
    "http://127.0.0.1:4317/unrelated",
    "http://user@localhost:4317/api/oauth/callback",
    "http://localhost:4317/api/oauth/callback?x=y",
    "http://localhost:4317/api/oauth/callback#fragment",
  ])("rejects unsafe callback %s", (url) => {
    expect(() => new MemoryOAuthProvider(definition(), url, {})).toThrow();
  });
});

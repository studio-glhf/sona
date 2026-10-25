import { z } from "zod";
import type { ConnectionDefinition } from "./types.js";
import { assertEndpoint, ConnectionError, hash } from "./security.js";

const envName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const pointer = z.string().startsWith("/").max(1000);
export const connectionDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    name: z.string().min(1).max(120),
    route: z.enum(["mcp", "codex"]),
    endpoint: z.string().url().optional(),
    source: z.string().min(1).max(2000),
    sourceVersion: z.string().max(200).optional(),
    sourceHash: z.string().min(1),
    instructions: z.string().max(100_000).optional(),
    instructionsApproved: z.boolean().default(false),
    codexServer: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,120}$/)
      .optional(),
    oauth: z
      .object({
        clientIdEnv: envName.optional(),
        clientSecretEnv: envName.optional(),
        issuer: z.string().url().optional(),
        scopes: z.array(z.string().max(300)).max(50),
        allowedOrigins: z.array(z.string().url()).max(20),
        identity: z
          .object({
            url: z.string().url(),
            subjectField: z.string(),
            labelField: z.string().optional(),
          })
          .optional(),
      })
      .strict()
      .optional(),
    tokenEnv: envName.optional(),
    accountLabel: z.string().max(200).optional(),
    expectedAccountId: z.string().max(300).optional(),
    tools: z
      .record(
        z.string(),
        z
          .object({
            effect: z.enum(["read", "write"]),
            schemaHash: z.string(),
            resourcePointer: pointer.optional(),
            resources: z.array(z.string().min(1)).optional(),
            forbiddenPointers: z.array(pointer).optional(),
            idempotencyPointer: pointer.optional(),
            idempotencyEncoding: z.enum(["operation-id", "sha256"]).optional(),
            externalIdPointer: pointer.optional(),
            reconciliation: z
              .object({
                toolName: z.string(),
                operationIdPointer: pointer.optional(),
                externalIdPointer: pointer.optional(),
                arguments: z.record(z.string(), z.unknown()),
                resultIdPointer: pointer,
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .default({}),
    resourceBindings: z.record(z.string(), z.string().min(1)).optional(),
    timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
    readRetries: z.number().int().min(0).max(2).default(1),
  })
  .strict();

export function validateDefinition(value: unknown): ConnectionDefinition {
  const definition = connectionDefinitionSchema.parse(value);
  if (definition.route === "mcp") {
    if (!definition.endpoint)
      throw new ConnectionError("endpoint", "An MCP endpoint is necessary.");
    assertEndpoint(definition.endpoint);
  }
  if (definition.route === "codex" && !definition.codexServer)
    throw new ConnectionError("server", "Select the Codex MCP server name.");
  for (const origin of definition.oauth?.allowedOrigins ?? []) {
    const url = assertEndpoint(origin);
    if (url.origin !== origin)
      throw new ConnectionError(
        "oauth-origin",
        "OAuth origins must have no path.",
      );
  }
  if (definition.oauth?.identity) {
    const url = assertEndpoint(definition.oauth.identity.url);
    if (!definition.oauth.allowedOrigins.includes(url.origin))
      throw new ConnectionError(
        "identity-origin",
        "Approve the identity endpoint origin before sign-in.",
      );
  }
  return definition;
}

/** Declarative import only. Executable hooks and inline secrets are never run or saved. */
export function importPlugin(
  value: unknown,
  source = "Local definition",
): ConnectionDefinition[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ConnectionError(
      "manifest",
      "Import a JSON plugin manifest or MCP definition.",
    );
  const object = value as Record<string, unknown>;
  const forbidden = [
    "command",
    "args",
    "env",
    "hooks",
    "scripts",
    "installer",
    "install",
    "client_secret",
    "access_token",
    "refresh_token",
    "headers",
  ];
  const walk = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    for (const [key, v] of Object.entries(item)) {
      if (["tokenEnv", "clientIdEnv", "clientSecretEnv"].includes(key))
        throw new ConnectionError(
          "manifest-credential-binding",
          "Imported metadata cannot choose server credentials. Use a reviewed private connection binding or the built-in connection setup.",
        );
      if (
        forbidden.includes(key) ||
        (/api.?key|password|secret/i.test(key) && !key.endsWith("Env"))
      )
        throw new ConnectionError(
          "manifest-executable",
          "Import only descriptive metadata and remote MCP definitions. Use server environment references for credentials.",
        );
      walk(v);
    }
  };
  walk(object);
  const external = (value: unknown): ConnectionDefinition => {
    const definition = validateDefinition(value);
    if (
      definition.tokenEnv ||
      definition.oauth?.clientIdEnv ||
      definition.oauth?.clientSecretEnv
    )
      throw new ConnectionError(
        "manifest-credential-binding",
        "Imported metadata cannot choose server credentials. Use a reviewed private connection binding or the built-in connection setup.",
      );
    return {
      ...definition,
      instructionsApproved: false,
      tools: {},
      resourceBindings: undefined,
    };
  };
  if ("route" in object) return [external(object)];
  const serverMap =
    object.mcpServers ??
    (object.mcp as Record<string, unknown> | undefined)?.mcpServers;
  if (!serverMap || typeof serverMap !== "object")
    throw new ConnectionError(
      "manifest-endpoint",
      "This manifest has no remote MCP definition. Import its published .mcp.json with server environment references. A marketplace URL alone is not executable.",
    );
  return Object.entries(serverMap).map(([name, entry]) => {
    if (!entry || typeof entry !== "object")
      throw new ConnectionError(
        "manifest-server",
        "The MCP server definition is invalid.",
      );
    const server = entry as Record<string, unknown>;
    if (
      server.type &&
      !["http", "streamable-http"].includes(String(server.type))
    )
      throw new ConnectionError(
        "manifest-transport",
        "This release imports remote HTTP MCP definitions. It does not execute plugin commands.",
      );
    return external({
      id: name,
      name: typeof object.name === "string" ? object.name : name,
      route: "mcp",
      endpoint: server.url,
      source,
      sourceVersion: object.version,
      sourceHash: hash(value),
      instructions:
        typeof object.instructions === "string"
          ? object.instructions
          : undefined,
      instructionsApproved: false,
      oauth: server.oauth,
      tools: {},
      timeoutMs: 30_000,
      readRetries: 1,
    });
  });
}

export function googleCalendarDefinition(): ConnectionDefinition {
  return validateDefinition({
    id: "google-calendar",
    name: "Google Calendar",
    route: "mcp",
    endpoint: "https://calendarmcp.googleapis.com/mcp/v1",
    source:
      "https://github.com/openai/plugins/tree/main/plugins/google-calendar",
    sourceVersion: "1.2.6 (PRD source)",
    sourceHash: hash({
      endpoint: "https://calendarmcp.googleapis.com/mcp/v1",
      version: "1.2.6",
    }),
    instructionsApproved: false,
    oauth: {
      clientIdEnv: "GOOGLE_CLIENT_ID",
      clientSecretEnv: "GOOGLE_CLIENT_SECRET",
      issuer: "https://accounts.google.com",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.calendars.readonly",
      ],
      allowedOrigins: [
        "https://calendarmcp.googleapis.com",
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
        "https://openidconnect.googleapis.com",
      ],
      identity: {
        url: "https://openidconnect.googleapis.com/v1/userinfo",
        subjectField: "sub",
        labelField: "email",
      },
    },
    tools: {},
    timeoutMs: 30_000,
    readRetries: 1,
  });
}

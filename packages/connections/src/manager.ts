import { performance } from "node:perf_hooks";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type {
  ConnectionAdapter,
  DiscoveredTool,
  ReconcileRequest,
  ReconcileResult,
  ToolInvocation,
  ToolResult,
} from "@sona/agent-core";
import { ToolExecutionError, redact as redactSecrets } from "@sona/agent-core";
import { CodexBridge } from "./codex.js";
import { importPlugin, validateDefinition } from "./definitions.js";
import { McpConnection } from "./mcp.js";
import {
  ConnectionError,
  getPointer,
  hash,
  redact,
  safeError,
  setPointer,
} from "./security.js";
import type {
  ConnectionAudit,
  ConnectionDefinition,
  ConnectionPersistence,
  ConnectionRecord,
  ToolPolicy,
} from "./types.js";

export interface ConnectionManagerOptions {
  callbackUrl: string;
  env?: NodeJS.ProcessEnv;
  records?: ConnectionRecord[];
  persistence?: ConnectionPersistence;
  audit?: (event: ConnectionAudit) => void | Promise<void>;
  /** Dependency injection is used only in contract tests, never as a production fallback. */
  mcpFactory?: (
    definition: ConnectionDefinition,
    callbackUrl: string,
    env: NodeJS.ProcessEnv,
  ) => McpConnection;
  codex?: CodexBridge;
}

export class ConnectionManager {
  private records = new Map<string, ConnectionRecord>();
  private clients = new Map<string, McpConnection>();
  private bridge: CodexBridge;
  private writes = new Set<string>();
  private env: NodeJS.ProcessEnv;
  constructor(private options: ConnectionManagerOptions) {
    this.env = options.env ?? process.env;
    this.bridge = options.codex ?? new CodexBridge();
    for (const saved of options.records ?? []) {
      const definition = validateDefinition(this.definition(saved));
      const reviewed = saved.reviewVersion === 1;
      this.records.set(saved.id, {
        ...definition,
        // Legacy imports cannot prove that credential bindings or policies were reviewed.
        ...(!reviewed
          ? {
              tools: {},
              instructionsApproved: false,
              resourceBindings: undefined,
            }
          : {}),
        reviewVersion: 1,
        credentialBindingHash: reviewed
          ? saved.credentialBindingHash
          : undefined,
        status: "needs-verification",
        accountVerified: false,
        discoveredTools: [],
        reuseVerified: false,
      });
    }
  }
  private definition(record: ConnectionRecord): ConnectionDefinition {
    const {
      status: _,
      accountId: __,
      accountVerified: ___,
      workspace: ____,
      runtimeVersion: _____,
      discoveredTools: ______,
      lastCheckAt: _______,
      error: ________,
      authorizationUrl: _________,
      reuseVerified: __________,
      reviewVersion: _review,
      credentialBindingHash: _binding,
      ...definition
    } = record;
    return definition;
  }
  private get(id: string): ConnectionRecord {
    const record = this.records.get(id);
    if (!record)
      throw new ConnectionError("missing", "The connection does not exist.");
    return record;
  }
  private async save(record: ConnectionRecord): Promise<void> {
    // The authorization URL contains transient OAuth state and must not enter durable records.
    const { authorizationUrl: _, ...durable } = record;
    // Optional runtime fields are cleared with undefined; durable metadata is JSON.
    await this.options.persistence?.save(JSON.parse(JSON.stringify(durable)));
  }
  list(): ConnectionRecord[] {
    return [...this.records.values()].map((x) => this.getPublic(x.id));
  }
  getPublic(id: string): ConnectionRecord {
    const record = this.get(id);
    const { authorizationUrl: _, ...publicRecord } = record;
    return structuredClone(publicRecord);
  }
  async importDefinition(
    value: unknown,
    source?: string,
  ): Promise<ConnectionRecord[]> {
    return this.addDefinitions(importPlugin(value, source), false);
  }
  /** Only owner-authored server bindings, never browser/published JSON imports. */
  async importLocalDefinition(value: unknown): Promise<ConnectionRecord[]> {
    return this.addDefinitions([validateDefinition(value)], true);
  }
  private credentialScope(
    definition: ConnectionDefinition,
  ): string | undefined {
    if (
      !definition.tokenEnv &&
      !definition.oauth?.clientIdEnv &&
      !definition.oauth?.clientSecretEnv
    )
      return undefined;
    return hash(
      JSON.parse(
        JSON.stringify({
          route: definition.route,
          endpoint: definition.endpoint ?? null,
          codexServer: definition.codexServer ?? null,
          tokenEnv: definition.tokenEnv ?? null,
          oauth: definition.oauth ?? null,
        }),
      ),
    );
  }
  private assertCredentialBinding(record: ConnectionRecord): void {
    const expected = this.credentialScope(this.definition(record));
    if (expected && record.credentialBindingHash !== expected)
      throw new ConnectionError(
        "credential-binding",
        "This connection needs reviewed server credential bindings. Remove and add the built-in connection again, or load an owner-reviewed private binding.",
      );
  }
  private async addDefinitions(
    definitions: ConnectionDefinition[],
    local: boolean,
  ): Promise<ConnectionRecord[]> {
    const records: ConnectionRecord[] = [];
    for (const definition of definitions) {
      if (this.records.has(definition.id))
        throw new ConnectionError(
          "duplicate",
          "A connection already uses this identifier. Use a new identifier or edit its settings.",
        );
      const record: ConnectionRecord = {
        ...definition,
        reviewVersion: 1,
        credentialBindingHash: local
          ? this.credentialScope(definition)
          : undefined,
        status: "needs-verification",
        accountVerified: false,
        discoveredTools: [],
        reuseVerified: false,
      };
      this.records.set(record.id, record);
      await this.save(record);
      records.push(this.getPublic(record.id));
    }
    return records;
  }
  async updateDefinition(
    id: string,
    input: unknown,
  ): Promise<ConnectionRecord> {
    const current = this.get(id),
      definition = validateDefinition(input);
    if (definition.id !== id)
      throw new ConnectionError(
        "identifier",
        "The connection identifier cannot change.",
      );
    const credentialScope = this.credentialScope(definition);
    if (credentialScope && credentialScope !== current.credentialBindingHash)
      throw new ConnectionError(
        "credential-binding",
        "Changing server credentials or their destination requires an owner-reviewed private binding.",
      );
    await this.clients.get(id)?.close();
    this.clients.delete(id);
    const replacement: ConnectionRecord = {
      ...definition,
      reviewVersion: 1,
      credentialBindingHash: credentialScope,
      status: "needs-verification",
      accountId: undefined,
      accountVerified: false,
      discoveredTools: [],
      lastCheckAt: undefined,
      error: undefined,
      reuseVerified: false,
    };
    this.records.set(id, replacement);
    await this.save(replacement);
    return this.getPublic(id);
  }
  async updatePolicy(
    id: string,
    tools: Record<string, ToolPolicy>,
    instructionsApproved?: boolean,
    resourceBindings?: Record<string, string>,
  ): Promise<ConnectionRecord> {
    const record = this.get(id);
    const definition = validateDefinition({
      ...this.definition(record),
      tools,
      resourceBindings: resourceBindings ?? record.resourceBindings,
      instructionsApproved: instructionsApproved ?? record.instructionsApproved,
    });
    for (const [name, policy] of Object.entries(definition.tools))
      this.assertPolicy(record, name, policy);
    record.tools = definition.tools;
    record.instructionsApproved = definition.instructionsApproved;
    record.resourceBindings = definition.resourceBindings;
    await this.save(record);
    return this.getPublic(id);
  }
  private client(id: string): McpConnection {
    let client = this.clients.get(id);
    if (!client) {
      const record = this.get(id);
      this.assertCredentialBinding(record);
      client = (
        this.options.mcpFactory ?? ((d, c, e) => new McpConnection(d, c, e))
      )(this.definition(record), this.options.callbackUrl, this.env);
      this.clients.set(id, client);
    }
    return client;
  }
  async connect(
    id: string,
    browserSessionId?: string,
  ): Promise<ConnectionRecord> {
    const record = this.get(id);
    try {
      let tools: DiscoveredTool[],
        account: {
          id: string;
          label: string;
          workspace?: string;
          verified?: boolean;
        };
      this.assertCredentialBinding(record);
      if (record.route === "mcp") {
        const client = this.client(id);
        if (browserSessionId) client.auth.begin(browserSessionId);
        tools = await client.connect();
        account = await client.identity();
        record.runtimeVersion = client.runtimeVersion;
      } else {
        await this.bridge.start();
        account = { ...(await this.bridge.account()), verified: true };
        const servers = await this.bridge.discover(record.codexServer);
        const server = servers.find((x) => x.name === record.codexServer);
        if (!server)
          throw new ConnectionError(
            "codex-server",
            "The selected MCP server is unavailable in this Codex account.",
          );
        const values = Array.isArray(server.tools)
          ? server.tools
          : Object.values(server.tools ?? {});
        tools = values.map((t: any) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          schemaHash: hash(t.inputSchema),
          effect: t.annotations?.readOnlyHint === true ? "read" : "write",
        }));
        record.runtimeVersion = this.bridge.version;
        record.workspace = account.workspace;
      }
      if (record.expectedAccountId && account.id !== record.expectedAccountId)
        throw new ConnectionError(
          "account",
          "The signed-in account differs from the selected account. Sign in with the expected account.",
        );
      if (record.accountId && account.id !== record.accountId) {
        record.tools = {};
        throw new ConnectionError(
          "account-changed",
          "The account changed. Review its tool and resource permissions before another run.",
        );
      }
      record.accountId = account.id;
      record.accountLabel = account.label;
      record.accountVerified = account.verified === true;
      record.discoveredTools = tools;
      for (const [name, policy] of Object.entries(record.tools))
        this.assertPolicy(record, name, policy);
      record.status = "ready";
      record.error = undefined;
      record.authorizationUrl = undefined;
      record.lastCheckAt = new Date().toISOString();
    } catch (error) {
      const url = this.clients.get(id)?.auth.authorizationUrl;
      record.status = url
        ? "sign-in-needed"
        : error instanceof ConnectionError &&
            /oauth-client|oauth-secret|oauth-issuer|credential-binding/.test(
              error.code,
            )
          ? "needs-configuration"
          : "unavailable";
      record.error = safeError(error);
      record.authorizationUrl = url;
    }
    await this.save(record);
    return this.getPublic(id);
  }
  async beginOAuth(
    id: string,
    browserSessionId: string,
  ): Promise<{ connection: ConnectionRecord; authorizationUrl?: string }> {
    const record = this.get(id);
    if (record.route === "codex")
      return { connection: this.getPublic(id), ...(await this.bridge.login()) };
    await this.connect(id, browserSessionId);
    return {
      connection: this.getPublic(id),
      ...(record.authorizationUrl
        ? { authorizationUrl: record.authorizationUrl }
        : {}),
    };
  }
  async finishOAuth(
    state: string,
    code: string,
    browserSessionId: string,
  ): Promise<ConnectionRecord> {
    if (!code || code.length > 8192 || !state || state.length > 256)
      throw new ConnectionError(
        "oauth-callback",
        "The sign-in response is invalid.",
      );
    const entry = [...this.clients.entries()].find(([, client]) =>
      client.auth.matchesState(state),
    );
    if (!entry)
      throw new ConnectionError(
        "oauth-state",
        "This sign-in response does not belong to an active Sona sign-in.",
      );
    const [id, client] = entry;
    client.auth.consume(state, browserSessionId);
    try {
      await client.finishAuth(code);
    } catch {
      this.get(id).status = "sign-in-needed";
      throw new ConnectionError(
        "oauth-exchange",
        "The authorization code could not be exchanged. Start sign-in again.",
      );
    }
    return this.connect(id);
  }
  async probeCodex(): Promise<{
    available: boolean;
    version?: string;
    account?: { id: string; label: string; workspace?: string };
    servers?: unknown[];
    reason?: string;
    reuseVerified: false;
  }> {
    try {
      await this.bridge.start();
      const account = await this.bridge.account();
      const servers = await this.bridge.discover();
      return {
        available: true,
        version: this.bridge.version,
        account,
        servers: servers.map((s) => ({
          name: s.name,
          authStatus: s.authStatus,
          toolCount: Array.isArray(s.tools)
            ? s.tools.length
            : Object.keys(s.tools ?? {}).length,
        })),
        reuseVerified: false,
      };
    } catch (error) {
      return {
        available: false,
        version: this.bridge.version,
        reason: safeError(error),
        reuseVerified: false,
      };
    }
  }
  private assertPolicy(
    record: ConnectionRecord,
    name: string,
    policy: ToolPolicy,
  ): DiscoveredTool {
    const tool = record.discoveredTools.find((x) => x.name === name);
    if (!tool || tool.schemaHash !== policy.schemaHash)
      throw new ConnectionError(
        "tool-schema",
        "A selected tool is missing or its schema changed. Review the current tool schema.",
      );
    if (tool.effect === "write" && policy.effect === "read")
      throw new ConnectionError(
        "tool-effect",
        "An unverified or write tool cannot use a read-only policy.",
      );
    if (
      policy.effect === "write" &&
      (!policy.resourcePointer || !policy.resources?.length)
    )
      throw new ConnectionError(
        "tool-resource",
        "A write needs a field and an exact permitted resource.",
      );
    if (
      policy.resourcePointer &&
      !this.schemaPointer(tool.inputSchema, policy.resourcePointer)
    )
      throw new ConnectionError(
        "tool-resource",
        "The selected resource field is absent from the discovered schema.",
      );
    if (
      policy.idempotencyPointer &&
      !this.schemaPointer(tool.inputSchema, policy.idempotencyPointer)
    )
      throw new ConnectionError(
        "tool-idempotency",
        "The selected idempotency field is absent from the discovered schema.",
      );
    return tool;
  }
  private schemaPointer(
    schema: Record<string, unknown>,
    pointer: string,
  ): boolean {
    const keys = pointer
      .slice(1)
      .split("/")
      .map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~"));
    const visit = (node: any, index: number, depth: number): boolean => {
      if (!node || depth > 40) return false;
      if (node.$ref?.startsWith("#/"))
        return visit(getPointer(schema, node.$ref.slice(1)), index, depth + 1);
      if (index === keys.length) return true;
      if (node.properties?.[keys[index]!])
        return visit(node.properties[keys[index]!], index + 1, depth + 1);
      return ["allOf", "oneOf", "anyOf"].some((k) =>
        node[k]?.some((part: any) => visit(part, index, depth + 1)),
      );
    };
    return visit(schema, 0, 0);
  }
  private validateInput(
    schema: Record<string, unknown>,
    args: Record<string, unknown>,
  ): void {
    const Validator = String(schema.$schema ?? "").includes("2020-12")
      ? Ajv2020
      : Ajv;
    const ajv = new Validator({
      strict: false,
      allErrors: true,
      validateFormats: true,
    });
    addFormats(ajv);
    try {
      const validate = ajv.compile(schema);
      if (!validate(args))
        throw new ConnectionError(
          "tool-arguments",
          "Tool arguments do not match the discovered schema.",
        );
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError(
        "tool-schema",
        "This tool schema cannot be validated. The tool is blocked.",
      );
    }
  }
  private scrub<T>(value: T): T {
    const secrets: string[] = [];
    for (const record of this.records.values())
      for (const name of [record.tokenEnv, record.oauth?.clientSecretEnv]) {
        const secret = name ? this.env[name] : undefined;
        if (secret) secrets.push(secret);
      }
    for (const client of this.clients.values()) {
      const tokens = client.auth.tokens();
      for (const secret of [tokens?.access_token, tokens?.refresh_token])
        if (secret) secrets.push(secret);
    }
    return redactSecrets(value, secrets);
  }
  private async audit(event: ConnectionAudit): Promise<void> {
    await this.options.audit?.(this.scrub(redact(event)) as ConnectionAudit);
  }
  private operationKey(policy: ToolPolicy, operationId: string) {
    return policy.idempotencyEncoding === "sha256"
      ? hash(operationId)
      : operationId;
  }
  prepareInvocation(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
    logicalResource?: string,
    operationId?: string,
  ) {
    const record = this.get(id),
      policy = record.tools[toolName];
    if (!policy)
      throw new ConnectionError("allowlist", "This tool is not selected.");
    const resolved = logicalResource
      ? record.resourceBindings?.[logicalResource]
      : undefined;
    if (logicalResource && !resolved)
      throw new ConnectionError(
        "resource-binding",
        "Bind this logical resource in the local connection definition.",
      );
    const next = structuredClone(args);
    if (resolved) {
      if (!policy.resourcePointer || !policy.resources?.includes(resolved))
        throw new ConnectionError(
          "resource-binding",
          "The logical resource is outside the selected policy.",
        );
      const actual = getPointer(next, policy.resourcePointer);
      if (
        actual !== undefined &&
        actual !== logicalResource &&
        actual !== resolved
      )
        throw new ConnectionError(
          "resource-binding",
          "The proposed destination differs from the local resource binding.",
        );
      setPointer(next, policy.resourcePointer, resolved);
    }
    if (policy.idempotencyPointer) {
      if (!operationId)
        throw new ConnectionError(
          "idempotency",
          "A stable operation identifier is necessary before proposal.",
        );
      const key = this.operationKey(policy, operationId),
        prior = getPointer(next, policy.idempotencyPointer);
      if (prior !== undefined && prior !== key)
        throw new ConnectionError(
          "idempotency",
          "The proposal contains a different idempotency value.",
        );
      setPointer(next, policy.idempotencyPointer, key);
    }
    return {
      arguments: next,
      resource: policy.resourcePointer
        ? String(getPointer(next, policy.resourcePointer))
        : undefined,
    };
  }
  bindingSnapshot(id: string) {
    const record = this.get(id),
      definition = this.definition(record);
    return {
      id,
      bindingHash: hash({
        definition,
        accountId: record.accountId,
        runtimeVersion: record.runtimeVersion,
      }),
      accountReference: record.accountId
        ? "account:" + hash(record.accountId).slice(0, 12)
        : undefined,
      route: record.route,
      endpoint: record.endpoint,
      source: record.source,
      sourceVersion: record.sourceVersion,
      sourceHash: record.sourceHash,
      runtimeVersion: record.runtimeVersion,
      scopes: record.oauth?.scopes ?? [],
      resourceBindingsHash: hash(record.resourceBindings ?? {}),
      toolSchemas: Object.entries(record.tools).map(([name, p]) => ({
        name,
        schemaHash: p.schemaHash,
        effect: p.effect,
      })),
    };
  }
  assertBinding(snapshot: { id: string; bindingHash: string }) {
    if (this.bindingSnapshot(snapshot.id).bindingHash !== snapshot.bindingHash)
      throw new ConnectionError(
        "binding-changed",
        "The account, connection, or selected tool policy changed after the snapshot. End this test and start a new test.",
      );
  }
  createAdapter(id: string): ConnectionAdapter {
    const record = this.get(id);
    if (record.status !== "ready" || !record.accountId)
      throw new ConnectionError(
        "not-ready",
        "Verify the connection before the run.",
      );
    const accountId = record.accountId;
    return {
      id,
      accountId,
      discover: async () =>
        Object.entries(this.get(id).tools).map(([name, policy]) =>
          this.assertPolicy(this.get(id), name, policy),
        ),
      invoke: (request) => this.invoke(id, accountId, request),
      reconcile: (request) => this.reconcile(id, accountId, request),
    };
  }
  private async invoke(
    id: string,
    accountId: string,
    request: ToolInvocation,
  ): Promise<ToolResult> {
    const record = this.get(id),
      policy = record.tools[request.toolName];
    try {
      if (
        record.status !== "ready" ||
        record.accountId !== accountId ||
        request.accountId !== accountId
      )
        throw new ConnectionError(
          "account",
          "The account binding changed or is not ready. Reconnect before the run.",
        );
      if (!policy)
        throw new ConnectionError(
          "allowlist",
          "This tool is not selected for this connection.",
        );
      this.assertCredentialBinding(record);
      const tool = this.assertPolicy(record, request.toolName, policy);
      if (!request.operationId)
        throw new ConnectionError(
          "operation",
          "A journal operation identifier is necessary.",
        );
      const args = structuredClone(request.arguments);
      if (policy.resourcePointer) {
        const resource = getPointer(args, policy.resourcePointer);
        if (
          typeof resource !== "string" ||
          !policy.resources?.includes(resource) ||
          (request.resource && request.resource !== resource)
        )
          throw new ConnectionError(
            "resource",
            "The tool targets a resource outside this connection's selected resources.",
          );
      }
      if (record.endpoint?.includes("calendarmcp.googleapis.com"))
        this.assertCalendar(args, policy);
      for (const pointer of policy.forbiddenPointers ?? []) {
        const value = getPointer(args, pointer);
        if (
          value !== undefined &&
          value !== null &&
          value !== false &&
          value !== "" &&
          !(Array.isArray(value) && !value.length)
        )
          throw new ConnectionError(
            "forbidden-field",
            "The tool contains a field that its connection policy forbids.",
          );
      }
      if (policy.idempotencyPointer) {
        const prior = getPointer(args, policy.idempotencyPointer);
        if (prior !== this.operationKey(policy, request.operationId))
          throw new ConnectionError(
            "idempotency",
            "The tool idempotency value differs from its journal operation.",
          );
      }
      this.validateInput(tool.inputSchema, args);
      const current =
        record.route === "mcp"
          ? await this.client(id).identity()
          : { ...(await this.bridge.account()), verified: true };
      if (current.id !== accountId)
        throw new ConnectionError(
          "account",
          "The service account changed. Dispatch is blocked.",
        );
      if (policy.effect === "write" && !record.accountVerified)
        throw new ConnectionError(
          "identity",
          "A write needs a verified service account identity. Add an identity endpoint or use an official account-aware bridge.",
        );
      request.signal?.throwIfAborted();
      const writeKey = `${id}:${accountId}:${request.operationId}`;
      if (policy.effect === "write" && this.writes.has(writeKey))
        throw new ConnectionError(
          "duplicate",
          "This write was already dispatched. Reconcile its outcome before another action.",
        );
      const attempts = policy.effect === "read" ? record.readRetries + 1 : 1;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const started = performance.now(),
          startedAt = new Date().toISOString();
        await this.audit({
          type: "tool-dispatch",
          connectionId: id,
          operationId: request.operationId,
          toolName: request.toolName,
          attempt,
          startedAt,
          result: { arguments: args, accountId, route: record.route },
        });
        if (policy.effect === "write") this.writes.add(writeKey);
        try {
          const raw =
            record.route === "mcp"
              ? await this.client(id).invoke(
                  request.toolName,
                  args,
                  request.signal,
                )
              : await this.bridge.invoke(
                  record.codexServer!,
                  request.toolName,
                  args,
                  record.timeoutMs,
                );
          if ((raw as any)?.isError)
            throw new ConnectionError(
              "tool-failure",
              "The external tool returned a failure.",
            );
          await this.audit({
            type: "tool-result",
            connectionId: id,
            operationId: request.operationId,
            toolName: request.toolName,
            attempt,
            startedAt,
            durationMs: performance.now() - started,
            result: raw,
          });
          const externalId = policy.externalIdPointer
            ? getPointer(raw, policy.externalIdPointer)
            : undefined;
          return {
            data: this.scrub(raw),
            ...(typeof externalId === "string" ? { externalId } : {}),
          };
        } catch (error) {
          await this.audit({
            type: "tool-error",
            connectionId: id,
            operationId: request.operationId,
            toolName: request.toolName,
            attempt,
            startedAt,
            durationMs: performance.now() - started,
            error: safeError(error),
          });
          if (attempt === attempts || request.signal?.aborted)
            throw new ToolExecutionError(safeError(error), false);
        }
      }
      throw new ToolExecutionError(
        "The external tool returned no result.",
        false,
      );
    } catch (error) {
      if (error instanceof ToolExecutionError) throw error;
      throw new ToolExecutionError(safeError(error), true);
    }
  }
  private assertCalendar(
    args: Record<string, unknown>,
    policy: ToolPolicy,
  ): void {
    if (
      !policy.resourcePointer ||
      !policy.resources?.length ||
      policy.resources.some((x) => x === "primary")
    )
      throw new ConnectionError(
        "calendar-resource",
        "Select a dedicated calendar by its exact identifier. Primary calendars are not permitted by this test connection.",
      );
    const walk = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const [key, v] of Object.entries(value)) {
        const name = key.replace(/[_-]/g, "").toLowerCase();
        if (
          name === "attendees" &&
          v !== undefined &&
          (!Array.isArray(v) || v.length)
        )
          throw new ConnectionError(
            "calendar-attendees",
            "Attendees and invitations are disabled for this Calendar connection.",
          );
        if (
          (name === "sendnotifications" && v !== false) ||
          (name === "sendupdates" && v !== "none")
        )
          throw new ConnectionError(
            "calendar-invitations",
            "Calendar invitations must be disabled.",
          );
        if (
          ["calendarid", "destinationcalendarid"].includes(name) &&
          (typeof v !== "string" || !policy.resources!.includes(v))
        )
          throw new ConnectionError(
            "calendar-resource",
            "The calendar argument is outside the selected test resources.",
          );
        walk(v);
      }
    };
    walk(args);
  }
  private async reconcile(
    id: string,
    accountId: string,
    request: ReconcileRequest,
  ): Promise<ReconcileResult> {
    const record = this.get(id),
      policy = record.tools[request.toolName],
      route = policy?.reconciliation;
    if (request.accountId !== accountId || record.accountId !== accountId)
      throw new ToolExecutionError(
        "Reconciliation account differs from the dispatched action.",
        true,
      );
    if (!route) return { status: "unknown" };
    const read = record.tools[route.toolName];
    if (!read || read.effect !== "read") return { status: "unknown" };
    const args = structuredClone(route.arguments);
    const expected =
      request.externalId ?? this.operationKey(policy!, request.operationId);
    if (route.operationIdPointer)
      setPointer(
        args,
        route.operationIdPointer,
        this.operationKey(policy!, request.operationId),
      );
    if (route.externalIdPointer) {
      if (!request.externalId && !policy?.idempotencyPointer)
        return { status: "unknown" };
      setPointer(args, route.externalIdPointer, expected);
    }
    try {
      const result = await this.invoke(id, accountId, {
        toolName: route.toolName,
        arguments: args,
        operationId: `reconcile-${request.operationId}`,
        accountId,
        resource: request.resource,
      });
      const actual = getPointer(result.data, route.resultIdPointer);
      return actual === expected
        ? { status: "succeeded", data: result.data, externalId: expected }
        : { status: "unknown" };
    } catch {
      return { status: "unknown" };
    }
  }
  async disconnect(id: string): Promise<void> {
    const record = this.get(id);
    await this.clients.get(id)?.close();
    this.clients.delete(id);
    record.status = "sign-in-needed";
    record.accountVerified = false;
    record.authorizationUrl = undefined;
    await this.save(record);
  }
  async remove(id: string): Promise<void> {
    await this.disconnect(id);
    await this.options.persistence?.remove?.(id);
    this.records.delete(id);
  }
  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((x) => x.close()));
    this.clients.clear();
    await this.bridge.close();
  }
}

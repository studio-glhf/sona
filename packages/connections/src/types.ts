import type { DiscoveredTool } from "@sona/agent-core";

export type ConnectionStatus =
  | "needs-configuration"
  | "sign-in-needed"
  | "needs-verification"
  | "ready"
  | "expired"
  | "unavailable"
  | "unsupported";
export interface ToolPolicy {
  effect: "read" | "write";
  schemaHash: string;
  /** JSON pointer to the resource argument in the discovered input schema. */
  resourcePointer?: string;
  /** Only these exact resources are permitted. A write always needs a resource binding. */
  resources?: string[];
  /** Exact fields that can contain an attendee list, or send invitations. */
  forbiddenPointers?: string[];
  /** An input supported by the discovered schema. No undocumented fields are inserted. */
  idempotencyPointer?: string;
  idempotencyEncoding?: "operation-id" | "sha256";
  externalIdPointer?: string;
  reconciliation?: {
    toolName: string;
    operationIdPointer?: string;
    externalIdPointer?: string;
    arguments: Record<string, unknown>;
    resultIdPointer: string;
  };
}
export interface ConnectionDefinition {
  id: string;
  name: string;
  route: "mcp" | "codex";
  endpoint?: string;
  source: string;
  sourceVersion?: string;
  sourceHash: string;
  instructions?: string;
  instructionsApproved: boolean;
  codexServer?: string;
  oauth?: {
    clientIdEnv?: string;
    clientSecretEnv?: string;
    issuer?: string;
    scopes: string[];
    allowedOrigins: string[];
    identity?: { url: string; subjectField: string; labelField?: string };
  };
  tokenEnv?: string;
  /** API tokens need an explicit local account binding. OAuth identity is derived from its issuer. */
  accountLabel?: string;
  expectedAccountId?: string;
  tools: Record<string, ToolPolicy>;
  resourceBindings?: Record<string, string>;
  timeoutMs: number;
  readRetries: number;
}
export interface ConnectionRecord extends ConnectionDefinition {
  /** Server-owned review metadata; never accepted from imported definitions. */
  reviewVersion?: 1;
  credentialBindingHash?: string;
  status: ConnectionStatus;
  accountId?: string;
  accountVerified: boolean;
  workspace?: string;
  runtimeVersion?: string;
  discoveredTools: DiscoveredTool[];
  lastCheckAt?: string;
  error?: string;
  authorizationUrl?: string;
  reuseVerified: boolean;
}
export interface ConnectionAudit {
  type: string;
  connectionId: string;
  operationId?: string;
  toolName?: string;
  attempt?: number;
  startedAt: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
}
export interface ConnectionPersistence {
  save(record: ConnectionRecord): void | Promise<void>;
  remove?(id: string): void | Promise<void>;
}

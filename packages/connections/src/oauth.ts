import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { ConnectionDefinition } from "./types.js";
import { ConnectionError, hash } from "./security.js";

/** Tokens, PKCE verifiers, client secrets, and OAuth state never leave this server object. */
export class MemoryOAuthProvider implements OAuthClientProvider {
  private tokenValue?: OAuthTokens;
  private registered?: OAuthClientInformationMixed;
  private verifier?: string;
  private pending?: {
    state: string;
    sessionHash: string;
    expiresAt: number;
    consumed: boolean;
  };
  private discovery?: OAuthDiscoveryState;
  authorizationUrl?: string;
  readonly redirectUrl: URL;
  readonly clientMetadata: OAuthClientMetadata;
  constructor(
    readonly definition: ConnectionDefinition,
    callbackUrl: string,
    private env: NodeJS.ProcessEnv = process.env,
    private now: () => number = Date.now,
  ) {
    const url = new URL(callbackUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["/api/oauth/callback", "/api/connections/oauth/callback"].includes(
        url.pathname,
      )
    )
      throw new ConnectionError(
        "oauth-callback",
        "Use the Sona loopback OAuth callback.",
      );
    this.redirectUrl = url;
    this.clientMetadata = {
      client_name: "Sona local",
      redirect_uris: [url.href],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: definition.oauth?.clientSecretEnv
        ? "client_secret_post"
        : "none",
      scope: definition.oauth?.scopes.join(" "),
    };
  }
  begin(sessionId: string): void {
    if (!sessionId)
      throw new ConnectionError(
        "oauth-session",
        "A local browser session is necessary for sign-in.",
      );
    this.pending = {
      state: randomBytes(32).toString("base64url"),
      sessionHash: hash(sessionId),
      expiresAt: this.now() + 10 * 60_000,
      consumed: false,
    };
    this.authorizationUrl = undefined;
    this.verifier = undefined;
  }
  state(): string {
    if (
      !this.pending ||
      this.pending.consumed ||
      this.pending.expiresAt < this.now()
    )
      throw new ConnectionError(
        "oauth-state",
        "Start sign-in from this Sona window.",
      );
    return this.pending.state;
  }
  matchesState(state: string): boolean {
    return !!this.pending && this.pending.state === state;
  }
  consume(state: string, sessionId: string): void {
    const p = this.pending;
    if (
      !p ||
      p.consumed ||
      p.expiresAt < this.now() ||
      p.sessionHash !== hash(sessionId) ||
      state.length !== p.state.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(p.state))
    )
      throw new ConnectionError(
        "oauth-state",
        "The sign-in response is expired or belongs to another browser session. Start sign-in again.",
      );
    p.consumed = true;
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.registered) return this.registered;
    const config = this.definition.oauth;
    if (!config?.clientIdEnv) return undefined;
    const id = this.env[config.clientIdEnv];
    if (!id)
      throw new ConnectionError(
        "oauth-client",
        `Set the server environment variable ${config.clientIdEnv}, then restart Sona.`,
      );
    if (!config.issuer)
      throw new ConnectionError(
        "oauth-issuer",
        "A registered OAuth client needs its exact authorization issuer.",
      );
    const secret = config.clientSecretEnv
      ? this.env[config.clientSecretEnv]
      : undefined;
    if (config.clientSecretEnv && !secret)
      throw new ConnectionError(
        "oauth-secret",
        `Set the server environment variable ${config.clientSecretEnv}, then restart Sona.`,
      );
    return {
      client_id: id,
      ...(secret ? { client_secret: secret } : {}),
      issuer: config.issuer,
    };
  }
  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.registered = info;
  }
  tokens(): OAuthTokens | undefined {
    if (this.tokenValue) return this.tokenValue;
    if (this.definition.tokenEnv && this.env[this.definition.tokenEnv])
      return {
        access_token: this.env[this.definition.tokenEnv]!,
        token_type: "Bearer",
      };
    return undefined;
  }
  saveTokens(tokens: OAuthTokens): void {
    this.tokenValue = tokens;
    this.authorizationUrl = undefined;
  }
  redirectToAuthorization(url: URL): void {
    const allowed = new Set(this.definition.oauth?.allowedOrigins ?? []);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !allowed.has(url.origin)
    )
      throw new ConnectionError(
        "oauth-origin",
        "The authorization URL is outside the connection's approved origins.",
      );
    if (url.searchParams.get("state") !== this.state())
      throw new ConnectionError(
        "oauth-state",
        "The authorization URL does not contain the expected state.",
      );
    if (url.searchParams.get("code_challenge_method") !== "S256")
      throw new ConnectionError(
        "oauth-pkce",
        "The authorization server must support PKCE S256.",
      );
    this.authorizationUrl = url.href;
  }
  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }
  codeVerifier(): string {
    if (!this.verifier)
      throw new ConnectionError(
        "oauth-pkce",
        "The sign-in verifier is missing. Start sign-in again.",
      );
    return this.verifier;
  }
  async validateResourceURL(
    serverUrl: string | URL,
    resource?: string,
  ): Promise<URL> {
    const expected = new URL(this.definition.endpoint!);
    const candidate = resource ? new URL(resource) : new URL(serverUrl);
    if (
      candidate.origin !== expected.origin ||
      (!expected.pathname.startsWith(
        candidate.pathname.replace(/\/$/, "") + "/",
      ) &&
        candidate.pathname.replace(/\/$/, "") !==
          expected.pathname.replace(/\/$/, "")) ||
      candidate.search ||
      candidate.hash
    )
      throw new ConnectionError(
        "oauth-audience",
        "The OAuth resource does not match this MCP endpoint.",
      );
    return candidate;
  }
  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void {
    if (scope === "all" || scope === "tokens") this.tokenValue = undefined;
    if (scope === "all" || scope === "client") this.registered = undefined;
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
    if (scope === "all" || scope === "discovery") this.discovery = undefined;
    if (scope === "all") {
      this.pending = undefined;
      this.authorizationUrl = undefined;
    }
  }
  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discovery = state;
  }
  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
  }
}

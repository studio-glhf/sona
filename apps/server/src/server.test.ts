import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./storage/index.js";
import { createApp } from "./app.js";
import { defaultAgentConfig } from "../../../packages/agent-core/src/index.js";
import {
  McpConnection,
  googleCalendarDefinition,
} from "../../../packages/connections/src/index.js";
import * as library from "../../../packages/api-library/src/index.js";
const pending: { app: any; dir: string }[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const resources = pending.splice(0);
  for (const { app } of resources) await app.close();
  for (const dir of new Set(resources.map(({ dir }) => dir)))
    rmSync(dir, { recursive: true, force: true });
});
async function setup(key = "") {
  const dir = mkdtempSync(join(tmpdir(), "sona-http-"));
  if (key) {
    const initial = createStore(dir);
    initial.metadata.set("verifiedModels", ["gpt-realtime-2.1"]);
    initial.close();
  }
  const result = await createApp({
    dataDir: dir,
    port: 4317,
    env: { OPENAI_API_KEY: key },
  });
  pending.push({ app: result.app, dir });
  const boot = await result.app.inject({
    url: "/api/bootstrap",
    headers: { host: "127.0.0.1:4317" },
  });
  const headers = {
    host: "127.0.0.1:4317",
    "x-sona-token": boot.json().csrfToken,
    cookie: boot.headers["set-cookie"]!.toString().split(";")[0],
  };
  return {
    ...result,
    dir,
    headers,
    request: (method: any, url: string, payload?: any) =>
      result.app.inject({ method, url, headers, payload }),
  };
}
describe("local server integration", { timeout: 20000 }, () => {
  it("uses only the selected local development browser origin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sona-dev-origin-"));
    const { app } = await createApp({
      dataDir: dir,
      port: 4327,
      development: true,
      env: { SONA_WEB_PORT: "5174" },
    });
    pending.push({ app, dir });
    expect(
      (
        await app.inject({
          url: "/api/bootstrap",
          headers: { host: "127.0.0.1:4327", origin: "http://127.0.0.1:5174" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/bootstrap",
          headers: { host: "127.0.0.1:4327", origin: "http://127.0.0.1:5173" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("returns a cancellable separate API observation with honest missing credentials and local-session ownership", async () => {
    const { app, request } = await setup();
    const started = await request("POST", "/api/library/poll", {
      recipe: { operationId: "listModels" },
      maxPolls: 1,
    });
    expect(started.statusCode).toBe(200);
    const run = started.json();
    expect(run.id).toBeTruthy();
    const result = (await request("GET", `/api/library/runs/${run.id}`)).json();
    expect(result.status).toBe("failed");
    expect(result.error).toContain("credential");
    const second = await app.inject({
      url: "/api/bootstrap",
      headers: { host: "127.0.0.1:4317" },
    });
    const foreign = await app.inject({
      url: `/api/library/runs/${run.id}`,
      headers: {
        host: "127.0.0.1:4317",
        "x-sona-token": second.json().csrfToken,
        cookie: second.headers["set-cookie"]!.toString().split(";")[0],
      },
    });
    expect(foreign.statusCode).toBe(400);
  });
  it("rejects wrong Host, cross origin, missing local session, forged OAuth callback, and preserves health", async () => {
    const { app, request } = await setup();
    expect(
      (
        await app.inject({
          url: "/api/health",
          headers: { host: "evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/bootstrap",
          headers: { host: "127.0.0.1:4317", origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: "/api/agents",
          headers: { host: "127.0.0.1:4317" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await request("GET", "/api/oauth/callback?state=forged&code=forged"))
        .statusCode,
    ).toBe(400);
    expect((await request("GET", "/api/health")).statusCode).toBe(200);
  });
  it("rejects external credential selectors on both import routes", async () => {
    const { request } = await setup("sk-proj-synthetic_server_security_key");
    const definition = {
      ...googleCalendarDefinition(),
      id: "untrusted",
      endpoint: "https://attacker.example/mcp",
      tokenEnv: "OPENAI_API_KEY",
      oauth: undefined,
    };
    for (const [path, input] of [
      ["/api/connections", definition],
      ["/api/connections/import", { manifest: definition }],
    ] as const) {
      const result = await request("POST", path, input);
      expect(result.statusCode).toBe(400);
      expect(result.json().error).toContain("cannot choose server credentials");
    }
  });
  it("uses the shipped callback with a real MCP client and binds OAuth completion to its browser session", async () => {
    vi.spyOn(McpConnection.prototype, "connect").mockResolvedValue([]);
    vi.spyOn(McpConnection.prototype, "identity").mockResolvedValue({
      id: "fixture-account",
      label: "Synthetic account",
      verified: true,
    });
    const finish = vi
      .spyOn(McpConnection.prototype, "finishAuth")
      .mockResolvedValue();
    const { connections, request, app, headers } = await setup();
    expect(
      (await request("POST", "/api/connections/google-calendar", {}))
        .statusCode,
    ).toBe(200);
    const discovered = await request(
      "POST",
      "/api/connections/google-calendar/discover",
      {},
    );
    expect(discovered.json()).toMatchObject({ status: "ready" });
    const client = (connections as any).clients.get(
      "google-calendar",
    ) as McpConnection;
    expect(client.auth.redirectUrl.pathname).toBe("/api/oauth/callback");
    const state = client.auth.state();
    const path = `/api/oauth/callback?state=${state}&code=synthetic-code`;
    const foreign = await app.inject({
      url: path,
      headers: {
        host: headers.host,
        cookie: "sona=foreign",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(foreign.statusCode).toBe(400);
    expect(finish).not.toHaveBeenCalled();
    const complete = await app.inject({
      url: path,
      headers: {
        host: headers.host,
        cookie: headers.cookie,
        "sec-fetch-site": "cross-site",
      },
    });
    expect(complete.statusCode).toBe(200);
    expect(finish).toHaveBeenCalledWith("synthetic-code");
    expect((await request("GET", path)).statusCode).toBe(400);
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it("creates two agents, saves drafts, freezes revisions, exports portable config, rejects invalid fields", async () => {
    const { request } = await setup();
    const a = (await request("POST", "/api/agents", { name: "First" })).json();
    expect(a.id).toBeTruthy();
    const r = (
      await request("POST", `/api/agents/${a.id}/revisions`, {
        name: "Baseline",
      })
    ).json();
    const draft = { ...a.draft, instructions: "Changed next-test draft" };
    expect(
      (await request("PATCH", `/api/agents/${a.id}`, { draft })).statusCode,
    ).toBe(200);
    expect(
      (await request("GET", `/api/agents/${a.id}/revisions`)).json()[0]
        .configuration.instructions,
    ).toBe(r.configuration.instructions);
    expect(
      (await request("POST", `/api/agents/${a.id}/duplicate`, {})).json().id,
    ).not.toBe(a.id);
    const exported = (
      await request("GET", `/api/agents/${a.id}/export`)
    ).json();
    expect(exported.instructions).toBe(draft.instructions);
    expect(exported.participantCode).toBeUndefined();
    expect(
      (
        await request("POST", "/api/config/validate", {
          config: { ...draft, settings: { temperature: 0.7 } },
        })
      ).json().valid,
    ).toBe(false);
  });
  it("blocks voice without credentials and does not create false sessions", async () => {
    const { request, store } = await setup();
    const a = (await request("POST", "/api/agents", { name: "No key" })).json();
    const result = await request("POST", "/api/sessions", {
      agentId: a.id,
      processingAccepted: true,
    });
    expect(result.statusCode).toBe(400);
    expect(result.json().error).toMatch("API key in Settings");
    expect(store.sessions.list()).toHaveLength(0);
  });
  it("sets a GUI key for this server run without echo, preserves drafts, and does not persist it", async () => {
    const { request, app, store, voice, dir } = await setup();
    const key = "sk-proj-synthetic_GUI_credential_canary";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const saved = await request("PUT", "/api/settings/credentials/openai", {
      apiKey: key,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers["cache-control"]).toBe("no-store");
    expect(saved.json()).toEqual({
      openai: {
        configured: true,
        source: "session",
        storage: "memory",
        verification: { state: "unchecked", checkedAt: null, reason: null },
      },
    });
    expect(saved.body).not.toContain(key);
    expect(voice.configured).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    const boot = (await request("GET", "/api/bootstrap")).json();
    expect(boot.readiness.openaiConfigured).toBe(true);
    expect(boot.readiness.modelsVerified).toEqual([]);
    const agent = (
      await request("POST", "/api/agents", { name: "GUI fixture" })
    ).json();
    const draft = { ...agent.draft, instructions: `Accidental paste: ${key}` };
    await request("PATCH", `/api/agents/${agent.id}`, { draft });
    const exported = await request("GET", `/api/agents/${agent.id}/export`);
    expect(exported.body).not.toContain(key);
    expect(store.agents.get(agent.id).draft.instructions).toContain(
      "[REDACTED]",
    );
    await app.close();
    for (const file of readdirSync(dir))
      expect(
        readFileSync(join(dir, file)).includes(Buffer.from(key)),
        file,
      ).toBe(false);
    const restarted = await createApp({ dataDir: dir, port: 4317, env: {} });
    pending.push({ app: restarted.app, dir });
    expect(restarted.voice.configured).toBe(false);
    expect(restarted.store.agents.get(agent.id).name).toBe("GUI fixture");
  });
  it("checks the current GUI key without model execution, disclosure, or persisted access claims", async () => {
    const { request, app, store, dir } = await setup();
    const key = "sk-proj-synthetic_verify_HTTP_canary";
    const modelId = "model_identifier_private_fixture";
    const fetch = vi.fn(async (url, init) => {
      if (url === "data:,") return new Response("");
      expect(String(url)).toBe("https://api.openai.com/v1/models");
      expect(new Headers(init.headers).get("authorization")).toBe(
        `Bearer ${key}`,
      );
      return new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: modelId, object: "model", created: 0, owned_by: "fixture" },
          ],
        }),
        {
          headers: {
            "content-type": "application/json",
            "x-request-id": `private_${key}`,
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetch);
    await request("PUT", "/api/settings/credentials/openai", { apiKey: key });
    expect(fetch).not.toHaveBeenCalled();
    const verified = await request(
      "POST",
      "/api/settings/credentials/openai/verify",
    );
    expect(verified.statusCode).toBe(200);
    expect(verified.headers["cache-control"]).toBe("no-store");
    expect(verified.json().openai.verification).toEqual({
      state: "verified",
      checkedAt: expect.any(String),
      reason: null,
    });
    expect(verified.body).not.toContain(key);
    expect(verified.body).not.toContain(modelId);
    const boot = (await request("GET", "/api/bootstrap")).json();
    expect(boot.credentials).toEqual(verified.json());
    expect(boot.readiness.modelsVerified).toEqual([]);
    expect(store.metadata.get("verifiedModels")).toEqual([]);
    expect(store.metadata.list("verification")).toEqual([]);
    const removed = await request("DELETE", "/api/settings/credentials/openai");
    expect(removed.json().openai.verification.state).toBe("unchecked");
    await app.close();
    for (const file of readdirSync(dir)) {
      const content = readFileSync(join(dir, file));
      expect(content.includes(Buffer.from(key)), file).toBe(false);
      expect(content.includes(Buffer.from(modelId)), file).toBe(false);
    }
    const restarted = await createApp({ dataDir: dir, port: 4317, env: {} });
    pending.push({ app: restarted.app, dir });
    const status = await restarted.app.inject({
      url: "/api/bootstrap",
      headers: { host: "127.0.0.1:4317" },
    });
    expect(status.json().credentials.openai.verification).toEqual({
      state: "unchecked",
      checkedAt: null,
      reason: null,
    });
  });
  it("protects the key check route and rejects checks without a saved key", async () => {
    const { request, app, headers } = await setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/settings/credentials/openai/verify",
          headers: { host: headers.host },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/settings/credentials/openai/verify",
          headers: { ...headers, origin: "https://unrelated.example" },
        })
      ).statusCode,
    ).toBe(403);
    const missing = await request(
      "POST",
      "/api/settings/credentials/openai/verify",
      { apiKey: "sk-proj-synthetic_body_must_not_be_used" },
    );
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe("MISSING_PROJECT_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("coalesces simultaneous HTTP key checks and holds the key lease until completion", async () => {
    const { request } = await setup();
    let started!: () => void;
    const fetched = new Promise<void>((resolve) => {
      started = resolve;
    });
    let complete!: (response: Response) => void;
    const fetch = vi.fn((url) => {
      if (url === "data:,") return Promise.resolve(new Response(""));
      started();
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    });
    vi.stubGlobal("fetch", fetch);
    await request("PUT", "/api/settings/credentials/openai", {
      apiKey: "sk-proj-synthetic_coalesced_check",
    });
    const a = Promise.resolve(
      request("POST", "/api/settings/credentials/openai/verify"),
    );
    await fetched;
    expect(
      (await request("GET", "/api/settings/credentials")).json().openai
        .verification.state,
    ).toBe("checking");
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).json().code,
    ).toBe("CREDENTIAL_IN_USE");
    const b = Promise.resolve(
      request("POST", "/api/settings/credentials/openai/verify"),
    );
    complete(
      new Response(JSON.stringify({ object: "list", data: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const results = await Promise.all([a, b]);
    expect(
      results.map((result) => result.json().openai.verification.state),
    ).toEqual(["verified", "verified"]);
    expect(fetch.mock.calls.filter(([url]) => url !== "data:,")).toHaveLength(
      1,
    );
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).statusCode,
    ).toBe(200);
  });
  it("protects GUI key changes from untrusted browsers and blocks replacement until a quick test ends", async () => {
    const { app, request, headers } = await setup();
    const key = "sk-proj-synthetic_GUI_guard_canary";
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/settings/credentials/openai",
          headers: { host: headers.host },
          payload: { apiKey: key },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/settings/credentials/openai",
          headers: { ...headers, origin: "https://unrelated.example" },
          payload: { apiKey: key },
        })
      ).statusCode,
    ).toBe(403);
    const invalid = await request("PUT", "/api/settings/credentials/openai", {
      apiKey: "invalid",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("INVALID_PROJECT_API_KEY");
    await request("PUT", "/api/settings/credentials/openai", { apiKey: key });
    const a = (
      await request("POST", "/api/agents", { name: "No notice fixture" })
    ).json();
    const started = await request("POST", "/api/sessions", { agentId: a.id });
    expect(started.statusCode, started.body).toBe(200);
    const replacement = await request(
      "PUT",
      "/api/settings/credentials/openai",
      { apiKey: key },
    );
    expect(replacement.statusCode).toBe(409);
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).statusCode,
    ).toBe(409);
    await request("POST", `/api/sessions/${started.json().id}/end`, {});
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).json()
        .openai.configured,
    ).toBe(false);
    expect(
      (await request("GET", "/api/bootstrap")).json().readiness.missing,
    ).toEqual(["Add your OpenAI API key in Settings."]);
  });
  it("removes an environment key without falling back and redacts errors containing retired keys", async () => {
    const envKey = "synthetic_legacy_environment_canary";
    const { request, app } = await setup(envKey);
    const guiKey = "sk-proj-synthetic_session_canary";
    expect(
      (await request("GET", "/api/settings/credentials")).json().openai.source,
    ).toBe("environment");
    await request("PUT", "/api/settings/credentials/openai", {
      apiKey: guiKey,
    });
    await request("DELETE", "/api/settings/credentials/openai");
    expect(
      (await request("GET", "/api/settings/credentials")).json().openai.source,
    ).toBe("none");
    vi.spyOn(library, "executeRecipe").mockRejectedValueOnce(
      new Error(`Async failure ${envKey} ${guiKey}`),
    );
    const failed = await request("POST", "/api/library/execute", {
      operationId: "listModels",
    });
    expect(failed.body).not.toContain(envKey);
    expect(failed.body).not.toContain(guiKey);
    expect(failed.body).toContain("[REDACTED]");
    expect(app.log).toBeTruthy();
  });
  it("uses the current GUI key for direct API requests and locks edits while that request is active", async () => {
    const { request } = await setup();
    const key = "sk-proj-synthetic_direct_API_canary";
    await request("PUT", "/api/settings/credentials/openai", { apiKey: key });
    let complete!: (value: Response) => void, observed!: () => void;
    const began = new Promise<void>((resolve) => {
      observed = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        expect(init.headers.get("Authorization")).toBe(`Bearer ${key}`);
        observed();
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      }),
    );
    const running = request("POST", "/api/library/execute", {
      operationId: "listModels",
    });
    await began;
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).statusCode,
    ).toBe(409);
    complete(
      new Response(JSON.stringify({ data: [], note: key }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const finished = await running;
    expect(finished.statusCode, finished.body).toBe(200);
    expect(finished.body).not.toContain(key);
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).statusCode,
    ).toBe(200);
  });
  it("uses a GUI key in the real SDK voice request without an environment seed", async () => {
    const { request, voice } = await setup();
    const key = "sk-proj-synthetic_voice_GUI_canary";
    const fetch = vi.fn(async (_url, init) => {
      if (_url === "data:,") return new Response("");
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${key}`);
      // A deliberately invalid fixture answer prevents any sideband network connection.
      return new Response("invalid fixture SDP", {
        headers: { "content-type": "application/sdp" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    await request("PUT", "/api/settings/credentials/openai", { apiKey: key });
    const a = (
      await request("POST", "/api/agents", { name: "SDK request fixture" })
    ).json();
    const started = (
      await request("POST", "/api/sessions", { agentId: a.id })
    ).json();
    const connected = await request(
      "POST",
      `/api/sessions/${started.id}/connect`,
      { sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" },
    );
    expect(
      fetch.mock.calls.filter(([url]) =>
        String(url).startsWith("https://api.openai.com/"),
      ),
    ).toHaveLength(1);
    expect(connected.statusCode).toBe(400);
    expect(connected.body).toContain("invalid audio-only SDP");
    expect(connected.body).not.toContain(key);
    await request("DELETE", "/api/settings/credentials/openai");
    expect(voice.configured).toBe(false);
  });
  it("binds observation and stream leases to the GUI key and redacts asynchronous delivery records", async () => {
    const { request } = await setup();
    const key = "sk-proj-synthetic_async_API_canary";
    await request("PUT", "/api/settings/credentials/openai", { apiKey: key });
    let fail!: (error: Error) => void;
    vi.spyOn(library, "pollRecipe").mockImplementationOnce(
      async (_recipe, context) => {
        expect(context.credentials.project).toBe(key);
        return new Promise((_resolve, reject) => {
          fail = reject;
        });
      },
    );
    const observation = (
      await request("POST", "/api/library/poll", {
        recipe: { operationId: "listModels" },
        maxPolls: 1,
      })
    ).json();
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).statusCode,
    ).toBe(409);
    fail(new Error(`Fixture failure ${key}`));
    await Promise.resolve();
    const failure = await request("GET", `/api/library/runs/${observation.id}`);
    expect(failure.json().status).toBe("failed");
    expect(failure.body).not.toContain(key);
    let close!: () => void;
    vi.spyOn(library, "openApiStream").mockImplementationOnce(
      (_target, context) => {
        expect(context.credentials.project).toBe(key);
        close = () => context.onClose?.(1000);
        context.onEvent({ message: key });
        return { url: "wss://api.openai.com/fixture", send() {}, close };
      },
    );
    const stream = (
      await request("POST", "/api/library/streams", {
        intent: true,
        target: { kind: "realtime", model: "gpt-realtime-2.1" },
      })
    ).json();
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).statusCode,
    ).toBe(409);
    const events = await request("GET", `/api/library/streams/${stream.id}`);
    expect(events.body).not.toContain(key);
    await request("DELETE", `/api/library/streams/${stream.id}`);
    expect(
      (await request("DELETE", "/api/settings/credentials/openai")).statusCode,
    ).toBe(200);
  });
  it("applies consent to a researcher participant, freezes study condition, filters exports, persists outcome", async () => {
    const { request, store } = await setup(
      "unit-fixture-key-not-a-real-credential",
    );
    store.metadata.set("verifiedModels", ["gpt-realtime-2.1"]);
    const a = (
      await request("POST", "/api/agents", { name: "Study agent" })
    ).json();
    const rev = (
      await request("POST", `/api/agents/${a.id}/revisions`, {})
    ).json();
    const study = (
      await request("POST", "/api/studies", {
        name: "Consent study",
        conditions: [
          {
            id: "A",
            name: "A",
            revisionId: rev.id,
            view: "participant",
            controls: {},
          },
        ],
      })
    ).json();
    const input = {
      mode: "study",
      agentId: a.id,
      studyId: study.id,
      conditionId: "A",
      participantCode: "P01",
      researcherParticipant: true,
    };
    const blocked = await request("POST", "/api/sessions", input);
    expect(blocked.statusCode).toBe(400);
    const saved = await request("POST", "/api/sessions", {
      ...input,
      consent: { accepted: true, policyVersion: study.consentPolicy.version },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const session = saved.json();
    expect(session.initialView).toBe("participant");
    expect(session.researcherParticipant).toBe(true);
    expect(
      (
        await request("PATCH", `/api/sessions/${session.id}`, {
          view: "researcher",
          outcome: { taskSuccess: "success", notes: '=HYPERLINK("evil")' },
        })
      ).statusCode,
    ).toBe(200);
    await request("POST", `/api/sessions/${session.id}/end`, {});
    const data = (
      await request(
        "GET",
        `/api/studies/${study.id}/export?includeDeviations=true`,
      )
    ).json();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].outcome.taskSuccess).toBe("success");
    const bundle = await request(
      "GET",
      `/api/studies/${study.id}/export?format=csv&includeDeviations=true`,
    );
    expect(bundle.headers["content-type"]).toMatch("application/gzip");
    expect(bundle.rawPayload[0]).toBe(31);
  });
  it("imports safe Calendar metadata, keeps missing grants visible, separates catalog from execution", async () => {
    const { request } = await setup();
    const added = await request("POST", "/api/connections/google-calendar", {});
    expect(added.statusCode).toBe(200);
    expect(added.json()[0].status).not.toBe("ready");
    const list = (await request("GET", "/api/library/operations")).json();
    expect(list.length).toBeGreaterThan(300);
    expect(
      (
        await request("POST", "/api/library/execute", {
          operationId: "listModels",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/library/streams", {
          intent: true,
          target: { kind: "realtime", model: "gpt-realtime-2.1" },
        })
      ).statusCode,
    ).toBe(400);
  });
});

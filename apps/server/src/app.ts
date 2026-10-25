import Fastify from "fastify";
import { updateSidebar } from "./sidebar.js";
import serveStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { installSecurity } from "./security.js";
import { createStore, csv, type Document } from "./storage/index.js";
import { VoiceService } from "./voice.js";
import { SessionCredentials } from "./credentials.js";
import {
  defaultAgentConfig,
  configDiff,
  parseAgentConfig,
  validateAgentConfig,
  exportAgent,
  CAPABILITY_REVISION,
} from "../../../packages/agent-core/src/index.js";
import {
  ConnectionManager,
  googleCalendarDefinition,
} from "../../../packages/connections/src/index.js";
import { registerLibraryTransports } from "./library-routes.js";
import { csvArchive } from "./archive.js";
import * as library from "../../../packages/api-library/src/index.js";

export interface AppOptions {
  dataDir: string;
  port?: number;
  development?: boolean;
  env?: NodeJS.ProcessEnv;
}
export async function createApp(options: AppOptions) {
  const env = options.env ?? process.env,
    port = options.port ?? 4317;
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  const store = createStore(options.dataDir);
  const security = await installSecurity(
    app,
    port,
    options.development,
    Number(env.SONA_WEB_PORT ?? 5173),
  );
  const credentials = new SessionCredentials(env);
  const safe = <T>(value: T): T => credentials.safe(value);
  // Scrub any accidentally pasted credential before a request can enter study storage.
  app.addHook("preHandler", async (req) => {
    if (
      req.url.split("?")[0] !== "/api/settings/credentials/openai" &&
      req.body &&
      typeof req.body === "object"
    )
      req.body = JSON.parse(safe(JSON.stringify(req.body)));
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    if (
      typeof payload === "string" &&
      String(reply.getHeader("content-type") ?? "").includes("application/json")
    ) {
      return safe(payload);
    }
    return payload;
  });
  const connections = new ConnectionManager({
    callbackUrl: `http://127.0.0.1:${port}/api/oauth/callback`,
    env,
    records: store.metadata.list<any>("connection:").map((x: any) => x.value),
    audit: async (event) => {
      if (!event.operationId) return;
      const action = await store.actionJournal.get(event.operationId);
      if (!action) return;
      const attemptId = `${event.operationId}:attempt:${event.attempt ?? 1}`;
      store.sessions.appendEvent(action.sessionId, {
        type:
          event.type === "tool-dispatch"
            ? "tool.dispatch"
            : event.type === "tool-result"
              ? "tool.result"
              : "tool.error",
        source: "server-tool-adapter",
        toolId: attemptId,
        payload: safe({
          ...event,
          operationId: attemptId,
          actionId: event.operationId,
        }),
      });
    },
    persistence: {
      save(record: any) {
        store.metadata.set(`connection:${record.id}`, record);
      },
      remove(id: string) {
        store.metadata.delete(`connection:${id}`);
      },
    },
  });
  const verifiedModels = new Set(
    store.metadata.get<string[]>("verifiedModels") ?? [],
  );
  const voice = new VoiceService({
    store,
    getApiKey: () => credentials.apiKey,
    getSecrets: () => credentials.secrets,
    project: env.OPENAI_PROJECT_ID,
    adapter: (id) => connections.createAdapter(id),
    prepareTool: (id, name, args, resource, operationId) =>
      connections.prepareInvocation(id, name, args, resource, operationId),
    validateConnection: (id, sessionId) => {
      const binding = (
        store.sessions.get(sessionId).snapshot.versions
          .connectionBindings as any[]
      )?.find((b) => b.id === id);
      if (!binding) throw new Error("This connection has no snapshot binding.");
      connections.assertBinding(binding);
    },
    onConnectionDrift: (id, reason) => {
      store.sessions.exclude(id, reason);
    },
    onModelVerified: (model) => {
      verifiedModels.add(model);
      store.metadata.set("verifiedModels", [...verifiedModels]);
    },
  });
  credentials.setBusyCheck(
    () =>
      store.sessions.list().some((session) => session.state === "active") ||
      [...voice.calls.values()].some((call) => call.active),
  );
  app.setErrorHandler((rawError, req, reply) => {
    const error = rawError as Error & { statusCode?: number; code?: string };
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 400;
    reply.code(status).send({
      error: safe(
        (error.message || "The operation failed.") +
          ((error as any).issues?.length
            ? " " +
              (error as any).issues
                .slice(0, 10)
                .map((i: any) => `${i.location ?? i.path}: ${i.message}`)
                .join("; ")
            : ""),
      ),
      code: error.code ?? "REQUEST_FAILED",
    });
  });
  const body = (req: any): any => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new Error("A JSON object is necessary.");
    return req.body;
  };
  const id = (req: any) => String(req.params.id);
  const info = (s: any) => ({
    ...s,
    mode: s.kind,
    status: s.state,
    createdAt: s.startedAt,
  });
  const sessionDetail = async (sessionId: string) => ({
    ...info(store.sessions.get(sessionId)),
    events: store.sessions.events(sessionId),
    metrics: store.sessions.metrics(sessionId),
    actions: await voice.actions(sessionId),
  });
  app.get("/api/health", async () => ({
    status: "ok",
    version: "1.1.1",
    databaseSchema: store.schemaVersion,
  }));
  app.get("/api/bootstrap", async (req, reply) => ({
    csrfToken: security.bootstrap(req, reply),
    sidebar: store.metadata.get("sidebar") ?? {},
    version: "1.1.1",
    agents: store.agents.list(),
    studies: store.studies.list(),
    sessions: store.sessions.list().map(info),
    connections: connections.list(),
    settings: store.settings.get(),
    credentials: credentials.status(),
    defaultConfig: defaultAgentConfig(),
    readiness: {
      openaiConfigured: voice.configured,
      modelsVerified: [...verifiedModels],
      missing: voice.configured ? [] : ["Add your OpenAI API key in Settings."],
      rawAudio: false,
      maxSessionMinutes: 15,
      liveVerification: "Not verified in this installation.",
    },
  }));
  app.post("/api/config/validate", async (req) => {
    const result = validateAgentConfig(body(req).config ?? body(req));
    return {
      ...result,
      valid: result.success,
      ...(!result.success ? { errors: result.issues } : {}),
    };
  });
  app.post("/api/config/diff", async (req) =>
    configDiff(
      parseAgentConfig(body(req).before),
      parseAgentConfig(body(req).after),
    ),
  );
  app.patch("/api/sidebar/:kind/:id", async (req) =>
    updateSidebar(store, (req.params as any).kind, id(req), body(req)),
  );
  app.get("/api/agents", async () => store.agents.list());
  app.post("/api/agents", async (req) => {
    const input = body(req);
    const config = parseAgentConfig(
      input.config ?? input.draft ?? defaultAgentConfig(input.name),
    );
    return store.agents.create({
      name: input.name ?? config.name,
      draft: config,
    });
  });
  app.get("/api/agents/:id", async (req) => store.agents.get(id(req)));
  app.patch("/api/agents/:id", async (req) => {
    const input = body(req);
    return store.agents.updateDraft(
      id(req),
      parseAgentConfig(
        input.config ?? input.draft ?? store.agents.get(id(req)).draft,
      ),
      input.name,
    );
  });
  app.delete("/api/agents/:id", async (req) => {
    store.agents.delete(id(req));
    return { deleted: true };
  });
  app.post("/api/agents/:id/duplicate", async (req) =>
    store.agents.duplicate(id(req), body(req).name),
  );
  app.get("/api/agents/:id/revisions", async (req) =>
    store.agents.revisions(id(req)),
  );
  app.post("/api/agents/:id/revisions", async (req) => {
    const input = body(req);
    return store.agents.revise(
      id(req),
      input.name,
      input.config ? parseAgentConfig(input.config) : undefined,
    );
  });
  app.get("/api/revisions/diff", async (req) => {
    const q = req.query as any;
    return store.agents.diff(q.before, q.after);
  });
  app.get("/api/agents/:id/export", async (req, reply) =>
    reply
      .header("Content-Disposition", 'attachment; filename="sona-agent.json"')
      .type("application/json")
      .send(exportAgent(parseAgentConfig(store.agents.get(id(req)).draft))),
  );
  app.get("/api/studies", async () => store.studies.list());
  app.post("/api/studies", async (req) => store.studies.save(body(req)));
  app.get("/api/studies/:id", async (req) => store.studies.get(id(req)));
  app.patch("/api/studies/:id", async (req) =>
    store.studies.save({
      ...store.studies.get(id(req)),
      ...body(req),
      id: id(req),
    }),
  );
  app.delete("/api/studies/:id", async (req) => {
    for (const session of store.sessions.list({ studyId: id(req) }))
      if (session.state === "active")
        await voice.end(session.id, "study_deleted");
    store.studies.delete(id(req));
    return { deleted: true };
  });
  app.get("/api/studies/:id/assignments", async (req) =>
    store.studies.assignments(id(req)),
  );
  app.post("/api/studies/:id/assignments", async (req) =>
    store.studies.assign(id(req), body(req)),
  );
  app.post("/api/studies/:id/consent", async (req) =>
    store.studies.consent(id(req), body(req)),
  );
  app.get("/api/studies/:id/consent", async (req) => {
    const code = String((req.query as any).participantCode ?? "");
    return {
      applicable: Boolean(code && store.studies.currentConsent(id(req), code)),
      scope: store.studies.get(id(req)).consentPolicy.scope,
      retentionDays: store.settings.get().retentionDays,
    };
  });
  app.post("/api/consents/:id/withdraw", async (req) => {
    const consent = store.studies.withdrawConsent(id(req));
    for (const session of store.sessions.list({ studyId: consent.studyId })) {
      if (
        session.snapshot.consent?.id === consent.id &&
        session.state === "active"
      )
        await voice.end(session.id, "consent_withdrawn");
    }
    return consent;
  });
  app.get("/api/studies/:id/burden", async (req) =>
    store.studies.burden(id(req), Number((req.query as any).participants ?? 1)),
  );
  function filters(query: any) {
    return {
      view: query.view ?? "all",
      researcherParticipant:
        query.researcherParticipant === "true" ||
        query.participation === "researcher"
          ? true
          : query.researcherParticipant === "false" ||
              query.participation === "participant"
            ? false
            : "all",
      includeDeviations: query.includeDeviations === "true",
      poolGroups: query.poolGroups === "true",
      ...(query.conditionIds
        ? { conditionIds: String(query.conditionIds).split(",") }
        : {}),
    } as const;
  }
  app.get("/api/studies/:id/compare", async (req) => {
    const comparison = store.compare(id(req), filters(req.query));
    const selected = new Set(comparison.groups.flatMap((g) => g.sessionIds));
    return {
      ...comparison,
      turnCount: comparison.groups.reduce((sum, g) => sum + g.turnCount, 0),
      sessions: store.sessions
        .list({ studyId: id(req) })
        .filter((s) => selected.has(s.id))
        .map((s) => ({
          ...info(s),
          metrics: {
            responseLatencyMedianMs:
              comparison.groups
                .flatMap((g) => g.responseLatency.values)
                .find((v) => v.sessionId === s.id)?.value ?? null,
          },
        })),
    };
  });
  app.get("/api/studies/:id/export", async (req, reply) => {
    const q = req.query as any;
    const f = {
      ...filters(q),
      ...(q.conditionId && q.conditionId !== "all"
        ? { conditionIds: [q.conditionId] }
        : {}),
    };
    const selected = q.sessionIds
      ? String(q.sessionIds).split(",")
      : store.compare(id(req), f).groups.flatMap((g) => g.sessionIds);
    const result = store.exportStudy(id(req), {
      format: q.format === "csv" ? "csv" : "json",
      sessionIds: selected,
      filters: f,
    });
    if (q.format === "csv")
      return reply
        .type("application/gzip")
        .header(
          "Content-Disposition",
          'attachment; filename="sona-evidence-csv.tar.gz"',
        )
        .send(csvArchive((result as any).files));
    return reply
      .header(
        "Content-Disposition",
        'attachment; filename="sona-evidence.json"',
      )
      .send(result);
  });
  app.post("/api/sessions", async (req) => {
    const input = body(req),
      kind = input.mode ?? input.kind ?? "quick";
    if (!voice.configured)
      throw new Error(
        "Add your OpenAI API key in Settings before a voice test. Your draft is saved.",
      );
    const agent = store.agents.get(input.agentId);
    let config = parseAgentConfig(
      input.config ?? input.configuration ?? agent.draft,
    );
    if (kind === "study") {
      const study = store.studies.get(input.studyId),
        condition = study.conditions.find((c) => c.id === input.conditionId);
      if (!condition) throw new Error("Choose a saved study condition.");
      const conditionConfig = store.agents.revision(
        condition.revisionId,
      ).configuration;
      config = parseAgentConfig(conditionConfig, {
        measured: true,
        modelVerified: verifiedModels.has(String(conditionConfig.model)),
      });
      store.studies.assign(study.id, {
        participantCode: input.participantCode,
        researcherParticipant: input.researcherParticipant === true,
      });
      if (input.consent?.accepted === true || input.consent === true)
        store.studies.consent(study.id, {
          participantCode: input.participantCode,
          accepted: true,
          policyVersion:
            typeof input.consent === "object"
              ? input.consent.policyVersion
              : study.consentPolicy.version,
        });
    }
    for (const tool of config.tools) {
      const connection = connections.getPublic(tool.connection);
      if (connection.status !== "ready")
        throw new Error(
          `Repair connection ${connection.name} before this run.`,
        );
      const current = connection.discoveredTools.find(
        (t) => t.name === tool.name,
      );
      if (!current || current.schemaHash !== tool.schemaHash)
        throw new Error(`Tool ${tool.name} changed. Review its schema.`);
    }
    return info(
      store.sessions.start({
        kind,
        agentId: agent.id,
        configuration: config,
        studyId: input.studyId,
        conditionId: input.conditionId,
        participantCode: input.participantCode,
        researcherParticipant: input.researcherParticipant === true,
        view: input.view,
        processingAccepted: input.processingAccepted === true,
        devices: input.devices,
        versions: {
          application: "1.1.1",
          capability: CAPABILITY_REVISION,
          node: process.version,
          openaiSdk: "7.28.0",
          connectionBindings: [
            ...new Set(config.tools.map((t) => t.connection)),
          ].map((id) => connections.bindingSnapshot(id)),
          connections: config.tools.map((t) => ({
            id: t.connection,
            version: connections.getPublic(t.connection).runtimeVersion,
            schemaHash: t.schemaHash,
          })),
        },
      }),
    );
  });
  app.get("/api/sessions", async () => store.sessions.list().map(info));
  app.get("/api/sessions/:id", async (req) => sessionDetail(id(req)));
  app.post("/api/sessions/:id/connect", async (req) =>
    voice.connect(id(req), body(req).sdp),
  );
  app.post("/api/sessions/:id/ready", async (req) =>
    voice.waitUntilReady(id(req)),
  );
  app.post("/api/sessions/:id/control", async (req) =>
    voice.control(id(req), body(req).command),
  );
  app.get("/api/sessions/:id/runtime", async (req) =>
    safe(await voice.runtime(id(req))),
  );
  app.post("/api/actions/:id/reconcile", async (req) =>
    safe(await voice.reconcile(id(req))),
  );
  app.post("/api/sessions/:id/events", async (req) => {
    const events = body(req).events;
    if (!Array.isArray(events) || events.length > 100)
      throw new Error("Supply at most 100 session events.");
    for (const event of events) voice.browserEvent(id(req), event);
    return { accepted: events.length };
  });
  app.post("/api/sessions/:id/end", async (req) =>
    info(await voice.end(id(req), body(req).reason)),
  );
  app.post("/api/sessions/:id/reconnect", async (req) => {
    await voice.end(id(req), "connection_lost");
    return info(store.sessions.segment(id(req), "reconnect"));
  });
  app.patch("/api/sessions/:id", async (req) => {
    const input = body(req);
    if (input.view) store.sessions.changeView(id(req), input.view);
    if (input.exclusion !== undefined)
      store.sessions.exclude(id(req), input.exclusion);
    const annotations =
      input.outcome ??
      Object.fromEntries(
        Object.entries(input).filter(([key]) =>
          ["taskSuccess", "ratings", "notes", "codes"].includes(key),
        ),
      );
    if (Object.keys(annotations).length)
      store.sessions.annotate(id(req), annotations, input.reason);
    return info(store.sessions.get(id(req)));
  });
  app.delete("/api/sessions/:id", async (req) => {
    await voice.end(id(req));
    store.sessions.delete(id(req));
    return { deleted: true };
  });
  app.get("/api/sessions/:id/export", async (req, reply) => {
    const session = store.sessions.get(id(req));
    if (session.kind === "quick")
      throw new Error(
        "Quick-test evidence is not a saved study. Start a consented study run to export evidence.",
      );
    const q = req.query as any;
    return reply
      .header("Content-Disposition", 'attachment; filename="sona-session.json"')
      .send(
        store.exportStudy(session.studyId!, {
          format: q.format === "csv" ? "csv" : "json",
          sessionIds: [session.id],
        }),
      );
  });
  app.get("/api/settings/credentials", async () => credentials.status());
  app.post("/api/settings/credentials/openai/verify", async () =>
    credentials.verify(),
  );
  app.put("/api/settings/credentials/openai", async (req) => {
    const result = credentials.set(body(req).apiKey);
    verifiedModels.clear();
    store.metadata.set("verifiedModels", []);
    return result;
  });
  app.delete("/api/settings/credentials/openai", async () => {
    const result = credentials.remove();
    verifiedModels.clear();
    store.metadata.set("verifiedModels", []);
    return result;
  });
  app.get("/api/settings", async () => store.settings.get());
  app.patch("/api/settings", async (req) => {
    const input = body(req);
    if (input.retentionDays !== undefined)
      store.settings.setRetention(input.retentionDays);
    return store.settings.get();
  });
  app.post("/api/settings/cleanup", async () => store.cleanup());
  app.get("/api/connections", async () => connections.list());
  app.post("/api/connections", async (req) => {
    const input = body(req);
    return connections.importDefinition(
      input.definition ?? input.manifest ?? input,
      input.source,
    );
  });
  app.get("/api/connections/:id", async (req) =>
    connections.getPublic(id(req)),
  );
  app.patch("/api/connections/:id", async (req) => {
    const input = body(req);
    return input.definition
      ? connections.updateDefinition(id(req), input.definition)
      : connections.updatePolicy(
          id(req),
          input.tools,
          input.instructionsApproved,
          input.resourceBindings,
        );
  });
  app.post("/api/connections/:id/discover", async (req) =>
    connections.connect(id(req), req.cookies.sona),
  );
  app.post("/api/connections/:id/auth", async (req) =>
    connections.beginOAuth(id(req), req.cookies.sona ?? ""),
  );
  app.post("/api/connections/:id/disconnect", async (req) => {
    await connections.disconnect(id(req));
    return connections.getPublic(id(req));
  });
  app.delete("/api/connections/:id", async (req) => {
    await connections.remove(id(req));
    return { deleted: true };
  });
  app.post("/api/connections/codex/probe", async () =>
    connections.probeCodex(),
  );
  app.post("/api/connections/bridge", async () => connections.probeCodex());
  app.post("/api/connections/google-calendar", async () =>
    connections.importLocalDefinition({
      ...googleCalendarDefinition(),
      ...(env.GOOGLE_CALENDAR_ID
        ? { resourceBindings: { "test-calendar": env.GOOGLE_CALENDAR_ID } }
        : {}),
    }),
  );
  app.post("/api/connections/import", async (req) =>
    connections.importDefinition(body(req).manifest, body(req).source),
  );
  app.get("/api/oauth/callback", async (req, reply) => {
    const q = req.query as any;
    if (q.error)
      throw new Error(
        "Authorization did not complete. Return to Sona to reconnect.",
      );
    await connections.finishOAuth(q.state, q.code, req.cookies.sona ?? "");
    return reply
      .type("text/html")
      .send(
        '<!doctype html><html lang="en"><title>Sona connection</title><body><p>Authorization is complete. Return to Sona and check the connection.</p><a href="/">Return to Sona</a></body></html>',
      );
  });
  app.get("/api/library/operations", async (req) => {
    const search = String((req.query as any).search ?? "").toLowerCase();
    return library
      .listOperations()
      .filter((o) =>
        `${o.id} ${o.family} ${o.title} ${o.path} ${o.description}`
          .toLowerCase()
          .includes(search),
      );
  });
  app.get("/api/library/operations/:id", async (req) => ({
    ...library.getOperationSchema(id(req)),
    parameters: library.describeParameters(id(req)),
  }));
  const recipe = (input: any) => {
    const r = { ...input.request, ...input, operationId: input.operationId };
    delete r.request;
    r.intent =
      input.intent === true
        ? { confirmed: true, operationId: input.operationId }
        : input.intent;
    if (r.files)
      r.files = Object.fromEntries(
        Object.entries(r.files).map(([key, value]: [string, any]) => [
          key,
          Array.isArray(value) ? value.map(decodeFile) : decodeFile(value),
        ]),
      );
    return r;
  };
  const decodeFile = (file: any) => ({
    name: file.name,
    mediaType: file.mediaType,
    data: new Uint8Array(
      Buffer.from(file.dataBase64 ?? file.base64 ?? file.data ?? "", "base64"),
    ),
  });
  app.post("/api/library/validate", async (req) =>
    library.validateRecipe(recipe(body(req))),
  );
  app.post("/api/library/execute", async (req, reply) => {
    const r = recipe(body(req));
    const lease = credentials.acquire();
    let result;
    try {
      result = await library.executeRecipe(r, {
        credentials: lease.credentials,
      });
    } finally {
      lease.release();
    }
    const publicResult = safe({
      ...result,
      ...(result.binary
        ? {
            binary: {
              mediaType: result.binary.mediaType,
              base64: Buffer.from(result.binary.data).toString("base64"),
            },
          }
        : {}),
    });
    store.metadata.set(
      `api-run:${randomUUID()}`,
      safe({
        operationId: r.operationId,
        at: new Date().toISOString(),
        status: result.status,
        ...(result.requestId ? { requestId: result.requestId } : {}),
        acceptance: result.acceptance,
      }),
    );
    return reply.send(publicResult);
  });
  app.get("/api/library/coverage", async () => library.coverageReport());
  await registerLibraryTransports(app, { store, env, voice, credentials });
  const web = resolve("dist/web");
  if (existsSync(web)) {
    await app.register(serveStatic, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Unknown API route." })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    await voice.close();
    await connections.close();
    store.close();
    credentials.clear();
  });
  return { app, store, voice, connections };
}

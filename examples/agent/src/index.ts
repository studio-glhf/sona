import Fastify from "fastify";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import {
  parseAgentConfig,
  redact,
  ActionExecutor,
} from "../../../packages/agent-core/src/index.js";
import { ConnectionManager } from "../../../packages/connections/src/index.js";
import { VoiceService } from "../../../apps/server/src/voice.js";
import { installSecurity } from "../../../apps/server/src/security.js";
import { RuntimeActionJournal } from "./journal.js";
import { runtimeSessionMemory } from "./session-memory.js";
const arg = (key: string) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? undefined : process.argv[i + 1];
};
if (process.argv.includes("--help") || !arg("--config")) {
  console.log(
    "Usage: pnpm example:agent --config /private/path/sona-agent.json [--connections /private/path/bindings.json] [--port 4320]",
  );
  console.log(
    "Uses the same validator, provider translation, connection policy, voice coordinator, and action executor. No study database is opened.",
  );
  process.exit(0);
}
const config = parseAgentConfig(
  JSON.parse(await readFile(resolve(arg("--config")!), "utf8")),
);
const port = Number(arg("--port") ?? 4320);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Choose a valid local port.");
const directory = resolve(
  process.env.SONA_AGENT_DATA_DIR ?? join(homedir(), ".sona-agent"),
);
const rel = relative(process.cwd(), directory);
if (!rel || (!rel.startsWith("..") && !isAbsolute(rel)))
  throw new Error("Keep the runtime journal outside the repository.");
await mkdir(directory, { recursive: true, mode: 0o700 });
const journal = new RuntimeActionJournal(join(directory, "actions.sqlite"));
const memory = runtimeSessionMemory(journal);
const connections = new ConnectionManager({
  callbackUrl: `http://127.0.0.1:${port}/api/oauth/callback`,
});
if (arg("--connections")) {
  const definitions = JSON.parse(
    await readFile(resolve(arg("--connections")!), "utf8"),
  );
  for (const definition of Array.isArray(definitions)
    ? definitions
    : [definitions])
    await connections.importLocalDefinition(definition);
}
const voice = new VoiceService({
  store: memory,
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT_ID,
  adapter: (id) => connections.createAdapter(id),
  prepareTool: (id, name, args, resource, operationId) =>
    connections.prepareInvocation(id, name, args, resource, operationId),
  validateConnection: (id, sessionId) => {
    const binding = (
      memory.sessions.get(sessionId).snapshot.versions
        .connectionBindings as any[]
    )?.find((b) => b.id === id);
    if (!binding) throw new Error("This connection has no snapshot binding.");
    connections.assertBinding(binding);
  },
  onModelVerified() {},
});
const app = Fastify({ logger: false });
const security = await installSecurity(app, port);
const secrets = [
  process.env.OPENAI_API_KEY,
  process.env.GOOGLE_CLIENT_SECRET,
].filter((s): s is string => Boolean(s));
app.setErrorHandler((error, req, reply) =>
  reply.code(400).send({
    error: redact(
      error instanceof Error ? error.message : "The runtime request failed.",
      secrets,
    ),
  }),
);
app.get("/api/health", async () => ({ status: "ok" }));
app.get("/api/bootstrap", async (req, reply) => ({
  csrfToken: security.bootstrap(req, reply),
  name: config.name,
  connections: connections.list(),
  configured: voice.configured,
}));
app.post("/api/sessions", async (req) => {
  if (!voice.configured)
    throw new Error("Set OPENAI_API_KEY on the local server before capture.");
  if ((req.body as any)?.processingAccepted !== true)
    throw new Error("Accept the processing notice before capture.");
  for (const tool of config.tools) {
    const record = connections.getPublic(tool.connection);
    if (record.status !== "ready")
      throw new Error(
        "Authorize and check the selected tool connection before a call.",
      );
  }
  return memory.start(config, {
    connectionBindings: [...new Set(config.tools.map((t) => t.connection))].map(
      (id) => connections.bindingSnapshot(id),
    ),
  });
});
app.post("/api/sessions/:id/connect", async (req) =>
  voice.connect((req.params as any).id, (req.body as any).sdp),
);
app.post("/api/sessions/:id/ready", async (req) =>
  voice.waitUntilReady((req.params as any).id),
);
app.post("/api/sessions/:id/end", async (req) =>
  voice.end((req.params as any).id),
);
app.get("/api/sessions/:id/runtime", async (req) => {
  const state = await voice.runtime((req.params as any).id);
  return {
    status: state.status,
    error: state.error,
    speaking: state.speaking,
    controls: state.controls,
  };
});
app.post("/api/sessions/:id/events", async (req) => {
  for (const event of (req.body as any).events ?? [])
    voice.browserEvent((req.params as any).id, event);
  return { accepted: true };
});
app.post("/api/sessions/:id/control", async (req) =>
  voice.control((req.params as any).id, (req.body as any).command),
);
app.get("/api/actions", async () => journal.listUnsettled());
app.post("/api/actions/:id/reconcile", async (req) => {
  const id = (req.params as any).id,
    record = await journal.get(id);
  if (!record || record.state !== "unknown")
    throw new Error("Only an unknown action can be reconciled.");
  const executor = new ActionExecutor({
    journal,
    policy: config.confirmationPolicy,
    isSessionActive: () => false,
    secrets,
  });
  return executor.reconcile(id, connections.createAdapter(record.connectionId));
});
app.post("/api/connections/:id/auth", async (req) =>
  connections.beginOAuth((req.params as any).id, req.cookies.sona ?? ""),
);
app.post("/api/connections/:id/discover", async (req) =>
  connections.connect((req.params as any).id, req.cookies.sona),
);
app.patch("/api/connections/:id", async (req) =>
  connections.updatePolicy((req.params as any).id, (req.body as any).tools),
);
app.get("/api/oauth/callback", async (req, reply) => {
  const q = req.query as any;
  await connections.finishOAuth(q.state, q.code, req.cookies.sona ?? "");
  return reply
    .type("text/html")
    .send(
      '<p>Authorization is complete. Return to the agent.</p><a href="/">Return</a>',
    );
});
const web = resolve("examples/agent/web");
app.get("/", async (req, reply) =>
  reply.type("text/html").send(await readFile(join(web, "index.html"), "utf8")),
);
app.get("/runtime.js", async (req, reply) =>
  reply
    .type("text/javascript")
    .send(await readFile(join(web, "runtime.js"), "utf8")),
);
app.get("/style.css", async (req, reply) =>
  reply.type("text/css").send(await readFile(join(web, "style.css"), "utf8")),
);
app.addHook("onClose", async () => {
  await voice.close();
  await connections.close();
  journal.close();
});
await app.listen({ host: "127.0.0.1", port });
console.log(
  `Portable agent is ready on local port ${port}. Study storage is not used.`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));

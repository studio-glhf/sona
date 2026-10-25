import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VoiceService } from "./voice.js";
import { createStore } from "./storage/index.js";
import {
  defaultAgentConfig,
  canonicalHash,
  type ConnectionAdapter,
} from "../../../packages/agent-core/src/index.js";
const resources: {
  store: ReturnType<typeof createStore>;
  voice: VoiceService;
  dir: string;
}[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const r of resources.splice(0)) {
    await r.voice.close();
    r.store.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});
const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
class Socket extends EventEmitter {
  socket = Object.assign(new EventEmitter(), { readyState: 1 });
  sent: any[] = [];
  send(event: any) {
    this.sent.push(event);
  }
  close() {
    this.socket.readyState = 3;
    this.socket.emit("close");
  }
}
async function setup(deferConfiguration = false) {
  let writes = 0;
  const dir = mkdtempSync(join(tmpdir(), "sona-voice-contract-")),
    store = createStore(dir),
    config = defaultAgentConfig("Contract fixture");
  (config.settings.audio as any).input.transcription = {
    model: "gpt-4o-mini-transcribe",
    language: "en",
  };
  const schema = {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  };
  config.tools = [
    {
      name: "create_event",
      connection: "fixture",
      description: "Synthetic test write",
      inputSchema: schema,
      schemaHash: canonicalHash(schema),
      effect: "write",
      resource: "fixture-calendar",
    },
  ];
  const adapter: ConnectionAdapter = {
    id: "fixture",
    accountId: "fixture-account",
    discover: async () => [{ ...config.tools[0] }],
    invoke: async () => {
      writes++;
      return { data: { id: "synthetic-event" }, externalId: "synthetic-event" };
    },
  };
  const agent = store.agents.create({ name: config.name, draft: config });
  const session = store.sessions.start({
    kind: "quick",
    agentId: agent.id,
    processingAccepted: true,
  });
  const socket = new Socket();
  const client: any = {
    realtime: {
      calls: {
        create: async () =>
          new Response("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n", {
            headers: {
              location: "https://api.openai.com/v1/realtime/calls/rtc_contract",
            },
          }),
        hangup: async () => {},
      },
    },
  };
  const voice = new VoiceService({
    store,
    adapter: () => adapter,
    onModelVerified() {},
    client,
    socketFactory: () => {
      if (!deferConfiguration) setTimeout(
        () =>
          socket.emit("event", {
            type: "session.created",
            event_id: "created",
            session: {
              ...config.settings,
              type: "realtime",
              model: config.model,
              instructions: config.instructions,
              tools: config.tools.map((t) => ({
                type: "function",
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              })),
            },
          }),
        0,
      );
      return socket as any;
    },
  });
  resources.push({ store, voice, dir });
  await voice.connect(session.id, offer);
  if (!deferConfiguration) await voice.waitUntilReady(session.id);
  const call = voice.calls.get(session.id)!;
  const event = async (e: any) => {
    await (voice as any).handle(call, e);
    await call.chain;
  };
  return {
    voice,
    store,
    session,
    socket,
    call,
    event,
    get writes() {
      return writes;
    },
  };
}
describe("voice coordinator contract fixtures", () => {
  it("returns SDP before configuration and keeps actions gated until the provider confirms", async () => {
    const r = await setup(true);
    expect(r.call.ready).toBe(false);
    expect(r.socket.sent).toContainEqual({ type: "session.update", session: { type: "realtime" } });
    let ready = false;
    const pending = r.voice.waitUntilReady(r.session.id).then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    r.socket.emit("event", { type: "session.created", session: {} });
    await pending;
    expect(r.call.ready).toBe(true);
  });
  it("redacts optional provider credentials before runtime inspection", async () => {
    const r = await setup();
    r.socket.emit("event", {
      type: "session.updated",
      event_id: "credential",
      session: {
        ...r.call.providerEvidence.returned,
        client_secret: { value: "opaque-provider-fixture" },
        metadata: { value: "ek_fixture_canary_1234567890" },
      },
    });
    await r.call.chain;
    const state = JSON.stringify(await r.voice.runtime(r.session.id));
    expect(state).not.toContain("opaque-provider-fixture");
    expect(state).not.toContain("ek_fixture_canary_1234567890");
  });
  it("stops an active session if a later applied setting differs", async () => {
    const r = await setup();
    r.socket.emit("event", {
      type: "session.updated",
      event_id: "drift",
      session: {
        ...r.call.providerEvidence.returned,
        model: "different-model",
      },
    });
    await r.call.chain;
    expect(r.call.active).toBe(false);
    expect(r.store.sessions.get(r.session.id).state).toBe("interrupted");
    expect(r.writes).toBe(0);
  });
  it("stops capture if the provider evidence store fails", async () => {
    const r = await setup();
    vi.spyOn(r.store.sessions, "setProviderEvidence").mockImplementation(() => {
      throw new Error("Synthetic storage failure");
    });
    expect(() =>
      r.socket.emit("event", {
        type: "session.updated",
        event_id: "storage-failure",
        session: r.call.providerEvidence.returned,
      }),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(r.call.active).toBe(false);
    expect(r.store.sessions.get(r.session.id).state).toBe("interrupted");
  });
  it("ignores late source events after a session is removed", async () => {
    const r = await setup();
    await r.voice.end(r.session.id);
    r.store.sessions.delete(r.session.id);
    expect(() =>
      r.socket.emit("event", { type: "response.done", event_id: "late" }),
    ).not.toThrow();
    await expect(r.voice.close()).resolves.toBeUndefined();
  });
  it("rejects browser Realtime control channels and camera SDP", async () => {
    const r = await setup();
    await r.voice.end(r.session.id);
    const next = r.store.sessions.start({
      kind: "quick",
      agentId: r.session.agentId,
      processingAccepted: true,
    });
    await expect(
      r.voice.connect(
        next.id,
        offer + "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
      ),
    ).rejects.toThrow("SDP");
    await expect(
      r.voice.connect(next.id, offer + "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n"),
    ).rejects.toThrow("SDP");
  });
  it("a model statement or browser approval event never authorizes a write", async () => {
    const r = await setup();
    expect(() =>
      r.voice.browserEvent(r.session.id, { type: "proposal.approved" }),
    ).toThrow("not permitted");
    await r.event({
      type: "response.function_call_arguments.done",
      name: "create_event",
      arguments: '{"title":"Fixture"}',
      call_id: "call1",
    });
    expect(r.writes).toBe(0);
    expect(r.call.pending?.record.state).toBe("proposed");
  });
  it("complete proposal plus trusted final participant speech dispatches one write", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    const r = await setup();
    await r.event({
      type: "response.function_call_arguments.done",
      name: "create_event",
      arguments: '{"title":"Fixture"}',
      call_id: "call1",
    });
    const p = r.call.pending!;
    await r.event({
      type: "response.created",
      response: { id: "resp-proposal" },
    });
    await r.event({
      type: "output_audio_buffer.started",
      response_id: "resp-proposal",
    });
    await r.event({
      type: "response.output_audio_transcript.done",
      response_id: "resp-proposal",
      transcript: p.expected,
    });
    await r.event({
      type: "output_audio_buffer.stopped",
      response_id: "resp-proposal",
    });
    expect((await r.store.actionJournal.get(p.record.id))?.state).toBe(
      "awaiting_approval",
    );
    await r.event({
      type: "input_audio_buffer.speech_started",
      item_id: "utterance",
    });
    await r.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "utterance",
      event_id: "approval1",
      transcript: "I confirm.",
    });
    await vi.waitFor(async () =>
      expect((await r.store.actionJournal.get(p.record.id))?.state).toBe(
        "succeeded",
      ),
    );
    expect(r.writes).toBe(1);
    await r.event({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "utterance",
      event_id: "approval1",
      transcript: "I confirm.",
    });
    expect(r.writes).toBe(1);
    vi.restoreAllMocks();
  });
  it("browser playback failure vetoes approval and requires a fresh proposal", async () => {
    const r = await setup();
    await r.event({
      type: "response.function_call_arguments.done",
      name: "create_event",
      arguments: '{"title":"Fixture"}',
      call_id: "call1",
    });
    const action = r.call.pending!.record.id;
    r.voice.browserEvent(r.session.id, { type: "playback.failed" });
    await r.call.chain;
    expect(r.writes).toBe(0);
    expect((await r.store.actionJournal.get(action))?.state).toBe("canceled");
    r.voice.browserEvent(r.session.id, { type: "playback.ready" });
    expect(r.call.pending).toBeUndefined();
    expect(r.writes).toBe(0);
  });
  it("a lost server control connection prevents new writes", async () => {
    const r = await setup();
    r.socket.socket.emit("close");
    await r.event({
      type: "response.function_call_arguments.done",
      name: "create_event",
      arguments: '{"title":"Fixture"}',
      call_id: "after-loss",
    });
    expect(r.writes).toBe(0);
    expect((await r.voice.runtime(r.session.id)).status).toBe("control-lost");
  });
  it("manual turns send documented control events while writes stay blocked without speech-start evidence", async () => {
    const r = await setup();
    (r.call.config.settings.audio as any).input.turn_detection = null;
    r.voice.control(r.session.id, "finish-turn");
    expect(
      r.socket.sent.some((event) => event.type === "input_audio_buffer.commit"),
    ).toBe(true);
    await r.event({
      type: "response.function_call_arguments.done",
      name: "create_event",
      arguments: '{"title":"Fixture"}',
      call_id: "manual-write",
    });
    expect(r.writes).toBe(0);
    expect(r.call.pending).toBeUndefined();
    expect(() => r.voice.control(r.session.id, "respond")).toThrow("automatic");
  });
  it("interrupted or incomplete proposal cancels a write without dispatch", async () => {
    const r = await setup();
    await r.event({
      type: "response.function_call_arguments.done",
      name: "create_event",
      arguments: '{"title":"Fixture"}',
      call_id: "call1",
    });
    const action = r.call.pending!.record.id;
    await r.event({
      type: "input_audio_buffer.speech_started",
      item_id: "interruption",
    });
    expect(r.writes).toBe(0);
    expect((await r.store.actionJournal.get(action))?.state).toBe("canceled");
  });
  it("end prevents new tools and stops the server control connection", async () => {
    const r = await setup();
    await r.voice.end(r.session.id);
    await r.event({
      type: "response.function_call_arguments.done",
      name: "create_event",
      arguments: '{"title":"Fixture"}',
      call_id: "after-end",
    });
    expect(r.writes).toBe(0);
    expect(r.socket.socket.readyState).toBe(3);
    expect(r.store.sessions.get(r.session.id).state).toBe("ended");
  });
});

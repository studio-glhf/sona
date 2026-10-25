import { useEffect, useState } from "react";
import {
  Search,
  PanelRightClose,
  Braces,
  History,
  Download,
  Info,
  Copy,
  ChevronRight,
} from "lucide-react";
import { Agent, api, download, downloadJson, Json, pretty } from "./api";
import { ActionButton, JsonEditor, Modal, Notice, Toggle } from "./components";

const voices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];
export function AgentPanel({
  agent,
  onCollapse,
  onChange,
  saving,
  active,
  applied,
  connections,
  onConnections,
}: {
  agent: Agent;
  onCollapse: () => void;
  onChange: (config: Json) => void;
  saving: string;
  active: boolean;
  applied: Json;
  connections: Json[];
  onConnections: () => void;
}) {
  const [tab, setTab] = useState(
      localStorage.getItem("sona-agent-tab") ?? "Parameters",
    ),
    [search, setSearch] = useState(""),
    [json, setJson] = useState(false),
    [modal, setModal] = useState(""),
    [revisions, setRevisions] = useState<Json[]>([]),
    [validation, setValidation] = useState<Json>(null);
  const c = agent.draft ?? {},
    s = c.settings ?? {},
    a = s.audio ?? {},
    i = a.input ?? {},
    o = a.output ?? {},
    vad = i.turn_detection ?? { type: "server_vad" };
  const change = (key: string, value: Json) => onChange({ ...c, [key]: value });
  const setting = (key: string, value: Json) =>
    change("settings", { ...s, [key]: value });
  const audio = (side: string, value: Json) =>
    setting("audio", { ...a, [side]: value });
  const turn = (key: string, value: Json) =>
    audio("input", { ...i, turn_detection: { ...vad, [key]: value } });
  useEffect(() => {
    setValidation(null);
    const timer = setTimeout(() => {
      void api("/config/validate", { config: c })
        .then(setValidation)
        .catch((e) => setValidation({ valid: false, error: e.message }));
    }, 500);
    return () => clearTimeout(timer);
  }, [c]);
  const matches = (label: string) =>
    !search || label.toLowerCase().includes(search.toLowerCase());
  return (
    <aside className="agent-panel" aria-label="Agent controls">
      <header>
        <div className="panel-heading">
          <h2>Agent controls</h2>
          <button
            className="icon"
            onClick={onCollapse}
            aria-label="Collapse agent controls"
            title="Collapse agent controls"
          >
            <PanelRightClose size={19} />
          </button>
        </div>
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Find a parameter"
            placeholder="Find a parameter…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setTab("Parameters");
            }}
          />
        </div>
      </header>
      <div className="tabs" role="tablist" aria-label="Agent controls">
        {["Parameters", "Instructions", "Tools"].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              localStorage.setItem("sona-agent-tab", t);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        <div className="draft-state">
          <span>{active ? "Next test" : "Draft"}</span>
          <span aria-live="polite">{saving}</span>
        </div>
        {validation?.valid === false && (
          <Notice error>
            {validation.error ??
              validation.errors
                ?.map((e: Json) => e.message ?? String(e))
                .join("; ") ??
              "Invalid configuration"}
          </Notice>
        )}
        {tab === "Parameters" && (
          <>
            {json ? (
              <JsonEditor
                label="Complete agent configuration"
                value={c}
                onChange={onChange}
                rows={26}
              />
            ) : (
              <>
                {matches("model") && (
                  <label className="field parameter">
                    Model
                    <input
                      list="realtime-models"
                      value={c.model ?? ""}
                      onChange={(e) => change("model", e.target.value)}
                    />
                    <datalist id="realtime-models">
                      <option value="gpt-realtime-2.1" />
                      <option value="gpt-realtime" />
                      <option value="gpt-realtime-mini" />
                    </datalist>
                  </label>
                )}
                {matches("voice audio.output.voice") && (
                  <label className="field parameter">
                    Voice
                    <select
                      aria-label="Voice"
                      value={
                        typeof o.voice === "string"
                          ? o.voice
                          : o.voice
                            ? "__custom__"
                            : "alloy"
                      }
                      onChange={(e) =>
                        audio("output", { ...o, voice: e.target.value })
                      }
                    >
                      {o.voice && typeof o.voice === "object" && (
                        <option value="__custom__" disabled>
                          Custom voice · See JSON
                        </option>
                      )}
                      {voices.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                    <details>
                      <summary>API details</summary>
                      <p>
                        Native audio.output.voice. Default: alloy. A voice
                        cannot change after its first audio output. Sona applies
                        this draft to the next call.
                      </p>
                      <a
                        href="https://developers.openai.com/api/reference/resources/realtime"
                        target="_blank"
                        rel="noreferrer"
                      >
                        OpenAI reference
                      </a>
                    </details>
                  </label>
                )}
                {matches("speech speed audio.output.speed") && (
                  <div className="field">
                    <label htmlFor="speech-speed">
                      Speech speed{" "}
                      <output>{Number(o.speed ?? 1).toFixed(2)}</output>
                    </label>
                    <input
                      id="speech-speed"
                      aria-label="Speech speed"
                      type="range"
                      min="0.25"
                      max="1.5"
                      step="0.05"
                      value={o.speed ?? 1}
                      onChange={(e) =>
                        audio("output", { ...o, speed: Number(e.target.value) })
                      }
                    />
                    <div className="range-labels">
                      <span>0.25</span>
                      <span>1.50</span>
                    </div>
                    <details>
                      <summary>API details</summary>
                      <p>
                        Native audio.output.speed. Default: 1.0. Audio
                        post-processing multiplier; it does not set words per
                        minute. The API permits changes between turns. Sona uses
                        a new call.
                      </p>
                    </details>
                  </div>
                )}
                {matches("turn detection server semantic vad") && (
                  <label className="field">
                    Turn detection
                    <select
                      value={i.turn_detection === null ? "manual" : vad.type}
                      onChange={(e) =>
                        audio("input", {
                          ...i,
                          turn_detection:
                            e.target.value === "manual"
                              ? null
                              : e.target.value === "semantic_vad"
                                ? {
                                    type: "semantic_vad",
                                    eagerness: "auto",
                                    create_response: true,
                                    interrupt_response: true,
                                  }
                                : {
                                    type: "server_vad",
                                    threshold: 0.5,
                                    prefix_padding_ms: 300,
                                    silence_duration_ms: 500,
                                    create_response: true,
                                    interrupt_response: true,
                                  },
                        })
                      }
                    >
                      <option value="server_vad">Server VAD</option>
                      <option value="semantic_vad">Semantic VAD</option>
                      <option value="manual">Manual turns</option>
                    </select>
                    <details>
                      <summary>API details</summary>
                      <p>
                        Manual turns use Finish turn. External writes require
                        VAD speech-start evidence.
                      </p>
                    </details>
                  </label>
                )}
                {vad.type === "server_vad" &&
                  matches("threshold silence prefix server vad") && (
                    <details className="parameter-details">
                      <summary>Server VAD settings</summary>
                      <label className="field">
                        Threshold
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          value={vad.threshold ?? 0.5}
                          onChange={(e) =>
                            turn("threshold", Number(e.target.value))
                          }
                        />
                      </label>
                      <label className="field">
                        Prefix padding (ms)
                        <input
                          type="number"
                          value={vad.prefix_padding_ms ?? 300}
                          onChange={(e) =>
                            turn("prefix_padding_ms", Number(e.target.value))
                          }
                        />
                      </label>
                      <label className="field">
                        Silence duration (ms)
                        <input
                          type="number"
                          value={vad.silence_duration_ms ?? 500}
                          onChange={(e) =>
                            turn("silence_duration_ms", Number(e.target.value))
                          }
                        />
                      </label>
                    </details>
                  )}
                {vad.type === "semantic_vad" && (
                  <label className="field">
                    Eagerness
                    <select
                      value={vad.eagerness ?? "auto"}
                      onChange={(e) => turn("eagerness", e.target.value)}
                    >
                      {["auto", "low", "medium", "high"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <details>
                      <summary>API details</summary>
                      <p>
                        Default auto equals medium. Observed timing can vary.
                      </p>
                    </details>
                  </label>
                )}
                {i.turn_detection !== null &&
                  matches("interrupt response create automatic") && (
                    <>
                      <Toggle
                        label="Interrupt response"
                        checked={vad.interrupt_response !== false}
                        onChange={(v) => turn("interrupt_response", v)}
                      />
                      <Toggle
                        label="Automatic response"
                        checked={vad.create_response !== false}
                        onChange={(v) => turn("create_response", v)}
                      />
                    </>
                  )}
                {matches("transcription input language") && (
                  <>
                    <label className="field">
                      Input transcription
                      <select
                        value={i.transcription?.model ?? "off"}
                        onChange={(e) =>
                          audio("input", {
                            ...i,
                            transcription:
                              e.target.value === "off"
                                ? null
                                : { model: e.target.value },
                          })
                        }
                      >
                        <option value="off">Off</option>
                        <option value="gpt-4o-mini-transcribe">
                          gpt-4o-mini-transcribe
                        </option>
                        <option value="gpt-4o-transcribe">
                          gpt-4o-transcribe
                        </option>
                        <option value="whisper-1">whisper-1</option>
                      </select>
                      <details>
                        <summary>API details</summary>
                        <p>
                          Input transcription is a separate process. It can add
                          cost and does not fully represent model perception.
                        </p>
                      </details>
                    </label>
                    {i.transcription && (
                      <label className="field">
                        Transcription language
                        <select
                          value={i.transcription.language ?? ""}
                          onChange={(e) =>
                            audio("input", {
                              ...i,
                              transcription: {
                                ...i.transcription,
                                language: e.target.value || undefined,
                              },
                            })
                          }
                        >
                          <option value="">Automatic</option>
                          <option value="en">English</option>
                          <option value="ko">Korean</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
                {matches("noise reduction") && (
                  <label className="field">
                    Noise reduction
                    <select
                      value={i.noise_reduction?.type ?? "off"}
                      onChange={(e) =>
                        audio("input", {
                          ...i,
                          noise_reduction:
                            e.target.value === "off"
                              ? null
                              : { type: e.target.value },
                        })
                      }
                    >
                      <option value="off">Off (null)</option>
                      <option value="near_field">Near field</option>
                      <option value="far_field">Far field</option>
                    </select>
                  </label>
                )}
                {matches("output limit max_output_tokens") && (
                  <label className="field">
                    Output token limit
                    <input
                      value={s.max_output_tokens ?? "inf"}
                      onChange={(e) =>
                        setting(
                          "max_output_tokens",
                          e.target.value === "inf"
                            ? "inf"
                            : Number(e.target.value),
                        )
                      }
                    />
                    <small>
                      1–4096 or inf. Includes tool calls. Default: inf.
                    </small>
                  </label>
                )}
                <button className="full" onClick={() => setJson(true)}>
                  <Braces size={18} />
                  All parameters · JSON
                  <ChevronRight size={16} />
                </button>
              </>
            )}
            {json && (
              <button onClick={() => setJson(false)}>
                Return to common parameters
              </button>
            )}
          </>
        )}
        {tab === "Instructions" && (
          <>
            <label className="field">
              Agent instructions
              <textarea
                aria-label="Agent instructions"
                rows={18}
                value={c.instructions ?? ""}
                onChange={(e) => change("instructions", e.target.value)}
                placeholder="Define your agent’s purpose, language, and behavior."
              />
            </label>
            {connections
              .filter(
                (connection) =>
                  connection.instructionsApproved && connection.instructions,
              )
              .map((connection) => (
                <ActionButton
                  key={connection.id}
                  action={async () => {
                    onChange({
                      ...c,
                      instructions:
                        c.instructions + "\n\n" + connection.instructions,
                      instructionSources: [
                        ...(c.instructionSources ?? []),
                        {
                          source: connection.source,
                          version: connection.sourceVersion ?? "Unavailable",
                          hash: connection.sourceHash,
                          approved: true,
                        },
                      ],
                    });
                  }}
                >
                  Add reviewed {connection.name} instructions
                </ActionButton>
              ))}
            <Notice>
              Prompt guidance is not an enforced API setting. Record the agent's
              observed behavior.
            </Notice>
            <label className="field">
              Agent language guidance
              <select
                value={
                  c.instructions?.includes("Respond in Korean.")
                    ? "ko"
                    : c.instructions?.includes("Respond in English.")
                      ? "en"
                      : ""
                }
                onChange={(e) =>
                  change(
                    "instructions",
                    (c.instructions ?? "").replace(
                      /\n?Respond in (English|Korean)\./g,
                      "",
                    ) +
                      (e.target.value
                        ? "\nRespond in " +
                          (e.target.value === "ko" ? "Korean." : "English.")
                        : ""),
                  )
                }
              >
                <option value="">Defined in instructions</option>
                <option value="en">English</option>
                <option value="ko">Korean</option>
              </select>
            </label>
          </>
        )}
        {tab === "Tools" && (
          <>
            <p className="muted">
              Select verified tools from Connections. Each write needs the
              shared action policy.
            </p>
            {connections.map((connection) => (
              <div className="tool-group" key={connection.id}>
                <strong>{connection.name}</strong>
                <p className="muted">
                  {connection.accountLabel ?? "Account not verified"} ·{" "}
                  {connection.status ?? "Needs verification"}
                </p>
                {(connection.discoveredTools ?? [])
                  .filter((tool: Json) => !!connection.tools?.[tool.name])
                  .map((tool: Json) => {
                    const selected = (c.tools ?? []).some(
                      (t: Json) =>
                        t.name === tool.name && t.connection === connection.id,
                    );
                    return (
                      <label className="check" key={tool.name}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) =>
                            change(
                              "tools",
                              e.target.checked
                                ? [
                                    ...(c.tools ?? []),
                                    {
                                      name: tool.name,
                                      connection: connection.id,
                                      description: tool.description ?? "",
                                      inputSchema: tool.inputSchema ?? {
                                        type: "object",
                                      },
                                      schemaHash: tool.schemaHash,
                                      effect:
                                        connection.tools[tool.name].effect ??
                                        tool.effect ??
                                        "write",
                                      sourceVersion:
                                        connection.sourceVersion ??
                                        connection.runtimeVersion,
                                      resource: (() => {
                                        const matches = Object.entries(
                                          connection.resourceBindings ?? {},
                                        ).filter(([, value]) =>
                                          connection.tools[
                                            tool.name
                                          ].resources?.includes(value),
                                        );
                                        return matches.length === 1
                                          ? matches[0][0]
                                          : undefined;
                                      })(),
                                    },
                                  ]
                                : (c.tools ?? []).filter(
                                    (t: Json) =>
                                      !(
                                        t.name === tool.name &&
                                        t.connection === connection.id
                                      ),
                                  ),
                            )
                          }
                        />
                        {tool.name}
                      </label>
                    );
                  })}
              </div>
            ))}
            <button onClick={onConnections}>Manage connections</button>
            <JsonEditor
              label="Tool definitions"
              value={c.tools ?? []}
              onChange={(v) => change("tools", v)}
            />
            <p className="muted">
              Writes require explicit approval. This policy also applies to
              exported agents.
            </p>
          </>
        )}
        <div className="panel-actions">
          <button
            onClick={async () => {
              setModal("history");
              try {
                const data = await api(`/agents/${agent.id}/revisions`);
                setRevisions(
                  Array.isArray(data) ? data : (data.revisions ?? []),
                );
              } catch (e) {
                setValidation({ valid: false, error: (e as Error).message });
              }
            }}
          >
            <History size={16} />
            Versions
          </button>
          <ActionButton
            action={() =>
              api(`/agents/${agent.id}/revisions`, {
                config: c,
                name: `Revision ${new Date().toLocaleString()}`,
              })
            }
          >
            Save revision
          </ActionButton>
          <ActionButton
            action={() =>
              download(`/agents/${agent.id}/export`, "sona-agent.json")
            }
          >
            <Download size={16} />
            Export agent
          </ActionButton>
        </div>
      </div>
      <footer>
        <span>
          <span
            className="status-dot"
            style={{ background: applied?.values?.length ? "#10a37f" : "#888" }}
          />
          {applied?.values?.length
            ? `Confirmed ${applied.values.filter((v: Json) => v.status === "confirmed").length} of ${applied.values.length} fields`
            : "No provider evidence"}
        </span>
        <button onClick={() => setModal("applied")}>
          Inspect <Info size={15} />
        </button>
      </footer>
      {modal === "applied" && (
        <Modal title="Configuration evidence" onClose={() => setModal("")}>
          <p>
            Requested settings, provider-returned settings, and observed
            behavior are separate evidence. A sent field is not confirmed as
            applied.
          </p>
          <pre>
            {pretty(
              applied ?? {
                status:
                  "No active provider evidence. Start a test to inspect applied values.",
              },
            )}
          </pre>
        </Modal>
      )}
      {modal === "history" && (
        <Modal title="Configuration versions" onClose={() => setModal("")}>
          <p>
            Saved revisions do not change. Restore copies a revision into the
            next-test draft.
          </p>
          {revisions.length === 0 ? (
            <p>No saved revisions.</p>
          ) : (
            revisions.map((r, index) => (
              <details key={r.id ?? index}>
                <summary>
                  {r.name ?? `Revision ${index + 1}`} ·{" "}
                  {r.createdAt ?? r.created_at}
                </summary>
                <pre>{pretty(r.config ?? r.configuration ?? r)}</pre>
                <button
                  onClick={() => {
                    onChange(r.config ?? r.configuration);
                    setModal("");
                  }}
                >
                  <Copy size={16} />
                  Copy to draft
                </button>
                <button
                  onClick={() =>
                    downloadJson(r.config ?? r.configuration, "sona-agent.json")
                  }
                >
                  <Download size={16} />
                  Export
                </button>
              </details>
            ))
          )}
        </Modal>
      )}
    </aside>
  );
}

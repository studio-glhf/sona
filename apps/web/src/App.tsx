import { useEffect, useState, type CSSProperties } from "react";
import {
  SidebarItem,
  itemLabel,
  sortedItems,
  type ItemKind,
  type SidebarPreferences,
} from "./SidebarItem";
import {
  Activity,
  BookOpen,
  Clock3,
  Code2,
  Download,
  Link,
  Menu,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  UserRound,
  X,
  Copy,
  PanelRightOpen,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Agent,
  api,
  collection,
  download,
  Json,
  Session,
  setLocalToken,
  Study,
} from "./api";
import { AgentPanel } from "./AgentPanel";
import { Connections } from "./Connections";
import { Evidence } from "./Evidence";
import { Library } from "./Library";
import { RunForm, StudyPage } from "./Studies";
import {
  ActionButton,
  Clock,
  Devices,
  Modal,
  Notice,
  Orb,
  SessionControls,
  Toggle,
  useAutosave,
} from "./components";
import { useVoice } from "./useVoice";
import { WorkspaceSettings } from "./WorkspaceSettings";

export default function App() {
  const [data, setData] = useState<Json>(null),
    [agents, setAgents] = useState<Agent[]>([]),
    [studies, setStudies] = useState<Study[]>([]),
    [sessions, setSessions] = useState<Session[]>([]),
    [connections, setConnections] = useState<Json[]>([]),
    [selected, setSelected] = useState(
      localStorage.getItem("sona-agent") ?? "",
    ),
    [page, setPage] = useState("workspace"),
    [studyId, setStudyId] = useState(""),
    [error, setError] = useState(""),
    [devices, setDevices] = useState(false),
    [run, setRun] = useState<Json>(null),
    [view, setView] = useState<"researcher" | "participant" | "handoff">(() =>
      sessionStorage.getItem("sona-view") === "participant"
        ? "handoff"
        : "researcher",
    ),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [controls, setControls] = useState(false),
    [history, setHistory] = useState<Session | null>(null),
    [rename, setRename] = useState(false),
    [nextCondition, setNextCondition] = useState<Json>(null);
  const [sidebarPrefs, setSidebarPrefs] = useState<SidebarPreferences>({});
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [management, setManagement] = useState<{
    kind: ItemKind;
    id: string;
    name: string;
    operation: "rename" | "delete";
  } | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemError, setItemError] = useState("");
  const [itemBusy, setItemBusy] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(
    () => localStorage.getItem("sona-controls-collapsed") === "true",
  );
  const [controlsWidth, setControlsWidth] = useState(() =>
    Math.max(
      300,
      Math.min(560, Number(localStorage.getItem("sona-controls-width")) || 360),
    ),
  );
  useEffect(() => {
    localStorage.setItem("sona-controls-collapsed", String(controlsCollapsed));
  }, [controlsCollapsed]);
  useEffect(() => {
    localStorage.setItem("sona-controls-width", String(controlsWidth));
  }, [controlsWidth]);
  const resizeControls = (width: number) =>
    setControlsWidth(
      Math.max(
        300,
        Math.min(
          560,
          window.innerWidth - (window.innerWidth > 1280 ? 240 : 0) - 440,
          width,
        ),
      ),
    );
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebar(false);
        setControls(false);
      }
    };
    if (sidebar || controls) document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [sidebar, controls]);
  const collapseControls = () => {
    if (window.innerWidth <= 900) setControls(false);
    else setControlsCollapsed(true);
  };
  const manageItem = async (
    kind: ItemKind,
    item: Json,
    operation: "rename" | "pin" | "delete",
  ) => {
    if (operation === "pin") {
      try {
        setSidebarPrefs(
          await api(
            `/sidebar/${kind}/${item.id}`,
            { pinned: !sidebarPrefs[`${kind}:${item.id}`]?.pinned },
            "PATCH",
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      const name = itemLabel(kind, item, sidebarPrefs);
      setItemName(name);
      setItemError("");
      setManagement({ kind, id: item.id, name, operation });
    }
  };
  const saveItem = async () => {
    if (!management) return;
    setItemBusy(true);
    setItemError("");
    try {
      if (management.operation === "rename") {
        if (management.kind === "agents" && agent?.id === management.id) {
          await api(
            `/agents/${agent.id}`,
            { name: agent.name, draft: agent.draft },
            "PATCH",
          );
        }
        setSidebarPrefs(
          await api(
            `/sidebar/${management.kind}/${management.id}`,
            { name: itemName },
            "PATCH",
          ),
        );
        if (management.kind === "agents") {
          const next = await api(`/agents/${management.id}`);
          setAgents((old) =>
            old.map((item) => (item.id === next.id ? next : item)),
          );
        } else if (management.kind === "studies") {
          const next = await api(`/studies/${management.id}`);
          setStudies((old) =>
            old.map((item) => (item.id === next.id ? next : item)),
          );
        }
      } else {
        if (
          (management.kind === "sessions" &&
            voice.session?.id === management.id) ||
          (management.kind === "studies" &&
            voice.session?.studyId === management.id)
        ) {
          if (voice.active) await voice.end();
          voice.clearSession();
        }
        await api(`/${management.kind}/${management.id}`, undefined, "DELETE");
        if (management.kind === "sessions" && history?.id === management.id)
          setHistory(null);
        if (management.kind === "studies" && studyId === management.id) {
          setStudyId("");
          setPage("workspace");
          setHistory(null);
        }
        if (management.kind === "agents" && selected === management.id) {
          setSelected("");
          setHistory(null);
        }
        await refresh();
      }
      setManagement(null);
    } catch (e) {
      setItemError((e as Error).message);
    } finally {
      setItemBusy(false);
    }
  };
  const voice = useVoice();
  const agent = agents.find((a) => a.id === selected) ?? agents[0];
  const study = studies.find((s) => s.id === studyId);
  const saved = useAutosave(
    agent ? `/agents/${agent.id}` : null,
    agent ? { name: agent.name, draft: agent.draft } : null,
  );
  const refresh = async () => {
    const result = await api("/bootstrap");
    setLocalToken(result.csrfToken);
    setData(result);
    setSidebarPrefs(result.sidebar ?? {});
    setAgents(collection(result.agents, "agents"));
    setStudies(collection(result.studies, "studies"));
    setSessions(collection(result.sessions, "sessions"));
    setConnections(collection(result.connections, "connections"));
  };
  const refreshReadiness = async () => {
    const result = await api("/bootstrap");
    setLocalToken(result.csrfToken);
    setData((previous: Json) =>
      previous
        ? {
            ...previous,
            csrfToken: result.csrfToken,
            version: result.version,
            credentials: result.credentials,
            readiness: result.readiness,
          }
        : previous,
    );
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (selected) localStorage.setItem("sona-agent", selected);
  }, [selected]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        view === "researcher"
      ) {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [view]);
  const changeView = (next: "researcher" | "participant" | "handoff") => {
    setView(next);
    sessionStorage.setItem(
      "sona-view",
      next === "researcher" ? "researcher" : "participant",
    );
    if (voice.active && next !== "handoff")
      void voice.sendEvent({ type: "view.changed", view: next });
  };
  const choose = (id: string) => {
    setSelected(id);
    setPage("workspace");
    setHistory(null);
    setSidebar(false);
  };
  const update = (draft: Json) =>
    setAgents((old) =>
      old.map((a) =>
        a.id === agent?.id ? { ...a, draft, name: draft.name ?? a.name } : a,
      ),
    );
  const createAgent = async (config?: Json) => {
    try {
      const next = await api("/agents", {
        name: config?.name ?? `Agent ${agents.length + 1}`,
        config: config ?? {
          ...data.defaultConfig,
          name: `Agent ${agents.length + 1}`,
        },
      });
      setAgents((old) => [next, ...old]);
      choose(next.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const start = async () => {
    try {
      if (!agent) return;
      await api(
        `/agents/${agent.id}`,
        { name: agent.name, draft: agent.draft },
        "PATCH",
      );
      setHistory(null);
      changeView("researcher");
      await voice.start({
        agentId: agent.id,
        config: agent.draft,
        mode: "quick",
        researcherParticipant: true,
        view: "researcher",
        devices: { input: voice.input, output: voice.output },
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const onStudyRun = async (s: Study, condition: Json, initial?: Json) => {
    try {
      const saved = await api(`/studies/${s.id}`, s, "PATCH"),
        a = agents.find((a) => a.id === condition.agentId),
        versions = a ? await api(`/agents/${a.id}/revisions`) : [],
        before = versions.find(
          (r: Json) => r.id === condition.revisionId,
        )?.configuration,
        differences =
          before && a
            ? await api("/config/diff", { before, after: a.draft })
            : [];
      const context = {
        study: saved,
        condition,
        initial,
        draft: a?.draft,
        differences,
      };
      if (
        initial &&
        !differences.length &&
        (
          await api(
            `/studies/${s.id}/consent?participantCode=${encodeURIComponent(initial.participantCode)}`,
          )
        ).applicable
      )
        await startRun(
          { ...initial, view: condition.view ?? "researcher" },
          context,
        );
      else setRun(context);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const startRun = async (values: Json, override?: Json) => {
    const context = override ?? run;
    if (!context) return;
    try {
      setRun(null);
      let condition = context.condition;
      if (values.useDraft && context.draft) {
        const revision = await api(`/agents/${condition.agentId}/revisions`, {
          config: context.draft,
          name: condition.name + " next run",
        });
        condition = { ...condition, revisionId: revision.id };
        context.study = await api(
          `/studies/${context.study.id}`,
          {
            ...context.study,
            conditions: context.study.conditions.map((c: Json) =>
              c.id === condition.id ? condition : c,
            ),
          },
          "PATCH",
        );
      }
      const chosen =
        condition.agentId ?? agents.find((a) => a.id === agent?.id)?.id;
      setPage("workspace");
      setHistory(null);
      choose(chosen);
      changeView(values.view);
      await voice.start({
        ...values,
        mode: "study",
        studyId: context.study.id,
        conditionId: condition.id,
        agentId: chosen,
        devices: { input: voice.input, output: voice.output },
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setRun({ ...context, initial: values });
    }
  };
  const openSession = async (id: string) => {
    try {
      setHistory(await api(`/sessions/${id}`));
      setPage("workspace");
      setSidebar(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const shown = history ?? voice.session;
  const status =
    voice.runtime.status === "approval-needed"
      ? "Approval needed"
      : voice.speaking
        ? "Speaking"
        : voice.runtime.status === "tool-running"
          ? "Tool running"
          : voice.active
            ? voice.muted
              ? "Microphone muted"
              : voice.state === "connecting"
                ? "Connecting"
                : voice.state === "lost"
                  ? "Connection lost"
                  : "Listening"
            : shown
              ? "Session ended"
              : "Ready when you are";
  const evidence = history?.events ?? voice.events;
  const recorded = (shown?.kind ?? shown?.mode) === "study";
  const activeStudy = recorded
    ? studies.find((s) => s.id === shown?.studyId)
    : undefined;
  useEffect(() => {
    setNextCondition(null);
    if (!activeStudy || !shown?.participantCode || voice.active) return;
    let disposed = false;
    void Promise.all([
      api(`/studies/${activeStudy.id}/assignments`),
      api("/sessions"),
    ])
      .then(([assignments, records]) => {
        if (disposed) return;
        const assignment = assignments.find(
          (a: Json) => a.participantCode === shown.participantCode,
        );
        const completed = new Set(
          records
            .filter(
              (s: Json) =>
                s.studyId === activeStudy.id &&
                s.participantCode === shown.participantCode &&
                s.state === "ended",
            )
            .map((s: Json) => s.conditionId),
        );
        const next = assignment?.order?.find(
          (id: string) => !completed.has(id),
        );
        setNextCondition(
          activeStudy.conditions.find((c: Json) => c.id === next) ?? null,
        );
      })
      .catch((e) => setError(e.message));
    return () => {
      disposed = true;
    };
  }, [shown?.id, voice.state, activeStudy?.id]);
  const sessionWithMeasures = shown
    ? {
        ...shown,
        measures: shown.snapshot.protocol?.measures ?? activeStudy?.measures,
      }
    : null;
  if (!data)
    return (
      <main className="loading">
        <h1>Sona</h1>
        {error ? (
          <Notice error>{error}</Notice>
        ) : (
          <p>Opening the local workspace…</p>
        )}
      </main>
    );
  if (view !== "researcher")
    return (
      <main className="participant">
        <header>
          <strong className="brand">Sona</strong>
          <div className="row">
            <span>
              {view === "handoff" ? "Researcher handoff" : "Participant view"}
            </span>
            {view === "participant" && (
              <button onClick={() => changeView("handoff")}>
                <UserRound size={18} />
                Researcher
              </button>
            )}
          </div>
        </header>
        <div className="participant-status">
          <p>
            {recorded ? "Transcript saved" : "Live transcript · Not saved"} ·
            Raw audio not saved
          </p>
          <Clock seconds={voice.elapsed} />
        </div>
        {view === "handoff" ? (
          <div className="handoff">
            <h1>Return to the researcher</h1>
            <p>
              Research evidence stays hidden until the researcher resumes
              control.
            </p>
            <button
              className="primary"
              onClick={() => changeView("researcher")}
            >
              Return to researcher view
            </button>
          </div>
        ) : (
          <div className="participant-voice">
            <Orb active={voice.active && !voice.muted} />
            <h1 aria-live="polite">{status}</h1>
            {!voice.active && recorded && activeStudy && (
              <ParticipantRatings
                session={shown!}
                measures={activeStudy.measures ?? []}
              />
            )}
          </div>
        )}
        {voice.error && <Notice error>{voice.error}</Notice>}
        <SessionControls
          voice={voice}
          onStart={() => changeView("handoff")}
          startLabel="Return to researcher"
          onDevices={() => setDevices(true)}
        />
        {devices && <Devices voice={voice} onClose={() => setDevices(false)} />}
      </main>
    );
  return (
    <div
      className={`app-shell ${controlsCollapsed ? "controls-collapsed" : ""}`}
      style={{ "--controls-width": `${controlsWidth}px` } as CSSProperties}
    >
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      {sidebar && (
        <button
          className="drawer-backdrop navigation-backdrop"
          aria-label="Dismiss navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      {controls && !controlsCollapsed && (
        <button
          className="drawer-backdrop inspector-backdrop"
          aria-label="Dismiss agent controls"
          onClick={() => setControls(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebar ? "open" : ""}`}
        aria-label="Workspace navigation"
      >
        <header>
          <strong className="brand">Sona</strong>
          <button
            className="icon sidebar-close"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          >
            <X />
          </button>
        </header>
        <button className="new-agent" onClick={() => void createAgent()}>
          <Plus size={19} />
          New agent
        </button>
        <label className="import-agent">
          <Upload size={16} />
          <span>Import agent</span>
          <input
            type="file"
            aria-label="Import agent"
            accept=".json,application/json"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (f) await createAgent(JSON.parse(await f.text()));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </label>
        <nav>
          <div className="nav-group">
            <h2>Agents</h2>
            {sortedItems(agents, "agents", sidebarPrefs).map((a) => (
              <SidebarItem
                key={a.id}
                name={itemLabel("agents", a, sidebarPrefs)}
                icon={<Activity size={18} />}
                selected={
                  page === "workspace" && agent?.id === a.id && !history
                }
                pinned={sidebarPrefs[`agents:${a.id}`]?.pinned}
                onSelect={() => choose(a.id)}
                onAction={(action) => void manageItem("agents", a, action)}
              />
            ))}
          </div>
          <div className="nav-group">
            <div className="section-heading">
              <h2>Studies</h2>
              <button
                className="icon"
                aria-label="New study"
                onClick={async () => {
                  try {
                    const s = await api("/studies", {
                      name: `Study ${studies.length + 1}`,
                      question: "",
                      task: "",
                      conditions: [],
                    });
                    setStudies((old) => [s, ...old]);
                    setStudyId(s.id);
                    setPage("study");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Plus size={17} />
              </button>
            </div>
            {sortedItems(studies, "studies", sidebarPrefs).map((s) => (
              <SidebarItem
                key={s.id}
                name={itemLabel("studies", s, sidebarPrefs)}
                icon={<BookOpen size={18} />}
                selected={page === "study" && studyId === s.id}
                pinned={sidebarPrefs[`studies:${s.id}`]?.pinned}
                onSelect={() => {
                  setStudyId(s.id);
                  setPage("study");
                  setSidebar(false);
                }}
                onAction={(action) => void manageItem("studies", s, action)}
              />
            ))}
          </div>
          <div className="nav-group">
            <h2>Recent sessions</h2>
            {sortedItems(sessions, "sessions", sidebarPrefs)
              .filter(
                (s, index) =>
                  showAllSessions ||
                  index < 8 ||
                  sidebarPrefs[`sessions:${s.id}`]?.pinned,
              )
              .map((s) => (
                <SidebarItem
                  key={s.id}
                  name={itemLabel("sessions", s, sidebarPrefs)}
                  icon={<Clock3 size={17} />}
                  detail={`${s.startedAt ? new Date(s.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""} / ${s.kind === "quick" ? "Quick test" : "Study"}`}
                  selected={(history?.id ?? voice.session?.id) === s.id}
                  pinned={sidebarPrefs[`sessions:${s.id}`]?.pinned}
                  onSelect={() => void openSession(s.id)}
                  onAction={(action) => void manageItem("sessions", s, action)}
                />
              ))}
            {sessions.length > 8 && (
              <button
                className="show-sessions"
                onClick={() => setShowAllSessions((v) => !v)}
              >
                {showAllSessions
                  ? "Show fewer sessions"
                  : `Show all ${sessions.length} sessions`}
              </button>
            )}
          </div>
        </nav>
        <div className="nav-bottom">
          <button
            onClick={() => setPage("library")}
            className={page === "library" ? "selected" : ""}
          >
            <Code2 size={19} />
            API library
          </button>
          <button
            onClick={() => setPage("connections")}
            className={page === "connections" ? "selected" : ""}
          >
            <Link size={19} />
            Connections
          </button>
          <button
            onClick={() => setPage("settings")}
            className={page === "settings" ? "selected" : ""}
          >
            <Settings size={19} />
            Settings
          </button>
          <button onClick={() => setSearch(true)}>
            <Search size={18} />
            Search <kbd>⌘/Ctrl K</kbd>
          </button>
        </div>
      </aside>
      <main id="main" className="main">
        <div className="mobile-toolbar">
          <button aria-label="Open navigation" onClick={() => setSidebar(true)}>
            <Menu size={19} />
          </button>
          <span>Sona</span>
          {page === "workspace" && agent && (
            <button
              aria-expanded={controls}
              onClick={() => {
                setControlsCollapsed(false);
                setControls(true);
              }}
            >
              <SlidersHorizontal size={18} />
              Agent controls
            </button>
          )}
        </div>
        {error && <Notice error>{error}</Notice>}
        {
          <div className="surface" hidden={page !== "workspace"}>
            {agent ? (
              <>
                <header className="workspace-header">
                  <div>
                    <button
                      className="title-button"
                      onClick={() => setRename(true)}
                      disabled={Boolean(shown)}
                    >
                      <h1>
                        {shown
                          ? (sidebarPrefs[`sessions:${shown.id}`]?.name ??
                            shown.snapshot?.configuration?.name ??
                            agent.name)
                          : itemLabel("agents", agent, sidebarPrefs)}
                      </h1>
                    </button>
                    <span className="badge">
                      {recorded ? "Study run" : "Quick test"}
                    </span>
                    <p>
                      Researcher view
                      {shown
                        ? ` · Snapshot ${shown.snapshot?.configurationHash?.slice(0, 8) ?? shown.id.slice(0, 8)}`
                        : ""}
                    </p>
                  </div>
                  <Toggle
                    label="Participant view"
                    checked={false}
                    onChange={() => changeView("participant")}
                  />
                </header>
                <section className="voice-area" aria-label="Voice session">
                  <Orb active={voice.active && !voice.muted} />
                  <h2 aria-live="polite">
                    {history ? "Saved session" : status}
                  </h2>
                  <Clock seconds={voice.elapsed} />
                  <p className="recording-state">
                    <span className="status-dot" />
                    {recorded
                      ? "Study transcript saved"
                      : "Live transcript · Not saved"}
                    <span className="recording-detail">
                      Raw audio not saved
                      {(shown?.snapshot?.configuration ?? agent.draft).settings
                        ?.audio?.input?.transcription
                        ? " · Input transcription on"
                        : " · Input transcription off"}
                    </span>
                  </p>
                  {!voice.active && !data.readiness.openaiConfigured && (
                    <button
                      className="readiness-link"
                      onClick={() => setPage("settings")}
                    >
                      Add API key
                    </button>
                  )}
                  {voice.error && (
                    <Notice error>
                      {voice.error}
                      {voice.error.includes("playback") ? (
                        <button onClick={() => void voice.resumeAudio()}>
                          Resume audio
                        </button>
                      ) : (
                        <button onClick={() => setDevices(true)}>
                          Check microphone
                        </button>
                      )}
                    </Notice>
                  )}
                  <SessionControls
                    voice={voice}
                    onStart={() => void start()}
                    onDevices={() => setDevices(true)}
                  />
                </section>
                <Evidence
                  events={evidence}
                  session={sessionWithMeasures}
                  runtime={
                    history
                      ? { metrics: history.metrics, actions: history.actions }
                      : voice.runtime
                  }
                  active={voice.active}
                />
                {shown && !voice.active && (
                  <section
                    className="session-record-actions"
                    aria-label="Session record actions"
                  >
                    {recorded && nextCondition && activeStudy && (
                      <button
                        className="primary"
                        onClick={() =>
                          void onStudyRun(activeStudy, nextCondition, {
                            participantCode: shown.participantCode,
                            researcherParticipant: shown.researcherParticipant,
                          })
                        }
                      >
                        Start next run · {nextCondition.name}
                      </button>
                    )}
                    {recorded && (
                      <ActionButton
                        action={() =>
                          download(
                            `/sessions/${shown.id}/export`,
                            "sona-session.json",
                          )
                        }
                      >
                        <Download size={16} />
                        Export session
                      </ActionButton>
                    )}
                    <button
                      className="session-delete"
                      onClick={() =>
                        void manageItem("sessions", shown, "delete")
                      }
                    >
                      <Trash2 size={15} />
                      Delete session
                    </button>
                  </section>
                )}
              </>
            ) : (
              <div className="welcome">
                <Orb />
                <h1>A workspace for voice experiments</h1>
                <p>
                  Create a use-case-neutral agent, connect tools, then test its
                  behavior with your voice.
                </p>
                <button className="primary" onClick={() => void createAgent()}>
                  <Plus size={18} />
                  Create an agent
                </button>
              </div>
            )}
          </div>
        }
        <div className="surface" hidden={page !== "connections"}>
          <Connections connections={connections} onRefresh={refresh} />
        </div>
        <div className="surface" hidden={page !== "library"}>
          <Library />
        </div>
        {studies.map((item) => (
          <div
            className="surface"
            key={item.id}
            hidden={page !== "study" || studyId !== item.id}
          >
            <StudyPage
              study={{
                ...item,
                name: itemLabel("studies", item, sidebarPrefs),
              }}
              agents={agents}
              visible={page === "study" && studyId === item.id}
              sessionRevision={sessions
                .map((s) => `${s.id}:${s.state}`)
                .join(":")}
              onChange={(next) =>
                setStudies((old) =>
                  old.map((s) => (s.id === next.id ? next : s)),
                )
              }
              onRun={(s, c) => void onStudyRun(s, c)}
              onSession={(id) => void openSession(id)}
              onDelete={async (id) => {
                if (voice.active && voice.session?.studyId === id)
                  await voice.end();
                await api(`/studies/${id}`, undefined, "DELETE");
                setStudyId("");
                setPage("workspace");
                await refresh();
              }}
            />
          </div>
        ))}
        {page === "settings" && (
          <WorkspaceSettings
            version={data.version}
            active={voice.active}
            onRefresh={refreshReadiness}
            onCredentialChange={(configured) =>
              setData((previous: Json) =>
                previous
                  ? {
                      ...previous,
                      credentials: {
                        openai: {
                          configured,
                          source: configured ? "session" : "none",
                          storage: "memory",
                        },
                      },
                      readiness: {
                        ...previous.readiness,
                        openaiConfigured: configured,
                        modelsVerified: [],
                        missing: configured
                          ? []
                          : ["Add your OpenAI API key in Settings."],
                      },
                    }
                  : previous,
              )
            }
            onDevices={() => setDevices(true)}
            onLibrary={() => setPage("library")}
          />
        )}
      </main>
      {agent && (
        <div
          hidden={page !== "workspace"}
          className={`controls-wrap ${controls ? "open" : ""} ${controlsCollapsed ? "collapsed" : ""}`}
        >
          {controlsCollapsed && (
            <button
              className="controls-expand"
              aria-label="Expand agent controls"
              onClick={() => {
                setControlsCollapsed(false);
              }}
            >
              <PanelRightOpen size={20} />
              <span>Agent controls</span>
            </button>
          )}
          {!controlsCollapsed && (
            <div
              className="controls-resize"
              role="separator"
              aria-label="Resize agent controls"
              aria-orientation="vertical"
              aria-valuemin={300}
              aria-valuemax={560}
              aria-valuenow={controlsWidth}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                document.body.classList.add("resizing-controls");
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  resizeControls(window.innerWidth - e.clientX);
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                document.body.classList.remove("resizing-controls");
              }}
              onLostPointerCapture={() =>
                document.body.classList.remove("resizing-controls")
              }
              onDoubleClick={() => setControlsWidth(360)}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  resizeControls(
                    e.key === "Home"
                      ? 300
                      : e.key === "End"
                        ? 560
                        : controlsWidth + (e.key === "ArrowLeft" ? 20 : -20),
                  );
                }
              }}
            />
          )}
          <div
            className="controls-content"
            hidden={controlsCollapsed}
            id="agent-controls-content"
          >
            <AgentPanel
              onCollapse={collapseControls}
              agent={agent}
              onChange={update}
              saving={saved}
              active={voice.active}
              applied={
                history?.providerEvidence ?? voice.runtime.providerEvidence
              }
              connections={connections}
              onConnections={() => setPage("connections")}
            />
          </div>
        </div>
      )}
      {devices && <Devices voice={voice} onClose={() => setDevices(false)} />}{" "}
      {run && (
        <RunForm
          study={run.study}
          condition={run.condition}
          initial={run.initial}
          differences={run.differences}
          retentionDays={data.settings.retentionDays}
          onStart={(values) => void startRun(values)}
          onClose={() => setRun(null)}
        />
      )}{" "}
      {management && (
        <Modal
          title={`${management.operation === "rename" ? "Rename" : "Delete"} ${{ agents: "agent", studies: "study", sessions: "session" }[management.kind]}`}
          onClose={() => {
            if (!itemBusy) setManagement(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveItem();
            }}
          >
            {management.operation === "rename" ? (
              <label className="field">
                Name
                <input
                  autoFocus
                  aria-label="Name"
                  maxLength={120}
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  required
                />
                <small>
                  This label helps organize your workspace. Recorded experiment
                  snapshots stay fixed.
                </small>
              </label>
            ) : (
              <>
                <p>Delete “{management.name}” from this local workspace?</p>
                <p className="muted">
                  {management.kind === "studies"
                    ? "This also deletes the study’s runs, assignments, consent records, and local evidence."
                    : management.kind === "agents"
                      ? "Agents referenced by sessions or study conditions are protected. Remove those references before deleting the agent."
                      : "This permanently removes the local session and its evidence. A running voice session will end first."}{" "}
                  Exports and external actions are separate.
                </p>
              </>
            )}
            {itemError && (
              <p role="alert" className="error-text">
                {itemError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={itemBusy}
                onClick={() => setManagement(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={
                  management.operation === "delete" ? "danger" : "primary"
                }
                disabled={
                  itemBusy ||
                  (management.operation === "rename" && !itemName.trim())
                }
              >
                {itemBusy
                  ? "Saving…"
                  : management.operation === "rename"
                    ? "Save name"
                    : `Delete ${{ agents: "agent", studies: "study", sessions: "session" }[management.kind]}`}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {rename && agent && (
        <Modal title="Agent details" onClose={() => setRename(false)}>
          <label className="field">
            Agent name
            <input
              value={agent.name}
              onChange={(e) => update({ ...agent.draft, name: e.target.value })}
            />
          </label>
          <ActionButton
            action={async () => {
              const next = await api(`/agents/${agent.id}/duplicate`, {
                name: `${agent.name} copy`,
              });
              await refresh();
              choose(next.id);
              setRename(false);
            }}
          >
            <Copy size={16} />
            Duplicate agent
          </ActionButton>
          <ActionButton
            action={async () => {
              await api(`/agents/${agent.id}`, undefined, "DELETE");
              setRename(false);
              await refresh();
            }}
          >
            <Trash2 size={16} />
            Delete agent
          </ActionButton>
        </Modal>
      )}
      {search && (
        <Modal title="Workspace search" onClose={() => setSearch(false)}>
          <label className="field">
            Search agents and studies
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {agents
            .filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
            .map((a) => (
              <button
                className="full"
                key={a.id}
                onClick={() => {
                  choose(a.id);
                  setSearch(false);
                }}
              >
                {a.name}
              </button>
            ))}
          {studies
            .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
            .map((s) => (
              <button
                className="full"
                key={s.id}
                onClick={() => {
                  setStudyId(s.id);
                  setPage("study");
                  setSearch(false);
                }}
              >
                {s.name}
              </button>
            ))}
        </Modal>
      )}
    </div>
  );
}
function ParticipantRatings({
  session,
  measures,
}: {
  session: Session;
  measures: Json[];
}) {
  const [ratings, setRatings] = useState<Json>(session.outcome?.ratings ?? {});
  const saved = useAutosave(`/sessions/${session.id}`, {
    outcome: { ratings },
  });
  return (
    <section className="participant-ratings">
      <h2>Session ratings</h2>
      {measures.map((m) => (
        <label className="field" key={m.id}>
          {m.question}
          <select
            value={ratings[m.id] ?? ""}
            onChange={(e) =>
              setRatings({
                ...ratings,
                [m.id]: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          >
            <option value="">Skip / missing</option>
            {Array.from({ length: m.max - m.min + 1 }, (_, i) => i + m.min).map(
              (n) => (
                <option key={n} value={n}>
                  {n}
                  {n === m.min
                    ? ` — ${m.lowAnchor}`
                    : n === m.max
                      ? ` — ${m.highAnchor}`
                      : ""}
                </option>
              ),
            )}
          </select>
        </label>
      ))}
      <span role="status">{saved}</span>
    </section>
  );
}

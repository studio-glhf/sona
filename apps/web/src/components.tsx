import { useEffect, useRef, useState, ReactNode } from "react";
import { X, Volume2, Mic, MicOff, Square, Play, RotateCcw } from "lucide-react";
import { api, Json, pretty } from "./api";
import { Voice } from "./useVoice";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const source = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.querySelector<HTMLElement>("button,input,select,textarea")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const nodes = [
          ...(dialog?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
          ) ?? []),
        ];
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      source?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function JsonEditor({
  value,
  onChange,
  label = "JSON",
  rows = 16,
}: {
  value: Json;
  onChange: (v: Json) => void;
  label?: string;
  rows?: number;
}) {
  const [text, setText] = useState(pretty(value)),
    [error, setError] = useState("");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(pretty(value));
  }, [value]);
  return (
    <label className="field">
      {label}
      <textarea
        className="code"
        rows={rows}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            setError("");
            onChange(parsed);
          } catch {
            setError("Enter valid JSON. The last valid draft stays saved.");
          }
        }}
        spellCheck={false}
      />
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={error ? "notice error" : "notice"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch-label">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}
export function Devices({
  voice,
  onClose,
}: {
  voice: Voice;
  onClose: () => void;
}) {
  const [feedback, setFeedback] = useState<{
    state: "idle" | "checking" | "success" | "error";
    message: string;
  }>({ state: "idle", message: "" });
  const mounted = useRef(false);
  const request = useRef(0);
  const probeAbort = useRef<AbortController | null>(null);
  const previousInput = useRef(voice.input);
  useEffect(() => {
    mounted.current = true;
    const current = request.current;
    void voice.refreshDevices().catch(() => {
      if (mounted.current && current === request.current)
        setFeedback({
          state: "error",
          message:
            "Could not list audio devices. Check microphone permission to try again.",
        });
    });
    return () => {
      mounted.current = false;
      probeAbort.current?.abort();
      request.current++;
    };
  }, []);
  useEffect(() => {
    if (previousInput.current === voice.input) return;
    previousInput.current = voice.input;
    request.current++;
    setFeedback({ state: "idle", message: "" });
  }, [voice.input]);
  const checkMicrophone = async () => {
    if (feedback.state === "checking") return;
    const current = ++request.current;
    const report = (state: "success" | "error", message: string) => {
      if (mounted.current && current === request.current)
        setFeedback({ state, message });
    };
    setFeedback({ state: "checking", message: "Checking microphone access…" });
    if (!navigator.mediaDevices?.getUserMedia) {
      report(
        "error",
        "This browser cannot check microphone access. Open Sona in desktop Chrome on localhost.",
      );
      return;
    }
    const controller = new AbortController();
    probeAbort.current = controller;
    try {
      await voice.checkMicrophone(controller.signal);
    } catch (failure) {
      const name = failure instanceof Error ? failure.name : "";
      report(
        "error",
        ["NotAllowedError", "SecurityError"].includes(name)
          ? "Allow microphone access for Sona in your browser and system settings. Then try again."
          : ["NotFoundError", "DevicesNotFoundError"].includes(name)
            ? "No microphone is available. Connect a microphone, then try again."
            : ["TimeoutError", "InvalidStateError"].includes(name)
              ? (failure as Error).message
              : name === "OverconstrainedError"
                ? "The selected microphone is unavailable. Choose another microphone, then try again."
                : [
                      "NotReadableError",
                      "TrackStartError",
                      "AbortError",
                    ].includes(name)
                  ? "Chrome could not open the microphone. Check its permission prompt, then try again."
                  : "Could not check microphone access. Check your device and browser settings, then try again.",
      );
      return;
    } finally {
      if (probeAbort.current === controller) probeAbort.current = null;
    }
    if (!mounted.current || current !== request.current) return;
    try {
      await voice.refreshDevices();
      report("success", "Microphone access works. Your microphone is ready.");
    } catch {
      report(
        "success",
        "Microphone access works. The device list could not refresh. Close and reopen Devices to refresh it.",
      );
    }
  };
  return (
    <Modal title="Devices" onClose={onClose}>
      <label className="field">
        Microphone
        <select
          value={voice.input}
          disabled={feedback.state === "checking" || !!voice.deviceBusy}
          onChange={(e) => void voice.changeInput(e.target.value)}
        >
          <option value="">System microphone</option>
          {voice.devices
            .filter((d) => d.kind === "audioinput")
            .map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
      {voice.outputSupported ? (
        <label className="field">
          Output
          <select
            value={voice.output}
            disabled={feedback.state === "checking" || !!voice.deviceBusy}
            onChange={(e) => void voice.changeOutput(e.target.value)}
          >
            <option value="">System output</option>
            {voice.devices
              .filter((d) => d.kind === "audiooutput")
              .map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Output ${i + 1}`}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <label className="field">
          Output<div className="static-field">System output</div>
          <small>Change output in system settings.</small>
        </label>
      )}
      <p className="muted">
        A device change during a study is recorded. Device names appear after
        microphone permission.
      </p>
      <button
        disabled={feedback.state === "checking" || !!voice.deviceBusy}
        onClick={() => void checkMicrophone()}
      >
        {feedback.state === "checking"
          ? "Checking…"
          : "Check microphone permission"}
      </button>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={feedback.state === "error" ? "error-text" : "muted"}
      >
        {voice.deviceBusy
          ? voice.deviceBusy === "input"
            ? "Switching microphone…"
            : "Switching speaker…"
          : voice.deviceFeedback || feedback.message}
      </p>
    </Modal>
  );
}
export function SessionControls({
  voice,
  onStart,
  onDevices,
  startLabel = "Start quick test",
}: {
  voice: Voice;
  onStart: () => void;
  onDevices: () => void;
  startLabel?: string;
}) {
  return (
    <div className="call-controls">
      <button disabled={!voice.active} onClick={voice.mute}>
        {voice.muted ? <MicOff /> : <Mic />}
        <span>{voice.muted ? "Unmute" : "Mute"}</span>
      </button>
      <button onClick={onDevices}>
        <Volume2 />
        <span>Devices</span>
      </button>
      {voice.active &&
        (voice.runtime.controls ?? []).map((command: string) => (
          <button key={command} onClick={() => void voice.turnControl(command)}>
            {command === "finish-turn"
              ? "Finish turn"
              : command === "respond"
                ? "Request response"
                : "Stop speech"}
          </button>
        ))}
      {voice.state === "lost" ? (
        <button className="primary" onClick={() => void voice.reconnect()}>
          <RotateCcw size={18} />
          Reconnect
        </button>
      ) : null}
      {voice.active ? (
        <button className="danger" onClick={() => void voice.end()}>
          <Square size={18} />
          <span>End session</span>
        </button>
      ) : (
        <button className="primary" onClick={onStart}>
          <Play size={18} />
          <span>{startLabel}</span>
        </button>
      )}
    </div>
  );
}
export function Clock({ seconds }: { seconds: number }) {
  return (
    <span className="clock">
      {Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0")}
      :{(seconds % 60).toString().padStart(2, "0")}
    </span>
  );
}
export function Orb({ active = false }: { active?: boolean }) {
  return (
    <div className={`orb ${active ? "orb-active" : ""}`} aria-hidden="true">
      <span />
    </div>
  );
}
export function ActionButton({
  children,
  action,
  onDone,
  disabled = false,
}: {
  children: ReactNode;
  action: () => Promise<unknown>;
  onDone?: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await action();
            onDone?.();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Please wait…" : children}
      </button>
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
export function SaveState({ status }: { status: string }) {
  return (
    <span
      className={`save-state ${status.includes("failed") ? "error-text" : ""}`}
      role="status"
    >
      {status}
    </span>
  );
}
const saveQueues = new Map<string, Promise<unknown>>();
function saveDraft(path: string, value: Json) {
  const prior = saveQueues.get(path) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(() => api(path, value, "PATCH"));
  saveQueues.set(path, next);
  void next
    .finally(() => {
      if (saveQueues.get(path) === next) saveQueues.delete(path);
    })
    .catch(() => {});
  return next;
}
export function useAutosave(path: string | null, value: Json, delay = 700) {
  const [status, setStatus] = useState("Saved"),
    first = useRef(true),
    latest = useRef(""),
    pending = useRef<{ path: string; value: Json; json: string } | null>(null);
  useEffect(() => {
    first.current = true;
    latest.current = "";
    setStatus("Saved");
    return () => {
      const item = pending.current;
      if (item?.path === path) {
        pending.current = null;
        void saveDraft(item.path, item.value).catch(() => {});
      }
    };
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const json = pretty(value);
    if (first.current) {
      first.current = false;
      latest.current = json;
      return;
    }
    if (json === latest.current) return;
    pending.current = { path, value, json };
    setStatus("Saving…");
    const timer = setTimeout(() => {
      const item = pending.current;
      if (!item || item.path !== path) return;
      pending.current = null;
      void saveDraft(path, item.value)
        .then(() => {
          latest.current = item.json;
          if (!pending.current) setStatus("Saved");
        })
        .catch((e) => {
          pending.current = item;
          setStatus("Save failed: " + e.message);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [path, value, delay]);
  return status;
}

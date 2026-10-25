import { openMicrophone } from "./microphone";
import {
  effectiveDeviceId,
  matchesMicrophone,
  releaseMicrophone,
} from "./media-devices";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Json, Session } from "./api";
import { prepareAudioOutput } from "./audio-output";
import { waitForPeerConnection } from "./peer-ready";

type ConnectionState = "idle" | "connecting" | "connected" | "lost" | "ended";
export function useVoice() {
  const [session, setSession] = useState<Session | null>(null),
    [state, setState] = useState<ConnectionState>("idle"),
    [muted, setMuted] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [error, setError] = useState(""),
    [events, setEvents] = useState<Json[]>([]),
    [runtime, setRuntime] = useState<Json>({}),
    [elapsed, setElapsed] = useState(0),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState(localStorage.getItem("sona-input") ?? ""),
    [output, setOutput] = useState(localStorage.getItem("sona-output") ?? "");
  const [deviceBusy, setDeviceBusy] = useState<"input" | "output" | null>(null);
  const [deviceFeedback, setDeviceFeedback] = useState("");
  const inputOperation = useRef(0),
    outputOperation = useRef(0);
  const captureAbort = useRef<AbortController | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    channel = useRef<RTCDataChannel | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    current = useRef<Session | null>(null),
    generation = useRef(0),
    mutedRef = useRef(false),
    started = useRef(0),
    eventIds = useRef(new Set<string>()),
    seq = useRef(0);
  const append = useCallback((event: Json) => {
    const id = event.id ?? event.event_id;
    if (id && eventIds.current.has(id)) return;
    if (id) eventIds.current.add(id);
    setEvents((old) => [...old, event].slice(-5000));
  }, []);
  const sendEvent = useCallback(
    async (event: Json) => {
      append(event);
      const s = current.current;
      if (s)
        await api(`/sessions/${s.id}/events`, {
          events: [
            {
              ...event,
              source: event.source ?? "browser",
              clientTimestamp: performance.now(),
              sequence: ++seq.current,
            },
          ],
        }).catch((e) => {
          if (current.current?.id === s.id)
            setError(`Evidence storage: ${e.message}`);
        });
    },
    [append],
  );
  const stopMedia = useCallback(() => {
    captureAbort.current?.abort();
    captureAbort.current = null;
    inputOperation.current++;
    outputOperation.current++;
    setDeviceBusy(null);
    const previous = stream.current;
    stream.current = null;
    releaseMicrophone(previous);
    channel.current?.close();
    channel.current = null;
    peer.current?.close();
    peer.current = null;
    if (audio.current) {
      audio.current.pause();
      audio.current.srcObject = null;
      audio.current = null;
    }
    setSpeaking(false);
  }, []);
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices)
      throw new Error(
        "Microphone access needs localhost and a supported browser.",
      );
    setDevices(await navigator.mediaDevices.enumerateDevices());
  }, []);
  const end = useCallback(async () => {
    const token = ++generation.current;
    stopMedia();
    setState("ended");
    const s = current.current;
    current.current = null;
    if (s) {
      try {
        const result = await api(`/sessions/${s.id}/end`, {});
        if (token === generation.current)
          setSession((old) => ({ ...old, ...result }));
      } catch (e) {
        if (token === generation.current) setError((e as Error).message);
      }
    }
  }, [stopMedia]);
  const connect = useCallback(
    async (s: Session, token: number) => {
      let stage = "Microphone access";
      console.info("Sona connection stage:", stage);
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            "This browser cannot open a microphone. Use desktop Chrome on localhost.",
          );
        const controller = new AbortController();
        captureAbort.current = controller;
        const requestedInput = effectiveDeviceId(input, "audioinput", devices);
        const media = await openMicrophone(
          () =>
            navigator.mediaDevices.getUserMedia({
              audio: {
                ...(requestedInput
                  ? { deviceId: { exact: requestedInput } }
                  : {}),
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: false,
            }),
          15000,
          controller.signal,
        );
        if (token !== generation.current) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        media.getAudioTracks().forEach((track) => {
          track.enabled = false;
          track.onended = () => {
            if (token !== generation.current || stream.current !== media)
              return;
            setError(
              "The microphone disconnected. Select a device to repair input.",
            );
            setMuted(true);
            void sendEvent({ type: "device.lost", device: "input", gap: true });
          };
        });
        stage = "Device discovery";
        console.info("Sona connection stage:", stage);
        await refreshDevices();
        if (token !== generation.current) return;
        const pc = new RTCPeerConnection();
        peer.current = pc;
        stage = "Speaker selection";
        console.info("Sona connection stage:", stage);
        const selected = await prepareAudioOutput(
          audio.current ?? new Audio(),
          effectiveDeviceId(output, "audiooutput", devices),
          () => new Audio(),
        );
        if (token !== generation.current) {
          selected.player.pause();
          return;
        }
        const player = selected.player;
        audio.current = player;
        if (selected.fallback) {
          setOutput("");
          localStorage.removeItem("sona-output");
          void sendEvent({
            type: "device.changed",
            device: "output",
            success: true,
            fallback: true,
            message: "Saved speaker unavailable. Using system output.",
          });
        }
        pc.ontrack = (event) => {
          console.info("Sona media: remote audio track received");
          if (token !== generation.current || pc !== peer.current) return;
          const activePlayer = audio.current ?? player;
          activePlayer.srcObject =
            event.streams[0] ?? new MediaStream([event.track]);
          void activePlayer
            .play()
            .then(() => {
              if (
                token === generation.current &&
                pc === peer.current &&
                audio.current === activePlayer
              )
                return sendEvent({ type: "playback.ready" });
            })
            .catch(() => {
              if (
                token !== generation.current ||
                pc !== peer.current ||
                audio.current !== activePlayer
              )
                return;
              setError("Audio playback is blocked. Select Resume audio.");
              void sendEvent({ type: "playback.failed" });
            });
        };
        pc.onconnectionstatechange = () => {
          if (pc !== peer.current) return;
          console.info(
            "Sona media:",
            pc.connectionState,
            pc.iceConnectionState,
          );
          // The ready endpoint confirms provider settings before exposing connected.
          if (["failed", "disconnected"].includes(pc.connectionState)) {
            setState("lost");
            stream.current?.getTracks().forEach((t) => t.stop());
            void sendEvent({ type: "connection.lost", gap: true });
          }
        };
        media.getTracks().forEach((track) => pc.addTrack(track, media));
        stage = "Create browser offer";
        console.info("Sona connection stage:", stage);
        const offer = await pc.createOffer();
        stage = "Prepare browser connection";
        console.info("Sona connection stage:", stage);
        await pc.setLocalDescription(offer);
        if (token !== generation.current) return;
        stage = "Provider connection";
        console.info("Sona connection stage:", stage);
        const answer = await api(`/sessions/${s.id}/connect`, {
          sdp: offer.sdp,
        });
        if (token !== generation.current) return;
        stage = "Accept provider answer";
        console.info("Sona connection stage:", stage);
        await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
        stage = "Establish browser media";
        console.info("Sona connection stage:", stage);
        await waitForPeerConnection(pc);
        stage = "Confirm provider settings";
        console.info("Sona connection stage:", stage);
        await api(`/sessions/${s.id}/ready`, {});
        if (token !== generation.current) return;
        if (
          !media.getAudioTracks().some((track) => track.readyState === "live")
        )
          throw new Error(
            "The microphone ended during connection. Open Devices to check it, then start again.",
          );
        setState("connected");
        media.getAudioTracks().forEach((track) => {
          track.enabled = !mutedRef.current;
        });
        localStorage.setItem("sona-input", input);
        started.current = Date.now();
        await sendEvent({
          type: "device.context",
          input: media.getAudioTracks()[0]?.getSettings(),
          browser: navigator.userAgent,
          outputDevice: output || "System output",
        });
      } catch (error) {
        throw new Error(
          `${stage}: ${error instanceof Error ? error.message : "Operation failed."}`,
        );
      }
    },
    [append, input, output, devices, refreshDevices, sendEvent],
  );
  const start = useCallback(
    async (options: Json) => {
      const token = ++generation.current;
      stopMedia();
      setError("");
      setEvents([]);
      eventIds.current.clear();
      setRuntime({});
      setElapsed(0);
      setMuted(false);
      mutedRef.current = false;
      setState("connecting");
      try {
        const result = await api("/sessions", options);
        const s = result.session ?? result;
        if (token !== generation.current) {
          await api(`/sessions/${s.id}/end`, {});
          return;
        }
        setSession(s);
        current.current = s;
        await connect(s, token);
      } catch (e) {
        if (token !== generation.current) return;
        stopMedia();
        setState("ended");
        setError((e as Error).message);
        if (current.current)
          await api(`/sessions/${current.current.id}/end`, {
            reason: "connection_failed",
          }).catch(() => {});
        if (token !== generation.current) return;
        current.current = null;
        throw e;
      }
    },
    [connect, stopMedia],
  );
  const reconnect = useCallback(async () => {
    const s = current.current ?? session;
    if (!s) return;
    const token = ++generation.current;
    stopMedia();
    setState("connecting");
    setError("");
    try {
      const result = await api(`/sessions/${s.id}/reconnect`, {});
      const linked = result.session ?? result;
      if (token !== generation.current) {
        await api(`/sessions/${linked.id}/end`, {});
        return;
      }
      current.current = linked;
      setSession(linked);
      await connect(linked, token);
    } catch (e) {
      if (token !== generation.current) return;
      stopMedia();
      setState("lost");
      setError((e as Error).message);
    }
  }, [connect, session, stopMedia]);
  const mute = useCallback(() => {
    const next = !muted;
    mutedRef.current = next;
    stream.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
    void sendEvent({ type: "microphone.mute", muted: next });
  }, [sendEvent, muted]);
  const changeInput = useCallback(
    async (id: string): Promise<boolean> => {
      const token = generation.current,
        operation = ++inputOperation.current;
      const currentPeer = peer.current,
        oldMedia = stream.current;
      const live = oldMedia?.getAudioTracks()[0];
      setDeviceFeedback("");
      if (
        !currentPeer ||
        !current.current ||
        (live?.readyState === "live" &&
          (id === input || matchesMicrophone(live, id, devices)))
      ) {
        setInput(id);
        localStorage.setItem("sona-input", id);
        return true;
      }
      setDeviceBusy("input");
      let replacement: MediaStream | undefined;
      try {
        const controller = new AbortController();
        captureAbort.current?.abort();
        captureAbort.current = controller;
        const effective = effectiveDeviceId(id, "audioinput", devices);
        replacement = await openMicrophone(
          () =>
            navigator.mediaDevices.getUserMedia({
              audio: {
                ...(effective ? { deviceId: { exact: effective } } : {}),
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: false,
            }),
          15000,
          controller.signal,
        );
        if (
          token !== generation.current ||
          operation !== inputOperation.current ||
          peer.current !== currentPeer
        ) {
          releaseMicrophone(replacement);
          return false;
        }
        const track = replacement.getAudioTracks()[0];
        if (!track || track.readyState !== "live")
          throw new Error(
            "The selected microphone did not provide a live track.",
          );
        const sender = currentPeer
          .getSenders()
          .find((sender) => sender.track?.kind === "audio");
        if (!sender)
          throw new Error(
            "The voice connection needs to be restarted before replacing its microphone.",
          );
        track.enabled = !mutedRef.current;
        await sender.replaceTrack(track);
        if (
          token !== generation.current ||
          operation !== inputOperation.current ||
          peer.current !== currentPeer
        ) {
          releaseMicrophone(replacement);
          return false;
        }
        stream.current = replacement;
        const owned = replacement;
        track.onended = () => {
          if (token !== generation.current || stream.current !== owned) return;
          setMuted(true);
          setError(
            "The microphone disconnected. Open Devices and check the microphone to reconnect it.",
          );
          void sendEvent({ type: "device.lost", device: "input", gap: true });
        };
        releaseMicrophone(oldMedia);
        setInput(id);
        localStorage.setItem("sona-input", id);
        setMuted(mutedRef.current);
        setError("");
        await sendEvent({
          type: "device.changed",
          device: "input",
          deviceId: id,
          success: true,
          gap: true,
          label: track.label ?? id,
          settings: track.getSettings(),
          muted: mutedRef.current,
        });
        return true;
      } catch (e) {
        releaseMicrophone(replacement);
        if (
          token !== generation.current ||
          operation !== inputOperation.current
        )
          return false;
        const message = (e as Error).message;
        setDeviceFeedback(
          `Microphone change failed. ${oldMedia?.getAudioTracks()[0]?.readyState === "live" ? "Your current microphone is still active. " : ""}${message}`,
        );
        if (oldMedia?.getAudioTracks()[0]?.readyState !== "live")
          setError(message);
        return false;
      } finally {
        if (
          token === generation.current &&
          operation === inputOperation.current
        )
          setDeviceBusy(null);
      }
    },
    [input, devices, sendEvent],
  );
  const checkMicrophone = useCallback(
    async (signal?: AbortSignal) => {
      setDeviceFeedback("");
      if (
        stream.current
          ?.getAudioTracks()
          .some((track) => track.readyState === "live")
      )
        return { reused: true, repaired: false };
      if (peer.current && current.current) {
        if (!(await changeInput(input)))
          throw new Error(
            "The session microphone could not reconnect. Your existing connection was preserved.",
          );
        return { reused: false, repaired: true };
      }
      const effective = effectiveDeviceId(input, "audioinput", devices);
      const probe = await openMicrophone(
        () =>
          navigator.mediaDevices.getUserMedia({
            audio: effective ? { deviceId: { exact: effective } } : true,
            video: false,
          }),
        15000,
        signal,
      );
      try {
        if (
          !probe.getAudioTracks().some((track) => track.readyState === "live")
        )
          throw new DOMException("", "NotReadableError");
      } finally {
        releaseMicrophone(probe);
      }
      return { reused: false, repaired: false };
    },
    [input, devices, changeInput],
  );
  const changeOutput = useCallback(
    async (id: string) => {
      const token = generation.current,
        operation = ++outputOperation.current;
      setDeviceFeedback("");
      // Save idle choices without touching the audio engine. Apply them on connect.
      if (!peer.current || !current.current) {
        setOutput(id);
        localStorage.setItem("sona-output", id);
        setError("");
        return;
      }
      setDeviceBusy("output");
      const previous = audio.current ?? new Audio(),
        source = previous.srcObject;
      try {
        const selected = await prepareAudioOutput(
          previous,
          effectiveDeviceId(id, "audiooutput", devices),
          () => new Audio(),
        );
        if (
          token !== generation.current ||
          operation !== outputOperation.current
        ) {
          if (selected.player !== previous) {
            selected.player.pause();
            selected.player.srcObject = null;
          }
          return;
        }
        const player = selected.player;
        audio.current = player;
        if (player !== previous) player.srcObject = source;
        const chosen = selected.fallback ? "" : id;
        setOutput(chosen);
        localStorage.setItem("sona-output", chosen);
        setError("");
        if (selected.fallback)
          setDeviceFeedback(
            "Chrome could not switch to that speaker. Using system output; the voice session is still connected.",
          );
        if (source)
          void player
            .play()
            .then(() => {
              if (token === generation.current && audio.current === player)
                return sendEvent({ type: "playback.ready" });
            })
            .catch(() => {
              if (token === generation.current && audio.current === player)
                setError("Audio playback is blocked. Select Resume audio.");
            });
        await sendEvent({
          type: "device.changed",
          device: "output",
          deviceId: chosen,
          success: true,
          fallback: selected.fallback,
        });
      } catch (e) {
        if (
          token === generation.current &&
          operation === outputOperation.current
        )
          setDeviceFeedback(
            `Speaker selection failed: ${(e as Error).message}`,
          );
      } finally {
        if (
          token === generation.current &&
          operation === outputOperation.current
        )
          setDeviceBusy(null);
      }
    },
    [devices, sendEvent],
  );
  useEffect(() => {
    if (
      !session ||
      !["connecting", "connected", "lost", "ended"].includes(state)
    )
      return;
    let disposed = false;
    const poll = async () => {
      try {
        const data = await api(`/sessions/${session.id}/runtime`);
        if (disposed) return;
        setRuntime(data);
        setSpeaking(data.speaking === true);
        (data.events ?? []).forEach(append);
        if (data.error) setError(data.error);
        if (data.status === "control-lost" && state === "connected") {
          stopMedia();
          setState("lost");
        }
        if (data.status === "ended" && state === "connected") {
          stopMedia();
          setState("ended");
          current.current = null;
          setSession(data.session);
        }
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          if (state === "connected") {
            stopMedia();
            setState("lost");
          }
        }
      }
    };
    void poll();
    const timer = setInterval(poll, 900);
    const clock = setInterval(() => {
      if (state !== "ended")
        setElapsed(
          started.current
            ? Math.floor((Date.now() - started.current) / 1000)
            : 0,
        );
    }, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [append, session?.id, state, stopMedia]);
  useEffect(() => {
    const changed = () => void refreshDevices().catch(() => {});
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
  }, [refreshDevices]);
  useEffect(
    () => () => {
      generation.current++;
      stopMedia();
    },
    [stopMedia],
  );
  return {
    clearSession: () => {
      generation.current++;
      stopMedia();
      current.current = null;
      setSession(null);
      setRuntime({});
      setEvents([]);
      setError("");
      setState("idle");
    },
    deviceBusy,
    deviceFeedback,
    checkMicrophone,
    session,
    state,
    muted,
    speaking,
    error,
    setError,
    events,
    runtime,
    elapsed,
    devices,
    input,
    output,
    start,
    end,
    reconnect,
    mute,
    changeInput,
    changeOutput,
    refreshDevices,
    sendEvent,
    turnControl: (command: string) =>
      current.current
        ? api(`/sessions/${current.current.id}/control`, { command }).catch(
            (e) => setError(e.message),
          )
        : Promise.resolve(),
    outputSupported:
      typeof HTMLMediaElement !== "undefined" &&
      "setSinkId" in HTMLMediaElement.prototype,
    resumeAudio: () =>
      audio.current
        ?.play()
        .then(() => {
          setError("");
          return sendEvent({ type: "playback.ready" });
        })
        .catch((e) => {
          setError(e.message);
          void sendEvent({ type: "playback.failed" });
        }),
    active: ["connecting", "connected", "lost"].includes(state),
  };
}
export type Voice = ReturnType<typeof useVoice>;

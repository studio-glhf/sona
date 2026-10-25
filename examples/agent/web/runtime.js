let csrf = "",
  session,
  peer,
  stream,
  muted = false,
  player = new Audio(),
  timer;
player.autoplay = true;
const el = (id) => document.getElementById(id);
async function api(path, body, method) {
  const r = await fetch("/api" + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "X-Sona-Token": csrf,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
async function playback(type) {
  if (session)
    await api("/sessions/" + session.id + "/events", {
      events: [{ type }],
    }).catch(() => {});
}
function error(e) {
  el("error").textContent = e.message;
}
async function bootstrap() {
  const data = await api("/bootstrap");
  csrf = data.csrfToken;
  el("name").textContent = data.name;
  const list = el("connections");
  list.replaceChildren();
  for (const c of data.connections) {
    const row = document.createElement("p");
    row.textContent = c.name + " · " + c.status + " ";
    for (const [title, route] of [
      ["Sign in", "auth"],
      ["Check", "discover"],
    ]) {
      const b = document.createElement("button");
      b.textContent = title;
      b.onclick = async () => {
        try {
          const result = await api(
            "/connections/" + encodeURIComponent(c.id) + "/" + route,
            {},
          );
          if (result.authorizationUrl) location.href = result.authorizationUrl;
          else await bootstrap();
        } catch (e) {
          error(e);
        }
      };
      row.append(b);
    }
    list.append(row);
  }
}
function stop() {
  stream?.getTracks().forEach((t) => t.stop());
  peer?.close();
  player.pause();
  player.srcObject = null;
  clearInterval(timer);
  el("mute").disabled = true;
  el("end").disabled = true;
  el("start").disabled = false;
  el("status").textContent = "Session ended";
}
function waitForMediaConnection(connection, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let deadline;
    const cleanup = () => {
      clearTimeout(deadline);
      connection.removeEventListener("connectionstatechange", changed);
    };
    const changed = () => {
      if (connection.connectionState === "connected") {
        cleanup();
        resolve();
      } else if (["failed", "closed"].includes(connection.connectionState)) {
        cleanup();
        reject(new Error("The browser media connection failed."));
      }
    };
    connection.addEventListener("connectionstatechange", changed);
    deadline = setTimeout(() => {
      cleanup();
      reject(new Error("The browser media connection timed out."));
    }, timeoutMs);
    changed();
  });
}
el("start").onclick = async () => {
  try {
    if (!el("consent").checked)
      throw new Error("Accept the processing notice first.");
    el("start").disabled = true;
    el("status").textContent = "Connecting";
    session = await api("/sessions", { processingAccepted: true });
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    stream.getTracks().forEach((t) => (t.enabled = false));
    peer = new RTCPeerConnection();
    peer.ontrack = (e) => {
      player.srcObject = e.streams[0];
      player
        .play()
        .then(() => playback("playback.ready"))
        .catch((e) => {
          error(e);
          void playback("playback.failed");
        });
    };
    stream.getTracks().forEach((t) => peer.addTrack(t, stream));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answer = await api("/sessions/" + session.id + "/connect", {
      sdp: offer.sdp,
    });
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    await waitForMediaConnection(peer);
    await api("/sessions/" + session.id + "/ready", {});
    stream.getTracks().forEach((t) => (t.enabled = true));
    muted = false;
    el("mute").disabled = false;
    el("end").disabled = false;
    el("status").textContent = "Listening";
    timer = setInterval(async () => {
      try {
        const state = await api("/sessions/" + session.id + "/runtime");
        if (state.status === "ended" || state.status === "control-lost") {
          stop();
          if (state.error) error(new Error(state.error));
          return;
        }
        if (state.error) throw new Error(state.error);
        const controls = el("turn-controls");
        controls.replaceChildren();
        for (const command of state.controls ?? []) {
          const b = document.createElement("button");
          b.textContent =
            command === "finish-turn"
              ? "Finish turn"
              : command === "respond"
                ? "Request response"
                : "Stop speech";
          b.onclick = () =>
            api("/sessions/" + session.id + "/control", { command }).catch(
              error,
            );
          controls.append(b);
        }
        el("status").textContent =
          state.status === "approval-needed"
            ? "Waiting for spoken approval"
            : state.speaking
              ? "Speaking"
              : muted
                ? "Microphone muted"
                : "Listening";
      } catch (e) {
        error(e);
      }
    }, 1500);
  } catch (e) {
    stop();
    if (session)
      await api("/sessions/" + session.id + "/end", {}).catch(() => {});
    error(e);
  }
};
el("end").onclick = async () => {
  stop();
  if (session) await api("/sessions/" + session.id + "/end", {}).catch(error);
};
el("mute").onclick = () => {
  muted = !muted;
  stream?.getTracks().forEach((t) => (t.enabled = !muted));
  el("mute").textContent = muted ? "Unmute" : "Mute";
};
el("resume").onclick = () =>
  player
    .play()
    .then(() => playback("playback.ready"))
    .catch((e) => {
      error(e);
      void playback("playback.failed");
    });
addEventListener("pagehide", () =>
  stream?.getTracks().forEach((t) => t.stop()),
);
bootstrap().catch(error);

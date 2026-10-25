import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Execute the actual browser entry with synthetic DOM/media/API objects.
// No microphone, service connection or external request is used.
function fixture() {
  const fields = new Map<string, any>();
  const el = (id: string) => {
    if (!fields.has(id))
      fields.set(id, {
        textContent: "",
        disabled: false,
        checked: true,
        replaceChildren() {},
        append() {},
      });
    return fields.get(id);
  };
  const track = { enabled: true, stop: vi.fn() };
  let mediaResolve!: () => void,
    readyResolve!: () => void,
    readyReject!: (error: Error) => void;
  const media = new Promise<void>((r) => {
    mediaResolve = r;
  });
  const ready = new Promise<void>((r, j) => {
    readyResolve = r;
    readyReject = j;
  });
  let peer: any;
  class Peer extends EventTarget {
    connectionState = "connecting";
    ontrack: any;
    constructor() {
      super();
      peer = this;
    }
    addTrack() {}
    async createOffer() {
      return { sdp: "synthetic" };
    }
    async setLocalDescription() {}
    async setRemoteDescription() {
      mediaResolve();
    }
    close() {
      this.connectionState = "closed";
      this.dispatchEvent(new Event("connectionstatechange"));
    }
  }
  const requests: string[] = [];
  runInNewContext(readFileSync("examples/agent/web/runtime.js", "utf8"), {
    document: { getElementById: el, createElement: () => ({}) },
    Audio: class {
      autoplay = false;
      srcObject: any;
      pause() {}
      async play() {}
    },
    RTCPeerConnection: Peer,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [track] }),
      },
    },
    async fetch(url: string) {
      requests.push(url);
      if (url.endsWith("/ready")) await ready;
      const body = url.endsWith("/bootstrap")
        ? { csrfToken: "fixture", connections: [], name: "Fixture" }
        : url.endsWith("/sessions")
          ? { id: "fixture" }
          : url.endsWith("/connect")
            ? { sdp: "synthetic" }
            : {};
      return { ok: true, json: async () => body };
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
  });
  return {
    el,
    track,
    requests,
    media,
    readyResolve,
    readyReject,
    connect: () => {
      peer.connectionState = "connected";
      peer.dispatchEvent(new Event("connectionstatechange"));
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("portable browser provider readiness", () => {
  it("keeps capture disabled until browser media and provider settings are ready", async () => {
    const f = fixture();
    const start = f.el("start").onclick();
    await f.media;
    expect(f.track.enabled).toBe(false);
    expect(f.el("status").textContent).toBe("Connecting");
    expect(f.requests.some((x) => x.endsWith("/ready"))).toBe(false);
    f.connect();
    await vi.waitFor(() =>
      expect(f.requests.some((x) => x.endsWith("/ready"))).toBe(true),
    );
    expect(f.track.enabled).toBe(false);
    f.readyResolve();
    await start;
    expect(f.track.enabled).toBe(true);
    expect(f.el("status").textContent).toBe("Listening");
    await f.el("end").onclick();
    expect(f.track.stop).toHaveBeenCalled();
  });
  it("releases capture and ends the session if provider confirmation fails", async () => {
    const f = fixture();
    const start = f.el("start").onclick();
    await f.media;
    f.connect();
    await vi.waitFor(() =>
      expect(f.requests.some((x) => x.endsWith("/ready"))).toBe(true),
    );
    f.readyReject(new Error("Synthetic configuration failure"));
    await start;
    expect(f.track.enabled).toBe(false);
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.requests.some((x) => x.endsWith("/end"))).toBe(true);
    expect(f.el("status").textContent).toBe("Session ended");
  });
});

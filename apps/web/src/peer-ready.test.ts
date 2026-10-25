import { it, expect, vi, afterEach } from "vitest";
import { waitForPeerConnection } from "./peer-ready";
afterEach(() => vi.useRealTimers());
function peer(state = "new") { return Object.assign(new EventTarget(), { connectionState: state, iceConnectionState: "new" }) as unknown as RTCPeerConnection; }
it("waits for actual media connectivity", async () => {
  const p = peer(); let ready = false;
  const pending = waitForPeerConnection(p).then(() => { ready = true; });
  await Promise.resolve(); expect(ready).toBe(false);
  Object.assign(p, { connectionState: "connected" }); p.dispatchEvent(new Event("connectionstatechange"));
  await pending; expect(ready).toBe(true);
});
it("reports a failed media path", async () => {
  await expect(waitForPeerConnection(peer("failed"))).rejects.toThrow("media connection failed");
});
it("bounds a stalled media path", async () => {
  vi.useFakeTimers(); const pending = waitForPeerConnection(peer());
  const rejected = expect(pending).rejects.toThrow("media connection timed out");
  await vi.advanceTimersByTimeAsync(15000); await rejected;
});

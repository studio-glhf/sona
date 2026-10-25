import { it, expect, vi } from "vitest";
import {
  effectiveDeviceId,
  matchesMicrophone,
  releaseMicrophone,
} from "./media-devices";
const devices = [
  {
    deviceId: "default",
    kind: "audioinput",
    groupId: "mic",
    label: "Default - Built-in mic",
  },
  {
    deviceId: "builtin",
    kind: "audioinput",
    groupId: "mic",
    label: "Built-in mic",
  },
  {
    deviceId: "default",
    kind: "audiooutput",
    groupId: "speaker",
    label: "Default - Built-in speaker",
  },
  {
    deviceId: "speaker",
    kind: "audiooutput",
    groupId: "speaker",
    label: "Built-in speaker",
  },
] as MediaDeviceInfo[];
it("normalizes the physical built-in devices to the system default", () => {
  expect(effectiveDeviceId("builtin", "audioinput", devices)).toBe("");
  expect(effectiveDeviceId("speaker", "audiooutput", devices)).toBe("");
  expect(effectiveDeviceId("other", "audioinput", devices)).toBe("other");
  const track = {
    readyState: "live",
    getSettings: () => ({ deviceId: "builtin" }),
  } as MediaStreamTrack;
  expect(matchesMicrophone(track, "", devices)).toBe(true);
});
it("detaches the old track handler before releasing owned capture", () => {
  const stop = vi.fn(),
    track = { onended: vi.fn(), stop };
  releaseMicrophone({ getTracks: () => [track] } as unknown as MediaStream);
  expect(track.onended).toBeNull();
  expect(stop).toHaveBeenCalledOnce();
});

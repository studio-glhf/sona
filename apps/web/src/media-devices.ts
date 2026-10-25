/** Physical device rows and the system-default row can describe the same
 * hardware. Avoid opening/switching that hardware a second time. */
export function effectiveDeviceId(
  id: string,
  kind: MediaDeviceKind,
  devices: readonly MediaDeviceInfo[],
): string {
  if (!id || id === "default") return "";
  const selected = devices.find((d) => d.kind === kind && d.deviceId === id);
  const system = devices.find(
    (d) => d.kind === kind && d.deviceId === "default",
  );
  if (
    selected &&
    system &&
    ((selected.groupId && selected.groupId === system.groupId) ||
      (selected.label && system.label === `Default - ${selected.label}`))
  )
    return "";
  return id;
}
export function matchesMicrophone(
  track: MediaStreamTrack | undefined,
  id: string,
  devices: readonly MediaDeviceInfo[],
) {
  if (!track || track.readyState !== "live") return false;
  const actual = track.getSettings?.().deviceId;
  return Boolean(
    actual &&
    effectiveDeviceId(actual, "audioinput", devices) ===
      effectiveDeviceId(id, "audioinput", devices),
  );
}
export function releaseMicrophone(media: MediaStream | null | undefined) {
  media?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

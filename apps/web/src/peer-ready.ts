export function waitForPeerConnection(peer: RTCPeerConnection, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); peer.removeEventListener("connectionstatechange", changed); };
    const changed = () => {
      if (peer.connectionState === "connected") { cleanup(); resolve(); }
      else if (["failed", "closed"].includes(peer.connectionState)) {
        cleanup(); reject(new Error(`Browser media connection ${peer.connectionState} (ICE ${peer.iceConnectionState}).`));
      }
    };
    peer.addEventListener("connectionstatechange", changed);
    timer = setTimeout(() => { cleanup(); reject(new Error(`Browser media connection timed out (connection ${peer.connectionState}, ICE ${peer.iceConnectionState}). Check the network and microphone device.`)); }, timeoutMs);
    changed();
  });
}

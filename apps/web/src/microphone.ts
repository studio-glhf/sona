let pendingRequest: Promise<MediaStream> | undefined;
/** Own each browser request. Cancellation releases a late stream, and a
 * pending browser prompt cannot accumulate competing getUserMedia calls. */
export async function openMicrophone(
  request: () => Promise<MediaStream>,
  timeoutMs = 15000,
  signal?: AbortSignal,
): Promise<MediaStream> {
  if (signal?.aborted)
    throw new DOMException("Microphone request canceled.", "AbortError");
  if (pendingRequest)
    throw new DOMException(
      "A previous Chrome microphone request is still waiting. Respond to its permission prompt, or reload Sona before retrying.",
      "InvalidStateError",
    );
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const source = request();
  pendingRequest = source;
  const clear = () => {
    if (pendingRequest === source) pendingRequest = undefined;
  };
  source.then(clear, clear);
  const pending = source.then((stream) => {
    if (expired) stream.getTracks().forEach((track) => track.stop());
    return stream;
  });
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        abort = () => {
          expired = true;
          reject(
            new DOMException("Microphone request canceled.", "AbortError"),
          );
        };
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => {
          expired = true;
          reject(
            new DOMException(
              "Chrome did not finish opening the microphone. Respond to any browser permission prompt. If it remains pending, reload Sona before retrying.",
              "TimeoutError",
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

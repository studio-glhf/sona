/** A failed saved speaker must not prevent connection. A fresh element also
 * isolates a late setSinkId result after the bounded wait. */
export async function prepareAudioOutput<
  T extends {
    autoplay: boolean;
    sinkId?: string;
    pause(): void;
    srcObject: unknown;
    setSinkId?: (id: string) => Promise<void>;
  },
>(player: T, output: string, create: () => T, timeoutMs = 3000) {
  player.autoplay = true;
  if ((!output && !player.sinkId) || player.sinkId === output)
    return { player, fallback: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!player.setSinkId) throw new Error("Output selection is unavailable.");
    await Promise.race([
      player.setSinkId(output),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Speaker selection timed out.")),
          timeoutMs,
        );
      }),
    ]);
    return { player, fallback: false };
  } catch {
    player.pause();
    player.srcObject = null;
    const replacement = create();
    replacement.autoplay = true;
    return { player: replacement, fallback: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

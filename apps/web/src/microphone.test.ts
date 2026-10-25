import { it, expect, vi, afterEach } from "vitest";
import { openMicrophone } from "./microphone";
afterEach(() => vi.useRealTimers());
it("bounds microphone acquisition and stops tracks that arrive after timeout", async () => {
  vi.useFakeTimers();
  let finish!: (stream: MediaStream) => void;
  const stop = vi.fn(),
    stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const pending = openMicrophone(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  finish(stream);
  await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce();
});
it("returns a working microphone without stopping it", async () => {
  const stop = vi.fn(),
    stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  expect(await openMicrophone(async () => stream)).toBe(stream);
  expect(stop).not.toHaveBeenCalled();
});
it("cancels promptly and releases a late browser stream without opening overlapping requests", async () => {
  let finish!: (stream: MediaStream) => void;
  const controller = new AbortController(),
    stop = vi.fn();
  const pending = openMicrophone(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    15000,
    controller.signal,
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  controller.abort();
  await rejected;
  const request = vi.fn();
  await expect(openMicrophone(request)).rejects.toMatchObject({
    name: "InvalidStateError",
  });
  expect(request).not.toHaveBeenCalled();
  finish({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce();
  const next = {} as MediaStream;
  expect(await openMicrophone(async () => next)).toBe(next);
});

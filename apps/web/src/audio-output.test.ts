import { describe, it, expect, vi, afterEach } from "vitest";
import { prepareAudioOutput } from "./audio-output";
const player = () => ({
  autoplay: false,
  pause: vi.fn(),
  srcObject: {} as unknown,
  setSinkId: vi.fn(async (_id: string) => {}),
});
afterEach(() => vi.useRealTimers());
describe("saved speaker recovery", () => {
  it("preserves a working selected speaker", async () => {
    const p = player(),
      create = vi.fn(player);
    expect(await prepareAudioOutput(p, "speaker", create)).toEqual({
      player: p,
      fallback: false,
    });
    expect(p.setSinkId).toHaveBeenCalledWith("speaker");
    expect(create).not.toHaveBeenCalled();
  });
  it("recovers an aborted speaker on a fresh system-output element", async () => {
    const p = player(),
      next = player();
    p.setSinkId.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    expect(await prepareAudioOutput(p, "stale", () => next)).toEqual({
      player: next,
      fallback: true,
    });
    expect(p.pause).toHaveBeenCalled();
    expect(p.srcObject).toBeNull();
    expect(next.setSinkId).not.toHaveBeenCalled();
  });
  it("bounds stalled selection and isolates its late completion", async () => {
    vi.useFakeTimers();
    const p = player(),
      next = player();
    let finish!: () => void;
    p.setSinkId.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const pending = prepareAudioOutput(p, "stalled", () => next);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual({ player: next, fallback: true });
    finish();
    await Promise.resolve();
    expect(next.setSinkId).not.toHaveBeenCalled();
  });
  it("uses system output without requesting a device switch", async () => {
    const p = player();
    expect((await prepareAudioOutput(p, "", player)).fallback).toBe(false);
    expect(p.setSinkId).not.toHaveBeenCalled();
  });
});
it("resets a custom sink when returning to system output", async () => {
  const p = { ...player(), sinkId: "custom-speaker" };
  expect((await prepareAudioOutput(p, "", player)).player).toBe(p);
  expect(p.setSinkId).toHaveBeenCalledWith("");
});

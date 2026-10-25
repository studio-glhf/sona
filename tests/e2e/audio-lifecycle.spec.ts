import { test, expect, type Page } from "@playwright/test";

test.afterEach(async ({ page }) => {
  const boot = await (await page.request.get("/api/bootstrap")).json();
  await page.request.delete("/api/settings/credentials/openai", {
    headers: { "x-sona-token": boot.csrfToken },
  });
});

async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("sona-input");
    localStorage.removeItem("sona-output");
    const state = {
      captures: 0,
      stops: 0,
      sinks: [] as string[],
      failInput: false,
      tracks: [] as any[],
    };
    (window as any).__audio = state;
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
        deviceId: "other",
        kind: "audioinput",
        groupId: "other",
        label: "Test failing input",
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
      {
        deviceId: "stalled",
        kind: "audiooutput",
        groupId: "stalled",
        label: "Test stalled speaker",
      },
    ];
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        enumerateDevices: async () => devices,
        addEventListener() {},
        removeEventListener() {},
        async getUserMedia(c: any) {
          state.captures++;
          if (c.audio?.deviceId?.exact === "other")
            throw new DOMException("Synthetic failure", "NotReadableError");
          const track: any = {
            kind: "audio",
            readyState: "live",
            enabled: true,
            onended: null,
            getSettings: () => ({ deviceId: "builtin" }),
            stop() {
              this.readyState = "ended";
              state.stops++;
            },
          };
          state.tracks.push(track);
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      },
    });
    class Peer extends EventTarget {
      connectionState = "new";
      iceConnectionState = "new";
      onconnectionstatechange: any;
      ontrack: any;
      senders: any[] = [];
      addTrack(track: any) {
        this.senders.push({
          track,
          async replaceTrack(next: any) {
            this.track = next;
          },
        });
      }
      getSenders() {
        return this.senders;
      }
      async createOffer() {
        return { type: "offer", sdp: "synthetic-audio-offer" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = "connected";
        this.iceConnectionState = "connected";
        this.dispatchEvent(new Event("connectionstatechange"));
        this.onconnectionstatechange?.();
      }
      close() {
        this.connectionState = "closed";
      }
    }
    (window as any).RTCPeerConnection = Peer;
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: function (id: string) {
        state.sinks.push(id);
        return id === "stalled" ? new Promise(() => {}) : Promise.resolve();
      },
    });
    HTMLMediaElement.prototype.play = async () => {};
    HTMLMediaElement.prototype.pause = () => {};
  });
  // Establish the shared cookie before the app can issue its own bootstrap.
  // Concurrent cold bootstraps can otherwise return different security tokens.
  const boot = await (await page.request.get("/api/bootstrap")).json();
  const headers = { "x-sona-token": boot.csrfToken };
  const credential = await page.request.put(
    "/api/settings/credentials/openai",
    {
      headers,
      data: { apiKey: "sk-proj-synthetic_audio_lifecycle" },
    },
  );
  expect(
    credential.ok(),
    "Audio fixture credential must be configured",
  ).toBeTruthy();
  const agent = await page.request.post("/api/agents", {
    headers,
    data: { name: "Audio lifecycle fixture" },
  });
  expect(agent.ok(), "Audio fixture agent must be created").toBeTruthy();
  await page.route("**/api/sessions/*/connect", (route) =>
    route.fulfill({ json: { sdp: "synthetic-answer" } }),
  );
  await page.route("**/api/sessions/*/ready", (route) =>
    route.fulfill({ json: { ready: true } }),
  );
  await page.route("**/api/sessions/*/runtime", (route) =>
    route.fulfill({ json: { status: "connected", events: [], controls: [] } }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Audio lifecycle fixture", exact: true })
    .first()
    .click();
}
const stats = (page: Page) =>
  page.evaluate(() => ({
    captures: (window as any).__audio.captures,
    stops: (window as any).__audio.stops,
    sinks: (window as any).__audio.sinks,
    live: (window as any).__audio.tracks.filter(
      (t: any) => t.readyState === "live",
    ).length,
  }));

test("active microphone checks and built-in aliases preserve capture; failed input and stalled output recover", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Start quick test", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Listening", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Devices", exact: true });
  await dialog
    .getByRole("button", { name: "Check microphone permission" })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Microphone access works",
  );
  await dialog
    .getByRole("combobox", { name: "Microphone", exact: true })
    .selectOption("builtin");
  await dialog
    .getByRole("combobox", { name: "Output", exact: true })
    .selectOption("speaker");
  expect(await stats(page)).toEqual({
    captures: 1,
    stops: 0,
    sinks: [],
    live: 1,
  });
  // Browser-reported loss is repaired through the same permission button.
  await page.evaluate(() => {
    const track = (window as any).__audio.tracks[0];
    track.readyState = "ended";
    track.onended?.();
  });
  await dialog
    .getByRole("button", { name: "Check microphone permission" })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Microphone access works",
  );
  expect(await stats(page)).toEqual({
    captures: 2,
    stops: 1,
    sinks: [],
    live: 1,
  });
  await dialog
    .getByRole("combobox", { name: "Microphone", exact: true })
    .selectOption("other");
  await expect(dialog.getByRole("status")).toContainText(
    "Your current microphone is still active",
  );
  expect((await stats(page)).live).toBe(1);
  await dialog
    .getByRole("combobox", { name: "Output", exact: true })
    .selectOption("stalled");
  await expect(dialog.getByRole("status")).toContainText("Using system output");
  expect((await stats(page)).live).toBe(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Listening", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "End session", exact: true }).click();
  expect((await stats(page)).live).toBe(0);
});

test("a canceled startup failure cannot stop the next session", async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  let calls = 0;
  await page.route("**/api/sessions/*/connect", async (route) => {
    if (++calls === 1) {
      await new Promise<void>((r) => {
        release = r;
      });
      await route.fulfill({
        status: 500,
        json: { error: "Old canceled connection failed" },
      });
    } else await route.fulfill({ json: { sdp: "synthetic-answer" } });
  });
  await page
    .getByRole("button", { name: "Start quick test", exact: true })
    .click();
  await expect
    .poll(() => calls, {
      message: "The first session must reach provider connection",
    })
    .toBe(1);
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page
    .getByRole("button", { name: "Start quick test", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Listening", exact: true }),
  ).toBeVisible();
  const oldFailure = page.waitForResponse(
    (response) =>
      response.url().endsWith("/connect") && response.status() === 500,
  );
  release();
  await (await oldFailure).finished();
  // A subsequent runtime poll observes the UI after the old catch handler ran.
  await page.waitForResponse((response) => response.url().endsWith("/runtime"));
  await expect(
    page.getByText("Old canceled connection failed", { exact: false }),
  ).toHaveCount(0);
  expect((await stats(page)).live).toBe(1);
  await page.getByRole("button", { name: "End session", exact: true }).click();
});

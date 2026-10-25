import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

declare global {
  interface Window {
    __sonaMicrophoneFixture: {
      requests: MediaStreamConstraints[];
      stopped: number;
      captureResolved: boolean;
      release: () => void;
    };
  }
}

// These tests use synthetic media objects. They test dialog behavior and cleanup,
// not physical microphone access, audio quality, or a real voice session.
async function installMediaFixture(
  page: Page,
  options: {
    errorName?: string;
    refreshError?: boolean;
    unsupported?: boolean;
  } = {},
) {
  await page.addInitScript((config) => {
    localStorage.setItem("sona-input", "fixture-selected-input");
    const probe: Window["__sonaMicrophoneFixture"] = {
      requests: [],
      stopped: 0,
      captureResolved: false,
      release: () => {},
    };
    window.__sonaMicrophoneFixture = probe;
    if (config.unsupported) {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined });
      return;
    }
    const track = {
      kind: "audio",
      readyState: "live",
      stop: () => {
        probe.stopped++;
        track.readyState = "ended";
      },
    };
    const media = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: (constraints: MediaStreamConstraints) => {
          probe.requests.push(constraints);
          return new Promise((resolve, reject) => {
            probe.release = () => {
              probe.captureResolved = true;
              if (config.errorName)
                reject(
                  new DOMException(
                    "private browser diagnostic",
                    config.errorName,
                  ),
                );
              else resolve(media);
            };
          });
        },
        enumerateDevices: async () => {
          if (config.refreshError && probe.captureResolved)
            throw new Error("private device diagnostic");
          return [
            {
              deviceId: "fixture-selected-input",
              kind: "audioinput",
              label: "Synthetic selected microphone",
              groupId: "fixture",
            },
          ];
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  }, options);
}

async function openDevices(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Select microphone and output", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Devices", exact: true });
}

test("microphone check shows checking and success, checks selected input, and releases temporary tracks", async ({
  page,
}) => {
  await installMediaFixture(page);
  const sessionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/sessions") && request.method() !== "GET")
      sessionRequests.push(request.url());
  });
  const dialog = await openDevices(page);
  await dialog
    .getByRole("button", { name: "Check microphone permission" })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Checking microphone access…",
  );
  await expect(dialog.getByRole("status")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(
    dialog.getByRole("button", { name: "Checking…" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("combobox", { name: "Microphone", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => window.__sonaMicrophoneFixture.requests),
  ).toEqual([
    { audio: { deviceId: { exact: "fixture-selected-input" } }, video: false },
  ]);
  await page.evaluate(() => window.__sonaMicrophoneFixture.release());
  await expect(dialog.getByRole("status")).toHaveText(
    "Microphone access works. Your microphone is ready.",
  );
  expect(
    await page.evaluate(() => window.__sonaMicrophoneFixture.stopped),
  ).toBe(1);
  expect(sessionRequests).toEqual([]);
  await expect(
    dialog.getByRole("button", { name: "Check microphone permission" }),
  ).toBeEnabled();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({
    path: "docs/verification/microphone-success-fixture-1440.png",
    fullPage: true,
  });
});

for (const [errorName, guidance] of [
  [
    "NotAllowedError",
    "Allow microphone access for Sona in your browser and system settings. Then try again.",
  ],
  [
    "NotReadableError",
    "Chrome could not open the microphone. Check its permission prompt, then try again.",
  ],
  [
    "NotFoundError",
    "No microphone is available. Connect a microphone, then try again.",
  ],
  [
    "OverconstrainedError",
    "The selected microphone is unavailable. Choose another microphone, then try again.",
  ],
  [
    "UnknownBrowserError",
    "Could not check microphone access. Check your device and browser settings, then try again.",
  ],
] as const) {
  test(`microphone ${errorName} is explained inside Devices without raw diagnostics`, async ({
    page,
  }) => {
    await installMediaFixture(page, { errorName });
    const dialog = await openDevices(page);
    await dialog
      .getByRole("button", { name: "Check microphone permission" })
      .click();
    await page.evaluate(() => window.__sonaMicrophoneFixture.release());
    await expect(dialog.getByRole("status")).toHaveText(guidance);
    await expect(
      dialog.getByRole("button", { name: "Check microphone permission" }),
    ).toBeEnabled();
    await expect(page.getByText(/private browser diagnostic/)).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__sonaMicrophoneFixture.stopped),
    ).toBe(0);
  });
}

test("unsupported microphone access has actionable dialog feedback", async ({
  page,
}) => {
  await installMediaFixture(page, { unsupported: true });
  const dialog = await openDevices(page);
  await dialog
    .getByRole("button", { name: "Check microphone permission" })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "This browser cannot check microphone access. Open Sona in desktop Chrome on localhost.",
  );
  expect(
    await page.evaluate(() => window.__sonaMicrophoneFixture.requests),
  ).toEqual([]);
});

test("a device list refresh failure preserves microphone success and releases tracks", async ({
  page,
}) => {
  await installMediaFixture(page, { refreshError: true });
  const dialog = await openDevices(page);
  await dialog
    .getByRole("button", { name: "Check microphone permission" })
    .click();
  await page.evaluate(() => window.__sonaMicrophoneFixture.release());
  await expect(dialog.getByRole("status")).toHaveText(
    "Microphone access works. The device list could not refresh. Close and reopen Devices to refresh it.",
  );
  expect(
    await page.evaluate(() => window.__sonaMicrophoneFixture.stopped),
  ).toBe(1);
  await expect(page.getByText(/private device diagnostic/)).toHaveCount(0);
});

test("closing Devices while permission is pending releases late temporary tracks", async ({
  page,
}) => {
  await installMediaFixture(page);
  const dialog = await openDevices(page);
  await dialog
    .getByRole("button", { name: "Check microphone permission" })
    .click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.__sonaMicrophoneFixture.release());
  await expect
    .poll(() => page.evaluate(() => window.__sonaMicrophoneFixture.stopped))
    .toBe(1);
  await expect(page.getByRole("dialog", { name: "Devices" })).toHaveCount(0);
  await expect(
    page.getByText("Microphone access works. Your microphone is ready."),
  ).toHaveCount(0);
});

test("optional participant view can use the same microphone feedback without researcher evidence", async ({
  page,
}) => {
  await installMediaFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await page.getByRole("switch", { name: "Participant view" }).click();
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Devices", exact: true });
  await dialog
    .getByRole("button", { name: "Check microphone permission" })
    .click();
  await page.evaluate(() => window.__sonaMicrophoneFixture.release());
  await expect(dialog.getByRole("status")).toHaveText(
    "Microphone access works. Your microphone is ready.",
  );
  await expect(
    page.getByRole("heading", { name: "Agent controls" }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveCount(0);
});

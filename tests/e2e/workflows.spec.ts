import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("researcher defaults, agent revisions, fixed draft, export and restart", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Agent controls" }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Participant view" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("tab", { name: "Instructions", exact: true }).click();
  const instructions = page.getByLabel("Agent instructions", { exact: true });
  await instructions.fill(
    "Respond in English. Help with any researcher-selected task.",
  );
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await page.getByRole("tab", { name: "Parameters", exact: true }).click();
  await page.getByLabel("Speech speed", { exact: true }).fill("1.15");
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByLabel("Speech speed", { exact: true })).toHaveValue(
    "1.15",
  );
  await page.getByRole("button", { name: "Versions", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Configuration versions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export agent", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("sona-agent.json");
  await page.screenshot({
    path: "docs/verification/researcher-1440.png",
    fullPage: true,
  });
});
test("participant preview, devices, neutral handoff and reload conceal evidence", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("switch", { name: "Participant view" }).click();
  await expect(
    page.getByText("Participant view", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent controls" }),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveCount(0);
  await page.getByRole("button", { name: "Devices", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Devices" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({
    path: "docs/verification/participant-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: "docs/verification/participant-1280.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Return to the researcher" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agent controls" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Return to researcher view" }).click();
  await expect(
    page.getByRole("heading", { name: "Agent controls" }),
  ).toBeVisible();
});
test("study preparation, default researcher view, duplication and consent form", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New study", exact: true }).click();
  await page
    .getByLabel("Study name", { exact: true })
    .fill("Browser verification study");
  await page
    .getByLabel("Research question")
    .fill("Does speech speed change clarity?");
  await page
    .getByRole("button", { name: "Add condition", exact: true })
    .click();
  await expect(page.getByLabel("Planned session view")).toHaveValue(
    "researcher",
  );
  await page
    .getByRole("button", { name: "Duplicate Condition 1", exact: true })
    .click();
  await expect(page.getByLabel("Planned session view")).toHaveCount(2);
  await page.waitForTimeout(1000);
  await page
    .getByRole("button", { name: "Start run", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Start study run" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("The participant is also a researcher"),
  ).toBeChecked();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare conditions" }),
  ).toBeVisible();
  await expect(
    page.getByText("No valid latency measurements", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/verification/compare-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: "docs/verification/compare-1280.png",
    fullPage: true,
  });
});
test("complete API inventory, schema details, credentials missing and safe connection import", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "API library", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "OpenAI API library" }),
  ).toBeVisible();
  await expect(page.getByText(/354 of 354 operations/)).toBeVisible();
  await page.getByLabel("Search API operations").fill("/models");
  await page
    .getByRole("button")
    .filter({ hasText: "List models" })
    .first()
    .click();
  await page.getByRole("button", { name: "Run request", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("credential");
  await page
    .getByRole("tab", { name: "Schema and source", exact: true })
    .click();
  await expect(
    page.getByText("Operation schema", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "Add Google Calendar" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Google Calendar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("needs-verification", { exact: true }),
  ).toBeVisible();
});
test("keyboard, automated accessibility and laptop layout", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Workspace search" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(
    page.getByRole("button", { name: "Start quick test", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/verification/researcher-1280.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(
    page.getByRole("button", { name: "Agent controls", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agent controls", exact: true })
    .click();
  await expect(page.getByLabel("Find a parameter")).toBeVisible();
  await page
    .getByRole("button", { name: "Collapse agent controls", exact: true })
    .click();
});

test("a draft survives leaving the editor before its debounce timer finishes", async ({
  page,
}) => {
  await page.goto("/");
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/agents"),
  );
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const { name } = await (await created).json();
  await expect(page.locator(".workspace-header h1")).toHaveText(name);
  await page.getByRole("tab", { name: "Instructions", exact: true }).click();
  await page
    .getByLabel("Agent instructions", { exact: true })
    .fill("Fast navigation fixture. Respond in Korean.");
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().includes("/api/agents/"),
  );
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  await saved;
  await page.reload();
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.getByRole("tab", { name: "Instructions", exact: true }).click();
  await expect(
    page.getByLabel("Agent instructions", { exact: true }),
  ).toHaveValue("Fast navigation fixture. Respond in Korean.");
});

test("native controls preserve a custom voice and show missing provider evidence honestly", async ({
  page,
}) => {
  await page.goto("/");
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const selected = await page.evaluate(() =>
    localStorage.getItem("sona-agent"),
  );
  const agent =
    bootstrap.agents.find((item: any) => item.id === selected) ??
    bootstrap.agents[0];
  const config = structuredClone(agent.draft);
  config.settings.audio.output.voice = { id: "voice_fixture" };
  const response = await page.request.patch(`/api/agents/${agent.id}`, {
    headers: { "X-Sona-Token": bootstrap.csrfToken },
    data: { draft: config },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.getByRole("tab", { name: "Parameters", exact: true }).click();
  await expect(page.getByLabel("Voice", { exact: true })).toHaveValue(
    "__custom__",
  );
  await expect(
    page.getByText("No provider evidence", { exact: true }),
  ).toBeVisible();
  const updated = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/agents/${agent.id}`),
  );
  await page.getByLabel("Speech speed", { exact: true }).fill("1.2");
  expect((await updated).ok()).toBe(true);
  await expect(
    page
      .getByRole("complementary", { name: "Agent controls" })
      .getByText("Saved", { exact: true }),
  ).toBeVisible();
  const saved = await (
    await page.request.get(`/api/agents/${agent.id}`, {
      headers: { "X-Sona-Token": bootstrap.csrfToken },
    })
  ).json();
  expect(saved.draft.settings.audio.output.voice).toEqual({
    id: "voice_fixture",
  });
  expect(saved.draft.settings.audio.output.speed).toBe(1.2);
  await page.request.patch(`/api/agents/${agent.id}`, {
    headers: { "X-Sona-Token": bootstrap.csrfToken },
    data: { draft: agent.draft },
  });
});

test("Settings adds and removes a server-memory API key without browser storage", async ({
  page,
}) => {
  const canary =
    "sk-proj-SonaGuiSyntheticKeyNeverUsedForProviderCalls1234567890";
  // This lifecycle test never sends its synthetic key to OpenAI. Dedicated
  // server transport fixtures and key-verification workflows cover the check.
  await page.route("**/api/settings/credentials/openai/verify", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        openai: {
          configured: true,
          source: "session",
          storage: "memory",
          verification: { state: "unchecked", checkedAt: null, reason: null },
        },
      }),
    }),
  );
  await page.goto("/");
  const creation = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/agents",
  );
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const agentName = (await (await creation).json()).name;
  await expect(page.locator(".workspace-header h1")).toHaveText(agentName);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(".settings-page");
  await expect(
    settings.getByText("No API key added", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Data policy", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Set OPENAI_API_KEY/)).toHaveCount(0);
  const field = page.getByLabel("OpenAI API key", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await expect(
    settings.getByRole("button", { name: "Save key", exact: true }),
  ).toBeDisabled();
  try {
    // A transport fixture exercises the UI response to the server's busy guard.
    // The actual server lease guard has separate integration tests.
    const credentialRoute = "**/api/settings/credentials/openai";
    await page.route(credentialRoute, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "CREDENTIAL_IN_USE",
          error: "Untrusted server text " + canary,
        }),
      }),
    );
    await field.fill(canary);
    await settings
      .getByRole("button", { name: "Save key", exact: true })
      .click();
    await expect(settings.getByRole("alert")).toHaveText(
      "End the active test or API operation before changing your API key.",
    );
    await expect(field).toHaveValue("");
    expect(await settings.innerText()).not.toContain(canary);
    await page.unroute(credentialRoute);
    await field.fill("sk-admin-InvalidSyntheticProjectKey1234567890");
    const rejected = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        r.url().endsWith("/api/settings/credentials/openai"),
    );
    await settings
      .getByRole("button", { name: "Save key", exact: true })
      .click();
    const invalid = await rejected;
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).code).toBe("INVALID_PROJECT_API_KEY");
    await expect(settings.getByRole("alert")).toHaveText(
      "Enter an OpenAI project API key. Admin keys are not supported.",
    );
    await expect(field).toHaveValue("");
    const bootstrapRoute = "**/api/bootstrap";
    await page.route(bootstrapRoute, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Untrusted refresh text " + canary }),
      }),
    );
    await field.fill(canary);
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        r.url().endsWith("/api/settings/credentials/openai"),
    );
    await settings
      .getByRole("button", { name: "Save key", exact: true })
      .click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toContain(canary);
    await expect(field).toHaveValue("");
    await expect(
      settings.getByText("API key added · Not checked", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByText("API key saved for this Sona run.", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByText("Reload Sona to refresh workspace access.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(0);
    expect(await settings.innerText()).not.toContain(canary);
    // A successful save updates the workspace even when bootstrap cannot refresh.
    await page.getByRole("button", { name: agentName, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add API key", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      settings.getByText("API key added · Not checked", { exact: true }),
    ).toBeVisible();
    await page.unroute(bootstrapRoute);
    const bootstrap = await (await page.request.get("/api/bootstrap")).json();
    expect(bootstrap.readiness.openaiConfigured).toBe(true);
    expect(JSON.stringify(bootstrap)).not.toContain(canary);
    const browserStorage = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(JSON.stringify(browserStorage)).not.toContain(canary);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      settings.getByText("API key added · Not checked", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("OpenAI API key", { exact: true }),
    ).toHaveValue("");
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    // Hold a real autosave so bootstrap still contains the previous draft.
    // A credential refresh must not replace this in-progress editor state.
    await page.getByRole("button", { name: agentName, exact: true }).click();
    await page.getByRole("tab", { name: "Instructions", exact: true }).click();
    const draftText =
      "Draft preserved during a credential refresh. Respond in English.";
    let releaseDraft!: () => void;
    const heldDraft = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    const agentRoute = "**/api/agents/*";
    await page.route(agentRoute, async (route) => {
      if (route.request().method() === "PATCH") await heldDraft;
      await route.continue();
    });
    const draftRequest = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().includes("/api/agents/"),
    );
    const draftResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" && r.url().includes("/api/agents/"),
    );
    try {
      await page
        .getByLabel("Agent instructions", { exact: true })
        .fill(draftText);
      await draftRequest;
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await field.fill(canary);
      const refreshed = page.waitForResponse(
        (r) =>
          r.request().method() === "GET" && r.url().endsWith("/api/bootstrap"),
      );
      await settings
        .getByRole("button", { name: "Save key", exact: true })
        .click();
      expect((await refreshed).ok()).toBe(true);
      await expect(
        settings.getByText("API key saved for this Sona run.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: agentName, exact: true }).click();
      await page
        .getByRole("tab", { name: "Instructions", exact: true })
        .click();
      await expect(
        page.getByLabel("Agent instructions", { exact: true }),
      ).toHaveValue(draftText);
    } finally {
      releaseDraft();
      expect((await draftResponse).ok()).toBe(true);
      await page.unroute(agentRoute);
    }
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.route(bootstrapRoute, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Untrusted refresh text " + canary }),
      }),
    );
    await settings
      .getByRole("button", { name: "Remove key", exact: true })
      .click();
    await expect(
      settings.getByText("No API key added", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByText("API key removed.", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByText("Reload Sona to refresh workspace access.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(settings.getByRole("alert")).toHaveCount(0);
    expect(await settings.innerText()).not.toContain(canary);
    await page.unroute(bootstrapRoute);
    const cleared = await (await page.request.get("/api/bootstrap")).json();
    expect(cleared.readiness.openaiConfigured).toBe(false);
    await page.getByRole("button", { name: agentName, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add API key", exact: true }),
    ).toBeVisible();
  } finally {
    const bootstrap = await (await page.request.get("/api/bootstrap")).json();
    await page.request.delete("/api/settings/credentials/openai", {
      headers: { "X-Sona-Token": bootstrap.csrfToken },
    });
  }
});

test("quick tests open directly with calm evidence and no processing-notice gate", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(
    page.getByText("Notes for this test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Researcher notes", { exact: true }),
  ).toHaveCount(0);
  const submitted = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/sessions",
  );
  await page
    .getByRole("button", { name: "Start quick test", exact: true })
    .click();
  const request = await submitted;
  expect(request.postDataJSON().mode).toBe("quick");
  expect(request.postDataJSON().processingAccepted).toBeUndefined();
  expect(request.postDataJSON().consent).toBeUndefined();
  await expect(
    page.getByRole("dialog", { name: "Voice processing notice" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("sona-processing-accepted")),
  ).toBeNull();
});

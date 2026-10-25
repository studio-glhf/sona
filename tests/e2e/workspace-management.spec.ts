import { test, expect, type Page } from "@playwright/test";
async function menu(page: Page, name: string, action: string) {
  await page
    .getByRole("button", { name: `Actions for ${name}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function rename(page: Page, kind: string, name: string, next: string) {
  await menu(page, name, "Rename");
  const dialog = page.getByRole("dialog", { name: `Rename ${kind}` });
  await dialog.getByLabel("Name", { exact: true }).fill(next);
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog).not.toBeVisible();
}
async function remove(page: Page, kind: string, name: string) {
  await menu(page, name, "Delete");
  const dialog = page.getByRole("dialog", {
    name: `Delete ${kind}`,
    exact: true,
  });
  await dialog
    .getByRole("button", { name: `Delete ${kind}`, exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
test("sidebar names, pins, protected deletion and session record placement persist", async ({
  page,
}) => {
  await page.goto("/");
  const boot = await (await page.request.get("/api/bootstrap")).json(),
    headers = { "x-sona-token": boot.csrfToken };
  const agent = await (
    await page.request.post("/api/agents", {
      headers,
      data: { name: "Management fixture" },
    })
  ).json();
  const study = await (
    await page.request.post("/api/studies", {
      headers,
      data: { name: "Study fixture", conditions: [] },
    })
  ).json();
  await page.request.put("/api/settings/credentials/openai", {
    headers,
    data: { apiKey: "sk-proj-synthetic_management_only_key" },
  });
  const sessionResponse = await page.request.post("/api/sessions", {
    headers,
    data: { agentId: agent.id, mode: "quick" },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  await page.request.post(`/api/sessions/${session.id}/end`, {
    headers,
    data: {},
  });
  await page.reload();
  await rename(page, "agent", "Management fixture", "Renamed agent fixture");
  await rename(page, "study", "Study fixture", "Renamed study fixture");
  await rename(
    page,
    "session",
    `Session ${session.id.slice(0, 6)}`,
    "Audio session fixture",
  );
  await menu(page, "Renamed agent fixture", "Pin to top");
  await menu(page, "Renamed study fixture", "Pin to top");
  await menu(page, "Audio session fixture", "Pin to top");
  await page.reload();
  for (const name of [
    "Renamed agent fixture",
    "Renamed study fixture",
    "Audio session fixture",
  ]) {
    await expect(
      page.getByRole("button", { name: `Actions for ${name}`, exact: true }),
    ).toBeAttached();
    await menu(page, name, "Unpin");
  }
  await menu(page, "Renamed agent fixture", "Delete");
  const dialog = page.getByRole("dialog", {
    name: "Delete agent",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Delete agent", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("related sessions");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("button", { name: "Audio session fixture", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Session record actions" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".voice-area")
      .getByRole("button", { name: "Delete session", exact: true }),
  ).toHaveCount(0);
  await remove(page, "session", "Audio session fixture");
  await remove(page, "agent", "Renamed agent fixture");
  await remove(page, "study", "Renamed study fixture");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: /Actions for (Renamed agent fixture|Audio session fixture|Renamed study fixture)/,
    }),
  ).toHaveCount(0);
});
test("controls collapse, drag, keyboard resize and responsive spacing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New agent", exact: true }).click();
  const separator = page.getByRole("separator", {
    name: "Resize agent controls",
  });
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 20));
  const rect = (await separator.boundingBox())!;
  await page.mouse.move(rect.x + 5, rect.y + 150);
  await page.mouse.down();
  await page.mouse.move(rect.x - 65, rect.y + 150);
  await page.mouse.up();
  const width = await separator.getAttribute("aria-valuenow");
  expect(Number(width)).toBeGreaterThan(before + 20);
  await page.reload();
  await expect(separator).toHaveAttribute("aria-valuenow", width!);
  await page
    .getByRole("button", { name: "Collapse agent controls", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Agent controls", exact: true }),
  ).not.toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Expand agent controls", exact: true })
    .click();
  for (const [w, h] of [
    [375, 812],
    [768, 1024],
    [1024, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    if (w <= 900)
      await page
        .getByRole("button", { name: "Agent controls", exact: true })
        .click();
    await expect(
      page.getByRole("heading", { name: "Agent controls", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const gap = await page.locator(".panel-scroll").evaluate((el) => {
      const panel = el.getBoundingClientRect(),
        input = el.querySelector("input,select")!.getBoundingClientRect();
      return panel.right - input.right;
    });
    expect(gap).toBeGreaterThanOrEqual(12);
    await page.screenshot({
      path: `docs/verification/sidebar-controls-${w}.png`,
      fullPage: false,
    });
    if (w <= 900)
      await page
        .getByRole("button", { name: "Collapse agent controls", exact: true })
        .click();
  }
});

import { test, expect } from "@playwright/test";

test("keyboard plays without camera; game pause and responsive layout work", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Dinosaur game" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1906, height: 711 });
  await page.keyboard.press("Space");
  await expect(page.getByText("ON THE RUN", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Jump triggered" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Pause game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume run", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
  const card = await page
    .getByRole("region", { name: "Dinosaur game" })
    .boundingBox();
  expect(card.height).toBeGreaterThan(780);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("denied camera permission leaves keyboard fallback available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enable camera" }).click();
  await expect(page.getByRole("alert")).toContainText("permission was denied");
  await page.getByLabel("Jump gesture").selectOption("hands");
  await expect(
    page.getByRole("button", { name: "Calibrate position", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back to game" }).click();
  await page
    .getByRole("img", { name: /Dinosaur runner game/ })
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("ON THE RUN", { exact: true })).toBeVisible();
});

test("real worker loads both models locally and processes fake camera frames", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ permissions: ["camera"] });
  const page = await context.newPage();
  const external = [],
    requests = [];
  context.on("request", (request) => {
    requests.push(request.url());
    if (
      !request.url().startsWith("http://127.0.0.1:5188") &&
      !request.url().startsWith("blob:")
    )
      external.push(request.url());
  });
  // A canvas stream exercises the actual getUserMedia lifecycle and MediaPipe worker.
  // It deliberately contains no human. Real hand recognition is a manual webcam check.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      let n = 0;
      const timer = setInterval(() => {
        ctx.fillStyle = n++ % 2 ? "#eeeeee" : "#ededed";
        ctx.fillRect(0, 0, 640, 480);
      }, 40);
      const stream = canvas.captureStream(25);
      stream
        .getVideoTracks()[0]
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enable camera" }).click();
  await expect(page.getByText("LIVE", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByLabel("Jump gesture").selectOption("hands");
  await page
    .getByRole("button", { name: "Calibrate position", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Keep shoulders and at least one hand visible" }),
  ).toBeVisible({ timeout: 15000 });
  expect(external).toEqual([]);
  expect(
    requests.some((url) => url.endsWith("/models/hand_landmarker.task")),
  ).toBe(true);
  expect(
    requests.some((url) => url.endsWith("/models/pose_landmarker_lite.task")),
  ).toBe(true);
  expect(requests.some((url) => url.endsWith(".wasm"))).toBe(true);
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(page.getByText("CAMERA OFF", { exact: true })).toBeVisible();
  expect(
    await page.locator("video").evaluate((video) => video.srcObject),
  ).toBeNull();
  await context.close();
});

import { test, expect } from "@playwright/test";

test("saved camera permission is reused without requests when opening controls", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.permissions.query = async () => Object.assign(new EventTarget(), {state: "granted"});
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraRequests++;
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      setInterval(() => canvas.getContext("2d").fillRect(0, 0, 640, 480), 40);
      return canvas.captureStream(25);
    };
  });
  await page.route("**/tracking-worker.js", route => route.fulfill({
    contentType: "text/javascript", body: "self.onmessage = () => {};",
  }));
  await page.goto("/");
  await page.getByRole("button", {name: "Controls", exact: true}).click();
  await expect(page.locator(".camera-permission-help")).toContainText("Camera permission: allowed");
  expect(await page.evaluate(() => window.cameraRequests)).toBe(0);
  await page.getByRole("dialog").getByRole("button", {name: "Enable camera", exact: true}).click();
  await expect(page.getByLabel("Mirrored webcam preview")).toBeVisible();
  await page.getByRole("button", {name: "Back to game"}).click();
  await page.getByRole("button", {name: "Controls", exact: true}).click();
  await page.getByRole("button", {name: "Refresh cameras"}).click();
  await page.getByLabel("Jump gesture").selectOption("hands");
  expect(await page.evaluate(() => window.cameraRequests)).toBe(1);
  await page.getByRole("button", {name: "Cancel", exact: true}).click();
});

test("blocked camera is not requested again and permission changes are detected", async ({ page }) => {
  await page.addInitScript(() => {
    window.cameraPermissionStatus = Object.assign(new EventTarget(), {state: "denied"});
    navigator.permissions.query = async () => window.cameraPermissionStatus;
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraRequests++;
      throw new DOMException("No camera", "NotFoundError");
    };
  });
  await page.goto("/");
  await page.getByRole("button", {name: "Controls", exact: true}).click();
  await expect(page.locator(".camera-permission-help")).toContainText("Camera permission: blocked");
  await page.getByRole("dialog").getByRole("button", {name: "Enable camera", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("set Camera to Allow");
  expect(await page.evaluate(() => window.cameraRequests)).toBe(0);
  await page.evaluate(() => {
    window.cameraPermissionStatus.state = "granted";
    window.cameraPermissionStatus.dispatchEvent(new Event("change"));
  });
  await expect(page.locator(".camera-permission-help")).toContainText("Camera permission: allowed");
  await page.getByRole("dialog").getByRole("button", {name: "Enable camera", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("No webcam found");
  expect(await page.evaluate(() => window.cameraRequests)).toBe(1);
});

test("browsers without camera permission queries can still request a camera", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.permissions.query = async () => {throw new TypeError("Unsupported permission");};
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.cameraRequests++;
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.goto("/");
  await page.getByRole("button", {name: "Enable camera", exact: true}).click();
  await expect(page.getByRole("alert")).toContainText("Camera permission was denied");
  expect(await page.evaluate(() => window.cameraRequests)).toBe(1);
});

test("default T-pose gesture triggers a game jump without calibration", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); window.trackingWorker = this; }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext("2d");
      setInterval(() => ctx.fillRect(0, 0, 640, 480), 40);
      return canvas.captureStream(25);
    };
  });
  await page.route("**/tracking-worker.js", route => route.fulfill({
    contentType: "text/javascript",
    body: `let raised = false;
      self.onmessage = ({data}) => {
        if (data.type === 'init') self.postMessage({type: 'ready'});
        if (data.type === 'test-pose') raised = data.raised;
        if (data.type === 'frame') {
          const arms = [[.4,.3],[.6,.3],[raised?.25:.4,raised?.3:.45],
            [raised?.75:.6,raised?.3:.45],[raised?.1:.4,raised?.3:.6],[raised?.9:.6,raised?.3:.6]]
            .map(([x,y])=>({x,y,visibility:1,presence:1}));
          data.bitmap.close();
          self.postMessage({type:'result',timestamp:data.timestamp,arms,shoulders:arms.slice(0,2),hands:[],aspect:1});
        }
      };`,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await expect(page.getByLabel("Jump gesture")).toHaveValue("pose");
  await page.getByRole("dialog").getByRole("button", { name: "Enable camera", exact: true }).click();
  await expect(page.getByRole("status").filter({hasText: "Ready · stretch both arms"})).toBeVisible();
  await page.getByRole("button", {name: "Back to game"}).click();
  await page.evaluate(() => window.trackingWorker.postMessage({type: "test-pose", raised: true}));
  await expect(page.getByRole("status").filter({hasText: "Jump triggered"})).toBeVisible();
  await expect(page.getByText("ON THE RUN", {exact: true})).toBeVisible();
});

test("an unresponsive phone camera times out and can be retried", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      const stream = canvas.captureStream();
      window.cameraTrack = stream.getVideoTracks()[0];
      return stream;
    };
    HTMLMediaElement.prototype.play = () => new Promise(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enable camera", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.cameraTrack))).toBe(true);
  await page.clock.fastForward(16000);
  await expect(page.getByRole("alert")).toContainText("not sending video");
  await expect(page.getByRole("alert")).toContainText("Iriun or DroidCam");
  expect(await page.evaluate(() => window.cameraTrack.readyState)).toBe("ended");
  expect(await page.locator("video").evaluate((video) => video.srcObject)).toBeNull();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Enable camera", exact: true })).toBeEnabled();
});

test("camera can be enabled directly from the game on a laptop screen", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 650 });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.goto("/");
  const enable = page.getByRole("button", { name: "Enable camera", exact: true });
  await expect(enable).toBeInViewport();
  await enable.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Camera permission was denied");
});

test("webcam preview appears while gesture models are still loading", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      const timer = setInterval(() => {
        ctx.fillStyle = "#44aa66";
        ctx.fillRect(0, 0, 640, 480);
      }, 40);
      const stream = canvas.captureStream(25);
      stream.getVideoTracks()[0].addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  await page.route("**/tracking-worker.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `self.onmessage = () => self.postMessage({type: "progress", message: "Camera connected. Loading hand tracking model…"});`,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enable camera", exact: true }).click();
  await expect(page.getByText("CAMERA CONNECTED", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Mirrored webcam preview")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "First-time loading can take up to two minutes" })).toBeVisible();
  await expect(page.getByText("No calibration needed.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Mirrored webcam preview")).toBeHidden();
  expect(await page.locator("video").evaluate((video) => video.srcObject)).toBeNull();
});

test("the selected DroidCam device is requested explicitly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: "videoinput", deviceId: "built-in", label: "Laptop camera" },
      { kind: "videoinput", deviceId: "droidcam", label: "DroidCam Source 3" },
    ];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.requestedCamera = constraints;
      throw new DOMException("Disconnected", "OverconstrainedError");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "DroidCam Source 3" }),
  ).toBeAttached();
  await page.getByLabel("Camera source").selectOption("droidcam");
  await page.getByRole("dialog").getByRole("button", { name: "Enable camera" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "selected camera is unavailable",
  );
  expect(
    await page.evaluate(() => window.requestedCamera.video.deviceId),
  ).toEqual({ exact: "droidcam" });
  await expect(page.getByLabel("Camera source")).toBeEnabled();
});

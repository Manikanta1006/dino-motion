import { test, expect } from "@playwright/test";

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
  await page.getByRole("button", { name: "Enable camera" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "selected camera is unavailable",
  );
  expect(
    await page.evaluate(() => window.requestedCamera.video.deviceId),
  ).toEqual({ exact: "droidcam" });
  await expect(page.getByLabel("Camera source")).toBeEnabled();
});

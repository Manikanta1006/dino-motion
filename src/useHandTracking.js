import { useCallback, useEffect, useRef, useState } from "react";
import { bodySamples, GestureController, PoseJumpController } from "./gesture.js";

const connections = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];
const initial = {
  status: "Camera is off · keyboard is ready",
  calibrated: false,
  direction: "Neutral",
  hands: [],
  progress: 0,
};
async function cameraPermission() {
  try {
    return await navigator.permissions?.query({ name: "camera" });
  } catch {
    // Some browsers support getUserMedia but not querying camera permission.
    return null;
  }
}
const permissionHelp = "Camera permission was denied. Open the site controls beside the browser address bar, set Camera to Allow, then try again. If it still fails, allow camera access for your browser in Windows Settings > Privacy & security > Camera.";

export function useHandTracking(onJump, threshold, gestureMode = "pose") {
  const videoRef = useRef(null),
    overlayRef = useRef(null);
  const controller = useRef(new GestureController({ threshold }));
  const poseController = useRef(new PoseJumpController());
  const modeRef = useRef(gestureMode);
  useEffect(() => {
    modeRef.current = gestureMode;
    poseController.current.reset();
    controller.current.reset();
  }, [gestureMode]);
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;
  const session = useRef(null);
  const [camera, setCamera] = useState("off");
  const [previewReady, setPreviewReady] = useState(false);
  const [feedback, setFeedback] = useState(initial);
  const [error, setError] = useState("");
  const [fps, setFps] = useState(0);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [permission, setPermission] = useState("unknown");
  useEffect(() => {
    let disposed = false, status;
    const changed = () => {
      if (!disposed) setPermission(status.state);
    };
    cameraPermission().then((result) => {
      if (disposed || !result) return;
      status = result;
      changed();
      status.addEventListener?.("change", changed);
    });
    return () => {
      disposed = true;
      status?.removeEventListener?.("change", changed);
    };
  }, []);
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        available.filter(
          (device) => device.kind === "videoinput" && device.deviceId,
        ),
      );
      setDeviceError("");
    } catch {
      setDeviceError(
        "Camera list is unavailable. You can still try the browser default camera.",
      );
    }
  }, []);
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () =>
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        refreshDevices,
      );
  }, [refreshDevices]);

  const dispose = useCallback(() => {
    const run = session.current;
    session.current = null;
    if (run) {
      cancelAnimationFrame(run.raf);
      clearTimeout(run.timeout);
      run.worker?.terminate();
      run.stream?.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    const canvas = overlayRef.current;
    canvas?.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    controller.current.reset();
    poseController.current.reset();
  }, []);
  const stop = useCallback(() => {
    dispose();
    setPreviewReady(false);
    setCamera("off");
    setFeedback(initial);
    setFps(0);
  }, [dispose]);
  useEffect(() => dispose, [dispose]);
  useEffect(() => {
    controller.current.configure(threshold);
  }, [threshold]);
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && session.current)
        session.current.lastFrame = performance.now();
      controller.current.states = {};
      poseController.current.reset();
      if (controller.current.calibration)
        controller.current.calibrate(performance.now());
      overlayRef.current?.getContext("2d").clearRect(0, 0, 640, 480);
      if (document.hidden && session.current)
        setFeedback((f) => ({ ...f, status: "Tab hidden · gestures paused" }));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const start = useCallback(async () => {
    // Repeated clicks must not replace an active stream or pending permission request.
    if (session.current) return;
    dispose();
    setPreviewReady(false);
    setError("");
    setCamera("loading");
    setFeedback({ ...initial, status: "Opening camera…" });
    const run = {
      raf: 0,
      timeout: 0,
      stream: null,
      worker: null,
      busy: false,
      sent: 0,
      videoTime: -1,
      lastFrame: performance.now(),
    };
    session.current = run;
    const active = () => session.current === run;
    const fail = (message) => {
      if (!active()) return;
      dispose();
      setPreviewReady(false);
      setCamera("error");
      setError(message);
      setFeedback(initial);
      setFps(0);
    };
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs localhost or HTTPS and a browser with webcam support.",
        );
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (policy?.allowsFeature && !policy.allowsFeature("camera"))
        throw new Error("This embedded page blocks camera access. Open the game in a separate browser tab, then enable the camera there.");
      const permissionStatus = await cameraPermission();
      if (!active()) return;
      if (permissionStatus) setPermission(permissionStatus.state);
      if (permissionStatus?.state === "denied") {
        fail(permissionHelp);
        return;
      }
      setFeedback({ ...initial, status: permissionStatus?.state === "granted"
        ? "Permission already allowed · opening camera…"
        : "Choose Allow in your browser's camera prompt. If offered, choose Allow while visiting the site rather than Allow this time." });
      if (
        !window.Worker ||
        !window.createImageBitmap ||
        !window.OffscreenCanvas
      )
        throw new Error(
          "This browser cannot run local tracking. Try a current Chrome or Edge browser; keyboard controls are available.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          ...(deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: "user" }),
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      if (!active()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      run.stream = stream;
      // A successful stream is authoritative when the Permissions API is unavailable.
      setPermission("granted");
      run.timeout = setTimeout(
        () => fail(
          "The camera connected but is not sending video. If using Iriun or DroidCam, check the live preview in its PC client and reconnect your phone, then enable the camera again.",
        ),
        15000,
      );
      void refreshDevices(); // Permission reveals device names without another camera request.
      stream
        .getVideoTracks()[0]
        .addEventListener("ended", () =>
          fail(
            "Camera disconnected. Reconnect it and enable the camera again.",
          ),
        );
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (!active()) return;
      clearTimeout(run.timeout);
      setPreviewReady(true);
      setFeedback({
        ...initial,
        status: "Loading local hand and shoulder models…",
      });
      const worker = (run.worker = new Worker(
        `${import.meta.env.BASE_URL}tracking-worker.js`,
      ));
      run.timeout = setTimeout(
        () =>
          fail(
            "Gesture models took too long to download. Check your internet connection, reload the page, and enable the camera again.",
          ),
        120000,
      );
      worker.onerror = (event) => {
        event.preventDefault();
        fail(
          "Gesture tracking could not start. Reload the page in current Chrome or Edge and try again.",
        );
      };
      worker.onmessage = ({ data }) => {
        if (!active()) return;
        if (data.type === "progress") {
          setFeedback((f) => ({ ...f, status: data.message }));
          return;
        }
        if (data.type === "error") {
          fail(`Local tracking failed: ${data.message}`);
          return;
        }
        if (data.type === "ready") {
          clearTimeout(run.timeout);
          run.lastFrame = performance.now();
          setCamera("on");
          setFeedback({
            ...initial,
            status: modeRef.current === "pose"
              ? "Camera ready · lower both arms, then stretch them sideways to jump"
              : "Camera ready · calibrate to enable gestures",
          });
          run.raf = requestAnimationFrame(pump);
        }
        if (data.type === "result") {
          run.busy = false;
          clearTimeout(run.timeout);
          const now = performance.now();
          setFps(Math.round(1000 / Math.max(1, now - run.lastFrame)));
          run.lastFrame = now;
          if (document.hidden || now - data.timestamp > 400) {
            controller.current.states = {};
            poseController.current.reset();
            setFeedback((f) => ({
              ...f,
              status: document.hidden
                ? "Tab hidden · gestures paused"
                : "Tracking is slow · gestures paused",
            }));
            return;
          }
          const next = {
            ...(modeRef.current === "pose"
              ? poseController.current.update(data, data.timestamp)
              : controller.current.update(bodySamples(data), data.timestamp)),
            calibratedHands: Object.keys(controller.current.baselines),
          };
          setFeedback(next);
          drawOverlay(overlayRef.current, data, controller.current.baselines);
          if (next.jump) jumpRef.current("gesture");
        }
      };
      async function pump(now) {
        if (!active()) return;
        run.raf = requestAnimationFrame(pump);
        const video = videoRef.current;
        if (
          document.hidden ||
          run.busy ||
          now - run.sent < 50
        )
          return;
        if (video.readyState < 2 || video.currentTime === run.videoTime) {
          if (now - run.lastFrame > 15000) {
            fail("The camera stopped sending video. Reconnect your webcam or phone camera in its PC client, then enable the camera again.");
            return;
          }
          if (now - run.lastFrame > 800) {
            controller.current.states = {};
            poseController.current.reset();
            setFeedback((f) => ({
              ...f,
              status: "Waiting for fresh camera frames…",
            }));
          }
          return;
        }
        run.busy = true;
        run.sent = now;
        run.videoTime = video.currentTime;
        try {
          const bitmap = await createImageBitmap(video);
          if (!active()) {
            bitmap.close();
            return;
          }
          worker.postMessage({ type: "frame", bitmap, timestamp: now }, [
            bitmap,
          ]);
          run.timeout = setTimeout(
            () => fail("Tracking stopped responding. Enable the camera again."),
            15000,
          );
        } catch (e) {
          fail(`Could not read camera frame: ${e.message}`);
        }
      }
      worker.postMessage({ type: "init" });
    } catch (e) {
      const messages = {
        NotAllowedError:
          permissionHelp,
        NotFoundError:
          "No webcam found. Connect a camera, or play with Space / ↑.",
        NotReadableError:
          "The camera is busy or unavailable. Close other camera apps and try again.",
        OverconstrainedError:
          "The selected camera is unavailable. Refresh the camera list and choose a connected camera.",
      };
      fail(messages[e.name] || e.message);
    }
  }, [dispose, deviceId, refreshDevices]);
  const calibrate = () => {
    if (camera !== "on") return;
    controller.current.calibrate(performance.now());
    setFeedback({
      ...initial,
      calibrating: true,
      status: "Hold your comfortable neutral position…",
    });
  };
  return {
    videoRef,
    overlayRef,
    camera,
    previewReady,
    feedback,
    error,
    fps,
    devices,
    deviceId,
    setDeviceId,
    deviceError,
    permission,
    refreshDevices,
    start,
    stop,
    calibrate,
  };
}

function drawOverlay(canvas, data, baselines) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (data.arms?.length === 6) {
    ctx.strokeStyle = "#c2f379";
    ctx.lineWidth = 3;
    for (const [from, to] of [[0, 1], [0, 2], [2, 4], [1, 3], [3, 5]]) {
      const a = data.arms[from], b = data.arms[to];
      if ((a.visibility ?? 1) < 0.6 || (b.visibility ?? 1) < 0.6) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }
  if (data.shoulders?.every((p) => (p.visibility ?? 1) >= 0.6)) {
    const [a, b] = data.shoulders;
    ctx.strokeStyle = "#e2edb7";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
    const width = Math.hypot((a.x - b.x) * data.aspect, a.y - b.y);
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    for (const value of Object.values(baselines)) {
      const y = ((a.y + b.y) / 2 + value * width) * h;
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(w - 20, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  for (const points of data.hands) {
    ctx.strokeStyle = "#c2f379";
    ctx.lineWidth = 2;
    for (const [a, b] of connections) {
      ctx.beginPath();
      ctx.moveTo(points[a].x * w, points[a].y * h);
      ctx.lineTo(points[b].x * w, points[b].y * h);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x * w, point.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

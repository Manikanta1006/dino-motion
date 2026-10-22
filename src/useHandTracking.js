import { useCallback, useEffect, useRef, useState } from "react";
import { bodySamples, GestureController } from "./gesture.js";

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
export function useHandTracking(onJump, threshold) {
  const videoRef = useRef(null),
    overlayRef = useRef(null);
  const controller = useRef(new GestureController({ threshold }));
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;
  const session = useRef(null);
  const [camera, setCamera] = useState("off");
  const [feedback, setFeedback] = useState(initial);
  const [error, setError] = useState("");
  const [fps, setFps] = useState(0);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [deviceError, setDeviceError] = useState("");
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
  }, []);
  const stop = useCallback(() => {
    dispose();
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
      controller.current.states = {};
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
    dispose();
    setError("");
    setCamera("loading");
    setFeedback({ ...initial, status: "Waiting for camera permission…" });
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
            "Tracking took too long to load. Run npm run assets, then try again.",
          ),
        45000,
      );
      worker.onerror = (event) => {
        event.preventDefault();
        fail(
          "Tracking worker failed to load. Run npm run assets and use a current Chrome or Edge browser.",
        );
      };
      worker.onmessage = ({ data }) => {
        if (!active()) return;
        if (data.type === "error") {
          fail(`Local tracking failed: ${data.message}`);
          return;
        }
        if (data.type === "ready") {
          clearTimeout(run.timeout);
          setCamera("on");
          setFeedback({
            ...initial,
            status: "Camera ready · calibrate to enable gestures",
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
            setFeedback((f) => ({
              ...f,
              status: document.hidden
                ? "Tab hidden · gestures paused"
                : "Tracking is slow · gestures paused",
            }));
            return;
          }
          const next = {
            ...controller.current.update(bodySamples(data), data.timestamp),
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
          now - run.sent < 50 ||
          video.readyState < 2
        )
          return;
        if (video.currentTime === run.videoTime) {
          if (now - run.lastFrame > 800) {
            controller.current.states = {};
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
          "Camera permission was denied. Allow camera access in your browser settings, then try again.",
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
    feedback,
    error,
    fps,
    devices,
    deviceId,
    setDeviceId,
    deviceError,
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

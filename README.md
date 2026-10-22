# Dino Motion

A complete React + Vite dinosaur runner with browser-local MediaPipe Hand Landmarker and Pose Landmarker tracking, an HTML5 Canvas game, and keyboard fallback. No existing source was present in the supplied workspace, so this is a standalone implementation.

## Install and run

Use Node.js 24 LTS (tested with Node 24) and npm.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5187** in current Chrome or Edge. `npm install` copies the matching MediaPipe WASM runtime and downloads the two versioned models once. Internet access is needed for installation, but webcam processing and all runtime asset requests stay on the local origin. No video, landmarks, or images are uploaded or stored. Only your best game score is saved in localStorage. The app uses port 5187 with strict port selection to avoid accidentally opening a different local project. Browser tests launch their own server on port 5188.

If an asset download fails, retry `npm run assets`. If dependencies are already installed, `npm ci` reproduces the lockfile. Do not open `index.html` as a file; webcam access needs localhost or HTTPS. A remotely hosted build needs HTTPS.

```powershell
npm run build
npm run preview
```

The build includes the worker, models, and WASM files in `dist/`. The preview URL is http://127.0.0.1:4173. Serve the complete `dist/` directory at the site's root. No external CDN or font service is used at runtime. After the local server is running and assets have been installed, internet access is unnecessary.

## Playing with hands

The game fills the browser window by default. **Controls** opens camera setup, calibration, sensitivity, and instructions. Opening Controls pauses an active run; select **Back to game**, then **Resume run** to continue. Camera processing continues when the setup dialog is closed, and movement/detection feedback appears on the playfield. **Fullscreen** expands the game beyond browser chrome when supported; Escape exits fullscreen (or closes an open setup dialog).

1. Open **Controls**, select **Enable camera**, and allow camera access. Nothing is captured before this action. Models load in a worker; the preview becomes live when tracking is ready.
2. Sit or stand comfortably, facing the camera naturally. Include both shoulders and at least one whole hand. Put your hand near your torso with room to move in either direction; resting it below your webcam's view will prevent calibration.
3. Select **Calibrate position**. Hold your comfortable neutral position still for about 1.6 seconds. You can calibrate one hand or both; each visible, stable hand gets its own baseline. Recalibrate with both hands visible to add the other hand later.
4. Select **Back to game**, then **Start running**, or make a gesture to start with a jump. Move either calibrated hand upward **or** downward from neutral. A sustained threshold crossing triggers one jump. The setup dialog suppresses game inputs while open.
5. Return your hand to its calibrated neutral position for at least 140 ms before another gesture. Holding a raised/lowered hand does not repeat. Moving straight from high to low without a neutral dwell does not rearm.
6. Adjust **Gesture sensitivity**: higher sensitivity means a smaller movement. Changing sensitivity disarms both hands until neutral, preventing accidental jumps.

**Space** or **Arrow Up** jumps without camera access. Keys do not override standard button/input keyboard interactions; click the game or a noninteractive area after editing controls. A jump in midair is ignored. At game over, a jump starts another run; **Run again** restarts on the ground. Pause/resume is available beside the game. Changing browser tabs pauses the run; resume it explicitly.

## Detection and body calibration

### Phone camera / Iriun or DroidCam

For **Iriun Webcam**, install the phone app and the Windows client from [Iriun's official site](https://iriun.com/). Connect both devices to the same Wi-Fi and keep Iriun open on both. Once the PC client shows the phone preview, open the game's **Controls → Refresh cameras → Camera source**, select **Iriun Webcam**, and click **Enable camera**. Calibrate again for the phone's view. No IP or port is entered in the game; Iriun handles the phone connection and exposes a Windows webcam device. If camera names are hidden, allow browser camera access once, turn the camera off, and refresh the camera list.

Install the [DroidCam Windows client matching your phone app](https://www.dev47apps.com/droidcam/windows/), then connect the phone from that client using its displayed IP address and port. The classic client supports WiFi/LAN and USB; see the [official connection guide](https://www.dev47apps.com/droidcam/connect/). For WiFi, connect the computer and phone to the same reachable local network. A phone hotspot can also work when the computer is connected to it; use the phone's current reachable IP rather than assuming an old address stays valid.

In the game, open **Controls → Refresh cameras → Camera source**, choose the installed DroidCam video device, then select **Enable camera**. If names are hidden, allow camera access once, turn the camera off, and refresh the list. Turn the camera off before switching sources, then recalibrate for the new view. If DroidCam is missing, finish installing/connecting its Windows client and restart your browser. The game uses the virtual webcam exposed by Windows; it does not directly fetch a phone IP/video URL. The phone-to-PC stream is handled by DroidCam; landmark processing stays in the browser.

`bodySamples()` uses only hand palm landmarks **0, 5, 9, 13, 17** and pose shoulders **11, 12**. The worker sends only those shoulder landmarks to the main thread. No face-orientation measurement, face-direction flag, compass direction, or head rotation is read or used as a jump condition. Pose Landmarker internally estimates a full pose, but only shoulders are consumed by this app.

For each hand, the raw measurement is:

```text
shoulderWidth = hypot((leftShoulder.x - rightShoulder.x) * videoAspect,
                       leftShoulder.y - rightShoulder.y)
relativeHandY = (mean(palmLandmark.y) - shoulderMidpoint.y) / shoulderWidth
displacement = smoothedRelativeHandY - calibratedRelativeHandY
```

Image Y increases downward, so negative displacement is upward. Translating the whole body in the image or uniformly changing its image scale cancels in this ratio. Small changes in posture/framing are handled by recomputing shoulder reference points each frame. A substantial change in resting hand position, shoulder rotation/occlusion, or camera angle should be followed by recalibration. This is a single-player tracker; keep other people out of frame.

Calibration requires visible, confident shoulders, a confident hand, at least 16 samples, and a per-hand standard deviation below 0.075 shoulder widths. Missing hands/body restart the calibration window; unstable hands are excluded. A hand not present during calibration cannot trigger gestures.

Gesture processing uses:

| Setting                | Value                                              |
| ---------------------- | -------------------------------------------------- |
| Inference target       | At most 20 FPS, one frame in flight                |
| Smoothing              | Time-based exponential filter, 65 ms time constant |
| Threshold              | 0.10–0.52 shoulder widths, adjustable in the UI    |
| Neutral band           | 38% of current threshold (hysteresis)              |
| Neutral dwell          | 140 ms                                             |
| Movement confirmation  | 65 ms beyond threshold                             |
| Shared jump cooldown   | 850 ms                                             |
| Tracking gap disarm    | Over 240 ms between valid samples                  |
| Stale result rejection | Frame results over 400 ms old                      |

Each hand has its own filter, candidate, and armed state. A shared cooldown prevents simultaneous hands from issuing two jumps. A movement during cooldown is consumed, so it does not fire later while held. Losing a hand or shoulders clears the corresponding live state; reacquisition must dwell at neutral first. Tracking and calibration do not generate jumps while the tab is hidden. Permission denial, missing/busy/disconnected cameras, model-load errors, and worker stalls show actionable feedback while leaving keyboard play available.

Inference runs in a **classic Web Worker** using the packaged MediaPipe IIFE bundle, which supports MediaPipe's `importScripts` WASM loader. Each frame is transferred as an ImageBitmap and closed after processing. Inference uses the CPU delegate; MediaPipe may still use WebGL for image preprocessing, so the browser needs OffscreenCanvas and WebGL support. Actual tracking FPS depends on hardware. On a slow computer, use good lighting, close other camera apps, and use keyboard fallback if inference cannot deliver fresh results. Camera tracks and the worker stop when the camera is turned off or the app unmounts.

## Project structure

```text
Dinosar/
├── index.html
├── package.json / package-lock.json
├── vite.config.js
├── playwright.config.js
├── scripts/
│   └── prepare-assets.mjs       # Install-time local runtime/model preparation
├── public/
│   ├── tracking-worker.js      # Hand + shoulder inference, no network uploads
│   ├── mediapipe/              # Generated matching JS + WASM runtime
│   └── models/                 # Generated hand and pose model assets
├── src/
│   ├── main.jsx
│   ├── App.jsx                 # Controls, calibration, status, sensitivity
│   ├── Game.jsx                # Canvas runner, physics, collisions, keyboard
│   ├── gesture.js              # Testable body-relative gesture state machine
│   ├── useHandTracking.js      # Webcam/worker lifecycle + landmark overlay
│   └── styles.css
└── tests/
    ├── gesture.test.js         # Synthetic landmark/gesture behavior tests
    └── browser/app.spec.js     # UI + actual worker/model smoke tests
```

Generated models/runtime are ignored by Git and recreated during installation. They must remain present in the deployed build.

## Testing

```powershell
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Unit tests cover upward/downward one-shot events, either hand, neutral reset, jitter, debounce, cooldown consumption, missing hands/body, camera gaps, sensitivity changes, recalibration, unstable calibration, framing translation/scale, and face-direction independence. Browser tests cover keyboard play, pause, mobile overflow, permission denial, and **actual local loading/inference of both MediaPipe models** against a synthetic canvas camera stream. The stream contains no person; it verifies startup and missing-body handling rather than real-world recognition accuracy.

Manual webcam acceptance checks:

| Check                                                                          | Expected result                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Calibrate seated, then standing                                                | Comfortable neutral position is accepted in both cases |
| Left hand up, reset, left hand down                                            | One jump per excursion                                 |
| Right hand up, reset, right hand down                                          | Same behavior after calibrating that hand              |
| Hold either raised/lowered hand for several seconds                            | No repeated jump                                       |
| Move high to low without dwelling at neutral                                   | No new event                                           |
| Return to neutral, then move again after cooldown                              | A new jump                                             |
| Raise both hands together                                                      | At most one event                                      |
| Look at the camera or turn your head with hands still                          | No jump from head direction                            |
| Move head while doing a valid hand gesture                                     | Gesture still works if shoulders/hands remain tracked  |
| Small torso shift or camera-distance change with hand resting relative to body | No jump from framing alone                             |
| Hide hand, return it raised                                                    | No jump until neutral rearming                         |
| Hide shoulders or leave the frame                                              | Gestures pause; keyboard continues                     |
| Change sensitivity while holding a hand away from neutral                      | No surprise jump                                       |
| Deny permission / unplug webcam                                                | Clear error; keyboard continues                        |
| Switch tabs and return                                                         | Game stays paused; stale camera motion does not jump   |
| Turn off camera                                                                | Browser's camera indicator turns off                   |
| Browser Network panel during play                                              | Requests only to the local app origin                  |

Real-world recognition should be checked with your webcam and lighting; synthetic tests cannot validate an individual camera, physical movement range, or detector accuracy.

## API references

- [MediaPipe Hand Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [MediaPipe Pose Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [MediaPipe Hand Landmarker implementation](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/hand_landmarker/hand_landmarker.ts)

The local MediaPipe package and Google model assets retain their upstream terms. The runner art and game implementation here are generated source assets; this does not modify Chrome's internal `chrome://dino` page.

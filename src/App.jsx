import { useEffect, useRef, useState } from "react";
import Game from "./Game.jsx";
import { useHandTracking } from "./useHandTracking.js";

const pad = (n) => String(n || 0).padStart(5, "0");
function Icon({ type, size = 20 }) {
  const paths = {
    camera: "M3 7h12v10H3z M15 10l6-3v10l-6-3",
    arrow: "M12 20V4 M6 10l6-6 6 6",
    calibration: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M9 12h6 M12 9v6",
    shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
    play: "M8 4l12 8-12 8z",
    reset: "M4 10a8 8 0 1 1 1 8 M4 4v6h6",
    pause: "M8 5v14 M16 5v14",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[type] || paths.arrow} />
    </svg>
  );
}
export default function App() {
  const game = useRef(null);
  const settingsDialog = useRef(null);
  const screenRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const [gameState, setGameState] = useState({
    mode: "idle",
    score: 0,
    best: 0,
    jumps: 0,
  });
  const [sensitivity, setSensitivity] = useState(55);
  const [gestureMode, setGestureMode] = useState("pose");
  const [jumpInfo, setJumpInfo] = useState({ at: 0, source: "" });
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const threshold = 0.52 - sensitivity * 0.0042;
  const tracking = useHandTracking((source) => {
    if (!settingsDialog.current?.open) game.current?.jump(source);
  }, threshold, gestureMode);
  const { camera, feedback, error, fps } = tracking;
  const ready = camera === "on";
  const notifyJump = (source) => {
    setJumpInfo({ at: Date.now(), source });
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 650);
  };
  const active = gameState.mode === "running";
  const openControls = () => {
    if (active) game.current.pause();
    settingsDialog.current.showModal();
  };
  const toggleFullscreen = async () => {
    setScreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await screenRef.current.requestFullscreen();
    } catch {
      setScreenError(
        "Fullscreen is unavailable. The game still fills this browser window.",
      );
    }
  };
  return (
    <div className="app-shell immersive" ref={screenRef}>
      <header className="topbar">
        <a href="./" className="brand" aria-label="Dino Motion home">
          <span className="brand-mark">
            d<span>m</span>
          </span>
          <span>
            DINO<span className="brand-light">MOTION</span>
          </span>
        </a>
        <span className="local-badge">
          <span className="dot" /> ON-DEVICE PLAY
        </span>
        <a className="text-link" href="#how-to">
          How to play <span>↗</span>
        </a>
      </header>
      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">THE CLASSIC RUNNER. A NEW WAY TO MOVE.</p>
            <h1>
              A little movement.
              <br />
              <span>A longer run.</span>
            </h1>
            <p className="intro-copy">
              Meet your next high score. Stretch both arms sideways
              <br className="desktop-break" /> to jump, find your rhythm, and
              keep the dino running.
            </p>
          </div>
          <div className="intro-stamp">
            <span>
              NO CONTROLLER
              <br />
              NECESSARY
            </span>
            <div>↗</div>
            <small>JUST YOU & YOUR WEBCAM</small>
          </div>
        </section>
        <section
          className={`game-card ${flash ? "jump-flash" : ""}`}
          aria-label="Dinosaur game"
        >
          <div className="game-top">
            <span className="section-kicker">
              <span className={`dot ${active ? "pulse" : ""}`} />
              {active
                ? "ON THE RUN"
                : gameState.mode === "over"
                  ? "END OF RUN"
                  : gameState.mode === "paused"
                    ? "TAKE A BREATHER"
                    : "READY WHEN YOU ARE"}
            </span>
            <div className="scores">
              <span>
                BEST <b>{pad(gameState.best)}</b>
              </span>
              <span>
                SCORE <b className="current-score">{pad(gameState.score)}</b>
              </span>
            </div>
          </div>
          <div className="stage">
            <Game ref={game} onState={setGameState} onJump={notifyJump} />
            {!active && (
              <div className="game-overlay">
                <div className="overlay-caption">
                  {gameState.mode === "idle"
                    ? "Small moves. Big adventures."
                    : gameState.mode === "over"
                      ? "One more run?"
                      : "A moment to reset."}
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    gameState.mode === "paused"
                      ? game.current.pause()
                      : game.current.start()
                  }
                >
                  <Icon
                    type={gameState.mode === "over" ? "reset" : "play"}
                    size={17}
                  />
                  {gameState.mode === "idle"
                    ? "Start running"
                    : gameState.mode === "over"
                      ? "Run again"
                      : "Resume run"}
                </button>
                <small>
                  {gameState.mode === "over"
                    ? `You made it to ${gameState.score}. Your next best is waiting.`
                    : gameState.mode === "paused"
                      ? "Select Resume run when you’re ready."
                      : "Or press Space / ↑ to start with a jump"}
                </small>
              </div>
            )}
          </div>
          <div className="game-bottom">
            <span>
              <kbd>SPACE</kbd> <span className="or">or</span> <kbd>↑</kbd> to
              jump <span className="divider">/</span>{" "}
              {ready && (gestureMode === "pose" || feedback.calibrated)
                ? "Hand controls connected"
                : "Keyboard always available"}
            </span>
            <div>
              {!ready && camera !== "loading" && (
                <button
                  className="screen-button"
                  onClick={() => {
                    openControls();
                    void tracking.start();
                  }}
                  aria-haspopup="dialog"
                >
                  <Icon type="camera" size={16} /> Enable camera
                </button>
              )}
              <button
                className="screen-button"
                onClick={openControls}
                aria-haspopup="dialog"
              >
                <Icon type="calibration" size={16} /> Controls
              </button>
              {document.fullscreenEnabled && (
                <button className="screen-button" onClick={toggleFullscreen}>
                  {fullscreen ? "Exit fullscreen" : "Fullscreen"}
                </button>
              )}
              <span
                className={`jump-indicator ${flash ? "lit" : ""}`}
                role="status"
              >
                {flash
                  ? "↗ Jump triggered"
                  : jumpInfo.at
                    ? `Last jump · ${jumpInfo.source}`
                    : "Waiting for your first jump"}
              </span>
              <button
                className="icon-button"
                aria-label={
                  gameState.mode === "paused" ? "Resume game" : "Pause game"
                }
                disabled={!["running", "paused"].includes(gameState.mode)}
                onClick={() => game.current.pause()}
              >
                <Icon
                  type={gameState.mode === "paused" ? "play" : "pause"}
                  size={16}
                />
              </button>
            </div>
          </div>
          <div className="live-feedback" aria-live="polite">
            {screenError ||
              (ready ? `${feedback.direction} · ${feedback.status}` : "")}
          </div>
        </section>
        <dialog
          className="settings-dialog"
          ref={settingsDialog}
          aria-labelledby="settings-title"
        >
          <div className="settings-dialog-header">
            <h2 id="settings-title">Camera & gesture controls</h2>
            <button
              className="screen-button"
              onClick={() => settingsDialog.current.close()}
              autoFocus
            >
              Back to game <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="control-grid">
            <section className="panel camera-panel">
              <div className="panel-heading">
                <h2>
                  <Icon type="camera" /> Your movement, live
                </h2>
                <span className={`pill ${ready ? "connected" : ""}`}>
                  <span className="dot" />
                  {ready
                    ? "LIVE"
                    : camera === "loading"
                      ? tracking.previewReady ? "CAMERA CONNECTED" : "CONNECTING"
                      : "CAMERA OFF"}
                </span>
              </div>
              <div className="camera-source">
                <label htmlFor="camera-source">Camera source</label>
                <div className="camera-source-row">
                  <select
                    id="camera-source"
                    value={tracking.deviceId}
                    onChange={(event) =>
                      tracking.setDeviceId(event.target.value)
                    }
                    disabled={ready || camera === "loading"}
                    aria-describedby="camera-source-help"
                  >
                    <option value="">Browser default camera</option>
                    {tracking.deviceId &&
                      !tracking.devices.some(
                        (device) => device.deviceId === tracking.deviceId,
                      ) && (
                        <option value={tracking.deviceId}>
                          Selected camera unavailable
                        </option>
                      )}
                    {tracking.devices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <button
                    className="screen-button"
                    onClick={tracking.refreshDevices}
                  >
                    Refresh cameras
                  </button>
                </div>
                <p id="camera-source-help">
                  {ready || camera === "loading"
                    ? "Turn off the camera before choosing another source. Recalibrate after switching."
                    : "For your phone, connect Iriun or DroidCam using its phone app and PC client first, then select its camera here. Enable once to reveal camera names if needed."}
                </p>
                <p className="camera-permission-help" role="status">
                  {tracking.permission === "granted"
                    ? "Camera permission: allowed. Enable camera starts video using the browser's saved permission."
                    : tracking.permission === "denied"
                      ? "Camera permission: blocked. Use the site controls beside the address bar to set Camera to Allow, then enable the camera."
                      : "Your browser needs camera permission. Choose Allow while visiting the site if offered. Allow this time may ask again later."}
                  {" "}<a href={window.location.href} target="_blank" rel="noreferrer">Open game in a separate tab</a>
                  {" · "}<a href="https://support.google.com/chrome/answer/2693767?hl=en" target="_blank" rel="noreferrer">Camera permission help</a>
                </p>
                {tracking.deviceError && (
                  <p role="status">{tracking.deviceError}</p>
                )}
              </div>
              <div className={`camera-preview ${tracking.previewReady ? "is-live" : ""}`}>
                <video
                  ref={tracking.videoRef}
                  muted
                  autoPlay
                  playsInline
                  aria-label="Mirrored webcam preview"
                />
                <canvas
                  ref={tracking.overlayRef}
                  width="640"
                  height="480"
                  aria-label="Hand landmarks and shoulder reference overlay"
                />
                {!tracking.previewReady && (
                  <div className="camera-placeholder">
                    <span className="camera-icon">
                      <Icon type="camera" size={28} />
                    </span>
                    <strong>
                      {camera === "loading"
                        ? "Getting your camera ready…"
                        : "Make room for a little motion"}
                    </strong>
                    <p>
                      {camera === "loading"
                        ? feedback.status
                        : "Turn on your camera to play with your hands."}
                    </p>
                    {camera !== "loading" && (
                      <button className="primary" onClick={tracking.start}>
                        <Icon type="camera" size={16} />
                        Enable camera
                      </button>
                    )}
                  </div>
                )}
                {tracking.previewReady && (
                  <>
                    <span className="preview-tag">MIRRORED PREVIEW</span>
                    {ready && <span className="fps">{fps} FPS</span>}
                    <span className="landmark-key">
                      <i /> {gestureMode === "pose" ? "Arm pose" : "Hand landmarks"} <i /> Shoulder reference
                    </span>
                  </>
                )}
              </div>
              {camera === "loading" && tracking.previewReady && (
                <p role="status">{feedback.status} First-time loading can take up to two minutes.</p>
              )}
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              <div className="camera-footer">
                <span>
                  <Icon type="shield" size={16} />
                  Your camera stays yours. Processed in this browser.
                </span>
                {["on", "loading"].includes(camera) && (
                  <button className="text-button" onClick={tracking.stop}>
                    {camera === "loading" ? "Cancel" : "Turn off"}
                  </button>
                )}
              </div>
            </section>
            <section className="panel settings-panel">
              <div className="panel-heading">
                <h2>
                  <Icon type="calibration" /> Gesture controls
                </h2>
                <span className="tiny-label">BODY RELATIVE</span>
              </div>
              <div className="calibration-block">
                <label htmlFor="gesture-mode">Jump gesture</label>
                <select id="gesture-mode" value={gestureMode} onChange={(event) => setGestureMode(event.target.value)}>
                  <option value="pose">Arms sideways (T-pose)</option>
                  <option value="hands">Calibrated hand movement</option>
                </select>
                {gestureMode === "pose" ? <>
                  <h3>Stretch your arms to jump</h3>
                  <svg viewBox="0 0 100 80" width="100" height="80" role="img" aria-label="T-pose: both arms straight out sideways" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                    <circle cx="50" cy="12" r="7" /><path d="M50 19v34 M12 30h76 M50 53L38 73 M50 53l12 20" />
                  </svg>
                  <p>Start with both arms lowered. Stretch both arms out sideways at shoulder height and hold briefly to jump. Lower your arms before repeating. Keep both shoulders, elbows and wrists in view. No calibration needed.</p>
                </> : <>
                <div className="step-label">
                  <span>01</span>
                  <h3>Find your neutral</h3>
                  <span
                    className={`calibration-status ${feedback.calibrated ? "done" : ""}`}
                  >
                    {feedback.calibrated
                      ? "✓ Calibrated"
                      : feedback.calibrating
                        ? "Calibrating…"
                        : "Not calibrated"}
                  </span>
                </div>
                <p>
                  Sit or stand comfortably. Keep your shoulders and hands in
                  view, with room to move up and down. Look naturally at the
                  camera.
                </p>
                <button
                  className="secondary"
                  disabled={!ready || feedback.calibrating}
                  onClick={tracking.calibrate}
                >
                  <Icon type="calibration" size={17} />
                  {feedback.calibrating
                    ? "Hold still for a moment…"
                    : feedback.calibrated
                      ? "Recalibrate position"
                      : "Calibrate position"}
                  <span aria-hidden="true">↗</span>
                </button>
                {feedback.calibrating && (
                  <progress
                    max="1"
                    value={feedback.progress}
                    aria-label="Calibration progress"
                  />
                )}
                {feedback.calibrated && (
                  <p>
                    Calibrated hands: {feedback.calibratedHands?.join(" + ")}.
                    Recalibrate to add another hand.
                  </p>
                )}
                </>}
              </div>
              {gestureMode === "hands" &&
              <div className="sensitivity-block">
                <div className="step-label">
                  <span>02</span>
                  <h3>Make it feel right</h3>
                  <output htmlFor="sensitivity">{sensitivity}%</output>
                </div>
                <label htmlFor="sensitivity">Gesture sensitivity</label>
                <input
                  id="sensitivity"
                  type="range"
                  min="0"
                  max="100"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  style={{ "--range-fill": `${sensitivity}%` }}
                />
                <div className="range-labels">
                  <span>Large movements</span>
                  <span>Small movements</span>
                </div>
                <p className="threshold-note">
                  Jump threshold: {Math.round(threshold * 100)}% of shoulder
                  width · cooldown 0.85s
                </p>
              </div>
              }
              <div className="tracking-status">
                <div>
                  <span className="tiny-label">MOVEMENT</span>
                  <strong className={flash ? "green-text" : ""}>
                    {feedback.direction === "Upward"
                      ? "↑"
                      : feedback.direction === "Downward"
                        ? "↓"
                        : "—"}{" "}
                    {feedback.direction}
                  </strong>
                </div>
                <div>
                  <span className="tiny-label">DETECTION STATUS</span>
                  <span className="status-text" role="status">
                    {feedback.status}
                  </span>
                </div>
              </div>
              {feedback.calibrated && (
                <div
                  className="motion-meter"
                  aria-label="Hand displacement relative to calibrated neutral"
                >
                  <span
                    style={{
                      left: `${50 + Math.max(-1, Math.min(1, (feedback.offset || 0) / (threshold * 2))) * 46}%`,
                    }}
                  />
                  <i />
                  <small>UP</small>
                  <small>NEUTRAL</small>
                  <small>DOWN</small>
                </div>
              )}
            </section>
          </div>
          <section className="how-to" id="how-to">
            <div>
              <p className="eyebrow">GET INTO THE FLOW</p>
              <h2>One gesture. One jump.</h2>
            </div>
            <div className="instruction">
              <span className="instruction-icon">↕</span>
              <div>
                <h3>{gestureMode === "pose" ? "Arms out. Jump." : "Up or down. Your call."}</h3>
                <p>
                  {gestureMode === "pose" ? "Stretch both arms sideways at shoulder height." : "Move either calibrated hand away from neutral."}
                  <br />
                  {gestureMode === "pose" ? "Hold briefly for one jump." : "Both directions make the dino jump."}
                </p>
              </div>
            </div>
            <div className="instruction">
              <span className="instruction-icon">↺</span>
              <div>
                <h3>Return, reset, repeat.</h3>
                <p>
                  {gestureMode === "pose" ? "Lower both arms before repeating." : "Bring your hand back to neutral to rearm."}
                  <br />
                  Holding a pose never repeats a jump.
                </p>
              </div>
            </div>
          </section>
        </dialog>
      </main>
      <footer>
        <span>
          DINO MOTION <span>·</span> Built for a little everyday play.
        </span>
        <span>No uploads. No face-direction controls. Just movement.</span>
      </footer>
    </div>
  );
}

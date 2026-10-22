// Image Y is positive down. Shoulder width makes this independent of camera distance.
// No face landmark or face orientation enters this calculation.
export function bodySamples({
  shoulders,
  hands = [],
  handedness = [],
  aspect = 4 / 3,
}) {
  if (
    !shoulders ||
    shoulders.length !== 2 ||
    shoulders.some(
      (p) =>
        !p ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        (p.visibility ?? 1) < 0.6 ||
        (p.presence ?? 1) < 0.6,
    )
  )
    return null;
  const [a, b] = shoulders;
  const width = Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  if (!Number.isFinite(width) || width < 0.09) return null;
  const centerY = (a.y + b.y) / 2;
  const samples = {};
  hands.forEach((points, i) => {
    const category = handedness[i]?.[0];
    const side = category?.categoryName;
    if (
      !["Left", "Right"].includes(side) ||
      category.score < 0.6 ||
      samples[side] !== undefined
    )
      return;
    const palm = [0, 5, 9, 13, 17].map((index) => points[index]);
    if (palm.some((p) => !p || !Number.isFinite(p.y))) return;
    samples[side] =
      (palm.reduce((sum, p) => sum + p.y, 0) / palm.length - centerY) / width;
  });
  return samples;
}

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
export class GestureController {
  constructor({ threshold = 0.28, cooldown = 850 } = {}) {
    this.threshold = threshold;
    this.cooldown = cooldown;
    this.reset();
  }
  reset() {
    this.baselines = {};
    this.states = {};
    this.calibration = null;
    this.lastJump = -Infinity;
  }
  configure(threshold) {
    this.threshold = threshold;
    for (const state of Object.values(this.states)) state.armed = false;
  }
  calibrate(now) {
    this.reset();
    this.calibration = { started: now, samples: {}, frames: 0 };
  }
  update(samples, now) {
    const output = {
      jump: false,
      direction: "Neutral",
      progress: 0,
      hands: [],
      calibrated: Object.keys(this.baselines).length > 0,
    };
    if (this.calibration) {
      const cal = this.calibration;
      if (!samples || !Object.keys(samples).length) {
        cal.started = now;
        cal.samples = {};
        cal.frames = 0;
        return {
          ...output,
          status: "Keep shoulders and at least one hand visible",
          calibrating: true,
        };
      }
      cal.frames++;
      for (const side of ["Left", "Right"]) {
        if (samples[side] === undefined) {
          delete cal.samples[side];
          continue;
        }
        (cal.samples[side] ??= []).push(samples[side]);
      }
      output.progress = Math.min(1, (now - cal.started) / 1600);
      if (output.progress < 1 || cal.frames < 16)
        return {
          ...output,
          calibrating: true,
          status: "Hold your comfortable neutral position…",
        };
      const stable = Object.entries(cal.samples).filter(
        ([, values]) =>
          values.length >= 16 &&
          Math.sqrt(mean(values.map((v) => (v - mean(values)) ** 2))) < 0.075,
      );
      if (!stable.length) {
        cal.started = now;
        cal.samples = {};
        cal.frames = 0;
        return {
          ...output,
          progress: 0,
          calibrating: true,
          status: "Movement detected. Hold still for a moment…",
        };
      }
      for (const [side, values] of stable) this.baselines[side] = mean(values);
      this.calibration = null;
      return {
        ...output,
        calibrated: true,
        progress: 1,
        status: "Calibrated · settle at neutral to arm",
      };
    }
    if (!output.calibrated)
      return { ...output, status: "Calibrate a comfortable starting position" };
    for (const [side, baseline] of Object.entries(this.baselines)) {
      const value = samples?.[side];
      let state = this.states[side];
      if (value === undefined || !Number.isFinite(value)) {
        delete this.states[side];
        continue;
      }
      // Reacquisition must dwell at neutral; never jump on reappearance.
      if (!state || now - state.seen > 240)
        state = this.states[side] = {
          filtered: value,
          seen: now,
          armed: false,
          neutralSince: null,
          candidate: null,
        };
      const dt = Math.max(1, now - state.seen);
      state.filtered += (value - state.filtered) * (1 - Math.exp(-dt / 65));
      state.seen = now;
      const delta = state.filtered - baseline;
      const neutral = Math.abs(delta) < this.threshold * 0.38;
      const direction =
        delta < -this.threshold
          ? "Upward"
          : delta > this.threshold
            ? "Downward"
            : "Neutral";
      if (neutral) {
        state.neutralSince ??= now;
        state.candidate = null;
        if (now - state.neutralSince >= 140) state.armed = true;
      } else {
        state.neutralSince = null;
        if (state.armed && direction !== "Neutral") {
          if (state.candidate?.direction !== direction)
            state.candidate = { direction, since: now };
          if (now - state.candidate.since >= 65) {
            state.armed = false;
            state.candidate = null;
            // Consume cooldown events too; holding must never cause a delayed jump.
            if (now - this.lastJump >= this.cooldown && !output.jump) {
              this.lastJump = now;
              output.jump = true;
              output.jumpHand = side;
            }
          }
        } else state.candidate = null;
      }
      output.hands.push({ side, delta, direction, armed: state.armed });
    }
    const dominant = output.hands.reduce(
      (best, h) =>
        !best || Math.abs(h.delta) > Math.abs(best.delta) ? h : best,
      null,
    );
    output.direction = dominant?.direction ?? "No hand";
    output.offset = dominant?.delta ?? 0;
    output.status = !samples
      ? "Shoulders not visible · gestures paused"
      : !output.hands.length
        ? "Show a calibrated hand · gestures paused"
        : output.jump
          ? `${output.jumpHand} hand movement detected`
          : output.hands.some((h) => h.armed)
            ? "Ready · move either calibrated hand"
            : "Return to neutral to rearm";
    return output;
  }
}

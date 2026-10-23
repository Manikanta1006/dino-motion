import test from "node:test";
import assert from "node:assert/strict";
import { GestureController, bodySamples, isTPose, PoseJumpController } from "../src/gesture.js";

function poseData(raised = true, shift = 0, scale = 1) {
  return { aspect: 1, arms: [
    [0.4, 0.3], [0.6, 0.3],
    [raised ? 0.25 : 0.4, raised ? 0.3 : 0.45],
    [raised ? 0.75 : 0.6, raised ? 0.3 : 0.45],
    [raised ? 0.1 : 0.4, raised ? 0.3 : 0.6],
    [raised ? 0.9 : 0.6, raised ? 0.3 : 0.6],
  ].map(([x, y]) => ({x: x * scale + shift, y: y * scale + shift, visibility: 0.99, presence: 0.99})) };
}

test("T-pose requires both straight sideways arms and confident visible joints", () => {
  assert.equal(isTPose(poseData()), true);
  assert.equal(isTPose(poseData(false)), false);
  assert.equal(isTPose(poseData(true, 0.1, 0.75)), true);
  const bent = poseData();
  bent.arms[2].y += 0.2;
  assert.equal(isTPose(bent), false);
  bent.arms[2].visibility = 0.1;
  assert.equal(isTPose(bent), null);
  assert.equal(isTPose({}), null);
});

test("T-pose jumps once per hold and needs lowered arms before repeating", () => {
  const engine = new PoseJumpController();
  let now = 0, jumps = 0;
  const feed = (data, duration) => {
    for (let t = 0; t < duration; t += 40) {
      now += 40;
      if (engine.update(data, now).jump) jumps++;
    }
  };
  feed(poseData(), 1200);
  assert.equal(jumps, 0);
  feed(poseData(false), 400);
  feed(poseData(), 2000);
  assert.equal(jumps, 1);
  const bent = poseData();
  bent.arms[2].y += 0.2;
  feed(bent, 400);
  feed(poseData(), 1200);
  assert.equal(jumps, 1);
  feed(poseData(false), 400);
  feed(poseData(), 400);
  assert.equal(jumps, 2);
});

test("T-pose rejects brief movement and disarms on tracking loss or stale frames", () => {
  for (const gap of [false, true]) {
    const engine = new PoseJumpController();
    for (let now = 0; now <= 400; now += 40) engine.update(poseData(false), now);
    assert.equal(engine.update(poseData(), 440).jump, false);
    assert.equal(engine.update(poseData(), 480).jump, false);
    if (!gap) engine.update({}, 520);
    for (let now = gap ? 1000 : 560; now < 2400; now += 40)
      assert.equal(engine.update(poseData(), now).jump, false);
  }
});

function fixture(options) {
  const engine = new GestureController(options);
  let now = 0;
  const events = [];
  const feed = (samples, duration = 400, step = 40) => {
    let output;
    for (let i = 0; i < duration; i += step) {
      now += step;
      output = engine.update(samples, now);
      if (output.jump) events.push(output);
    }
    return output;
  };
  engine.calibrate(now);
  feed({ Left: 0.8, Right: 0.5 }, 1800);
  feed({ Left: 0.8, Right: 0.5 });
  return {
    engine,
    feed,
    events,
    now: () => now,
    skip: (duration) => {
      now += duration;
    },
  };
}
test("up and down each jump once, only after a neutral reset", () => {
  const { feed, events } = fixture();
  feed({ Left: 0.2 }, 2000);
  assert.equal(events.length, 1);
  assert.equal(events[0].direction, "Upward");
  feed({ Left: 1.4 }, 1200); // Crossing neutral briefly does not rearm.
  assert.equal(events.length, 1);
  feed({ Left: 0.8 }, 600);
  feed({ Left: 1.4 }, 2000);
  assert.equal(events.length, 2);
  assert.equal(events[1].direction, "Downward");
});
test("either hand works; changing hand detection order does not affect state", () => {
  const { feed, events } = fixture();
  feed({ Right: 0.5, Left: 0.8 }, 400);
  feed({ Right: 1.1, Left: 0.8 }, 1200);
  feed({ Left: 0.8, Right: 0.5 }, 600);
  feed({ Left: 0.2, Right: 0.5 }, 600);
  assert.deepEqual(
    events.map((e) => e.jumpHand),
    ["Right", "Left"],
  );
});
test("neutral jitter and brief threshold spikes do not jump", () => {
  const { feed, events } = fixture();
  for (let i = 0; i < 30; i++) feed({ Left: 0.8 + (i % 2 ? 0.07 : -0.07) }, 40);
  feed({ Left: 0.1 }, 40);
  feed({ Left: 0.8 }, 400);
  assert.equal(events.length, 0);
});
test("cooldown consumes simultaneous or overlapping hand events without a delayed trigger", () => {
  const { feed, events } = fixture({ cooldown: 1500 });
  feed({ Left: 0.2, Right: 0.5 }, 400);
  feed({ Left: 0.2, Right: 1.2 }, 2400);
  assert.equal(events.length, 1);
  feed({ Left: 0.8, Right: 0.5 }, 600);
  feed({ Left: 0.2, Right: 1.2 }, 800);
  assert.equal(events.length, 2);
});
test("missing hand or missing body pauses recognition and requires neutral on reacquisition", () => {
  for (const absent of [null, {}]) {
    const { feed, events } = fixture();
    feed(absent, 600);
    feed({ Left: 0.2 }, 2000);
    assert.equal(events.length, 0);
    feed({ Left: 0.8 }, 600);
    feed({ Left: 0.2 }, 600);
    assert.equal(events.length, 1);
  }
});
test("a long camera frame gap disarms a hand", () => {
  const { skip, events, feed } = fixture();
  skip(1000);
  feed({ Left: 0.2 }, 2000);
  assert.equal(events.length, 0);
});
test("sensitivity change cannot trigger on a held position", () => {
  const { engine, feed, events } = fixture({ threshold: 0.5 });
  feed({ Left: 0.5 }, 800);
  engine.configure(0.15);
  feed({ Left: 0.5 }, 1500);
  assert.equal(events.length, 0);
  feed({ Left: 0.8 }, 600);
  feed({ Left: 0.5 }, 600);
  assert.equal(events.length, 1);
});
test("an uncalibrated hand cannot trigger; recalibration clears old state", () => {
  const { engine, feed, events, now } = fixture();
  feed({ Unknown: 1.7 }, 400);
  assert.equal(events.length, 0);
  engine.calibrate(now());
  feed({ Right: 0.4 }, 1800);
  assert.deepEqual(Object.keys(engine.baselines), ["Right"]);
  feed({ Left: 0.2 }, 1000);
  assert.equal(events.length, 0);
});
test("calibration needs stable visible shoulders and hands", () => {
  const engine = new GestureController();
  engine.calibrate(0);
  for (let t = 40; t <= 4000; t += 40)
    engine.update(t % 80 ? { Left: 0.1 } : { Left: 1.4 }, t);
  assert.deepEqual(engine.baselines, {});
  engine.update(null, 4040);
  assert.ok(engine.calibration);
  for (let t = 4080; t <= 6000; t += 40) engine.update({ Left: 0.8 }, t);
  assert.ok(Math.abs(engine.baselines.Left - 0.8) < 0.001);
});
function landmarks({ shift = 0, scale = 1, hand = 0.6, face = 0 } = {}) {
  const transform = (p) => ({
    x: p.x * scale + shift,
    y: p.y * scale + shift,
    visibility: 0.99,
    presence: 0.99,
  });
  return {
    aspect: 4 / 3,
    shoulders: [transform({ x: 0.3, y: 0.3 }), transform({ x: 0.7, y: 0.3 })],
    hands: [Array.from({ length: 21 }, () => transform({ x: 0.5, y: hand }))],
    handedness: [[{ categoryName: "Left", score: 0.99 }]],
    faceOrientation: face,
  };
}
test("body-relative coordinates cancel framing translation and uniform scale", () => {
  const neutral = bodySamples(landmarks()).Left;
  assert.ok(
    Math.abs(
      bodySamples(landmarks({ shift: 0.1, scale: 0.75 })).Left - neutral,
    ) < 1e-8,
  );
  assert.ok(bodySamples(landmarks({ hand: 0.4 })).Left < neutral);
  assert.ok(bodySamples(landmarks({ hand: 0.8 })).Left > neutral);
});
test("face direction is unused and low-confidence torso tracking yields no sample", () => {
  assert.deepEqual(
    bodySamples(landmarks({ face: -180 })),
    bodySamples(landmarks({ face: 180 })),
  );
  const data = landmarks();
  data.shoulders[0].visibility = 0.2;
  assert.equal(bodySamples(data), null);
});

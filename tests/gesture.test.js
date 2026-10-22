import test from "node:test";
import assert from "node:assert/strict";
import { GestureController, bodySamples } from "../src/gesture.js";

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

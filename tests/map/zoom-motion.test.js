import test from "node:test";
import assert from "node:assert/strict";
import {
  stepZoom,
  zoomGesture,
} from "../../src/components/explorer/map/zoom-motion.js";
import { MIN_ALTITUDE } from "../../src/components/explorer/map/geo.js";

const travel = (from, to, hz, seconds) => {
  let state = { logAltitude: Math.log(from), velocity: 0 };
  for (let i = 0; i < hz * seconds; i++) state = stepZoom(state, to, 1 / hz);
  return state;
};

test("zoom has bounded speed and no bounce from planet scale to street scale", () => {
  let state = { logAltitude: Math.log(2.25), velocity: 0 };
  const target = Math.log(MIN_ALTITUDE),
    dt = 1 / 60;
  for (let i = 0; i < 600; i++) {
    const previous = state;
    state = stepZoom(state, MIN_ALTITUDE, dt);
    assert(state.logAltitude <= previous.logAltitude + 1e-12);
    assert(state.logAltitude >= target - 1e-12);
    assert(Math.abs(state.logAltitude - previous.logAltitude) / dt <= 4.001);
    assert(Math.abs(state.velocity) <= 4.001);
  }
  assert(Math.abs(state.logAltitude - target) < 1e-9);
});

test("zoom settles consistently at 30, 60, and 120 frames per second", () => {
  const results = [30, 60, 120].map((hz) => travel(0.01, 0.005, hz, 1));
  for (const result of results)
    assert(Math.abs(result.logAltitude - results[0].logAltitude) < 1e-6);
  // Equal scale changes have the same motion at continental and local altitudes.
  const wide = travel(1, 0.5, 60, 0.5),
    close = travel(0.001, 0.0005, 60, 0.5);
  assert(
    Math.abs(
      wide.logAltitude - Math.log(1) - (close.logAltitude - Math.log(0.001)),
    ) < 1e-10,
  );
});

test("reversing a gesture preserves velocity continuity and reduced motion snaps", () => {
  const inward = travel(0.1, 0.01, 60, 0.25);
  const reversed = stepZoom(inward, 0.2, 1 / 120);
  assert(Math.abs(reversed.velocity - inward.velocity) < 180 / 120);
  const snapped = stepZoom(inward, 0.02, 1 / 60, true);
  assert.equal(snapped.logAltitude, Math.log(0.02));
  assert.equal(snapped.velocity, 0);
});

test("wheel units normalize consistently and large input spikes are bounded", () => {
  assert.equal(zoomGesture(16), zoomGesture(1, 1));
  assert.equal(zoomGesture(800), zoomGesture(1, 2, 800));
  assert(Math.abs(zoomGesture(10000)) <= 0.32);
  assert(Math.abs(zoomGesture(-10000, 0, 800, true)) <= 0.32);
});

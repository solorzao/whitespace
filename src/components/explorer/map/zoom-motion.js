import { MIN_ALTITUDE } from "./geo.js";

// Work in log altitude so the same gesture feels the same at every map scale.
// An exact critically damped spring eases both speed and position without bounce.
export function stepZoom(state, targetAltitude, dt, reducedMotion = false) {
  const target = Math.log(Math.max(MIN_ALTITUDE, targetAltitude));
  if (reducedMotion) return { logAltitude: target, velocity: 0 };
  const time = Math.max(0, Math.min(dt, 0.05));
  const omega = 12,
    maxSpeed = 4;
  const displacement = Math.max(
    (-2 * maxSpeed) / omega,
    Math.min((2 * maxSpeed) / omega, state.logAltitude - target),
  );
  const localTarget = state.logAltitude - displacement;
  const decay = Math.exp(-omega * time);
  const impulse = (state.velocity + omega * displacement) * time;
  const logAltitude = localTarget + (displacement + impulse) * decay;
  const velocity = (state.velocity - omega * impulse) * decay;
  return { logAltitude, velocity };
}

// Wheel devices report pixels, lines, or pages. Bound spikes from coarse wheels.
export function zoomGesture(delta, mode = 0, pageHeight = 800, pinch = false) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1);
  return Math.max(-0.32, Math.min(0.32, -pixels * (pinch ? 0.003 : 0.0014)));
}

import * as THREE from "three";
export const EARTH_KM = 6371;
export const MIN_ALTITUDE = 0.00012;
export function geoVector(lat, lon) {
  const a = (lat * Math.PI) / 180,
    b = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(a) * Math.cos(b),
    Math.sin(a),
    -Math.cos(a) * Math.sin(b),
  );
}
export function vectorGeo(vector) {
  const point = vector.clone().normalize();
  return {
    lat: (Math.asin(point.y) * 180) / Math.PI,
    lon: (Math.atan2(-point.z, point.x) * 180) / Math.PI,
  };
}
export function nextZoom(distance, delta, maximum) {
  return (
    1 +
    THREE.MathUtils.clamp(
      (distance - 1) * Math.exp(delta * 1.6),
      MIN_ALTITUDE,
      maximum - 1,
    )
  );
}
export function formatDistance(km) {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()} km`;
}
export function circlePositions(lat, lon, radiusKm, segments = 96) {
  const normal = geoVector(lat, lon),
    right = new THREE.Vector3().crossVectors(
      normal,
      new THREE.Vector3(0, 1, 0),
    );
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  const up = new THREE.Vector3().crossVectors(right, normal).normalize(),
    angle = radiusKm / EARTH_KM,
    positions = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const p = normal
      .clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(right, Math.sin(angle) * Math.cos(t))
      .addScaledVector(up, Math.sin(angle) * Math.sin(t))
      .multiplyScalar(1.000006);
    positions.push(p.x, p.y, p.z);
  }
  return positions;
}

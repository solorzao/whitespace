import * as THREE from "three";
import { vectorGeo } from "./geo.js";
export const tilePoint = (x, y, z) => ({
  lon: (x / 2 ** z) * 360 - 180,
  lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI,
});
export const tileCoordinate = (lat, lon, z) => {
  const n = 2 ** z,
    a = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(a)) / Math.PI) / 2) * n,
  };
};
export function visibleTiles(
  earth,
  camera,
  z,
  { maxColumns = 16, maxRows = 12, margin = 0 } = {},
) {
  const n = 2 ** z,
    center = vectorGeo(
      camera.position
        .clone()
        .sub(earth.position)
        .applyQuaternion(earth.quaternion.clone().invert()),
    );
  const mid = tileCoordinate(center.lat, center.lon, z),
    samples = [mid],
    ray = new THREE.Raycaster(),
    sphere = new THREE.Sphere(earth.position, 1),
    hit = new THREE.Vector3();
  for (const x of [-1, -0.5, 0, 0.5, 1])
    for (const y of [-1, -0.5, 0, 0.5, 1]) {
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      if (!ray.ray.intersectSphere(sphere, hit)) continue;
      const geo = vectorGeo(earth.worldToLocal(hit.clone())),
        p = tileCoordinate(geo.lat, geo.lon, z);
      if (p.x - mid.x > n / 2) p.x -= n;
      if (mid.x - p.x > n / 2) p.x += n;
      samples.push(p);
    }
  let x0 = Math.floor(Math.min(...samples.map((p) => p.x))) - margin,
    x1 = Math.floor(Math.max(...samples.map((p) => p.x))) + margin;
  let y0 = Math.max(
      0,
      Math.floor(Math.min(...samples.map((p) => p.y))) - margin,
    ),
    y1 = Math.min(
      n - 1,
      Math.floor(Math.max(...samples.map((p) => p.y))) + margin,
    );
  if (x1 - x0 >= maxColumns) {
    x0 = Math.floor(mid.x) - Math.floor(maxColumns / 2);
    x1 = x0 + maxColumns - 1;
  }
  if (y1 - y0 >= maxRows) {
    y0 = Math.max(0, Math.floor(mid.y) - Math.floor(maxRows / 2));
    y1 = Math.min(n - 1, y0 + maxRows - 1);
  }
  const result = new Map();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const wrapped = ((x % n) + n) % n,
        key = `${z}/${wrapped}/${y}`;
      result.set(key, {
        x: wrapped,
        y,
        z,
        key,
        priority: (x + 0.5 - mid.x) ** 2 + (y + 0.5 - mid.y) ** 2,
      });
    }
  return [...result.values()].sort((a, b) => a.priority - b.priority);
}

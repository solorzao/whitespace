import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  geoVector,
  vectorGeo,
  nextZoom,
  circlePositions,
  EARTH_KM,
  MIN_ALTITUDE,
} from "../../src/components/explorer/map/geo.js";
import { readFileSync } from "node:fs";
const area = JSON.parse(
  readFileSync(new URL("../../data/demo/santa-monica.json", import.meta.url)),
);
const records = area.docs
  .filter((doc) => Number.isFinite(doc.lat) && Number.isFinite(doc.lng))
  .map((doc) => ({
    lat: doc.lat,
    lon: doc.lng,
    type: 0,
    locationName: doc.title,
  }));
import { clusterRecords } from "../../src/components/explorer/map/pin-layer.js";

test("geographic projection round-trips city coordinates at close range", () => {
  for (const point of [
    { lat: 37.7955, lon: -122.3937 },
    { lat: 34.0092, lon: -118.4976 },
    { lat: -33.87, lon: 151.21 },
  ]) {
    const result = vectorGeo(geoVector(point.lat, point.lon));
    assert(Math.abs(result.lat - point.lat) < 1e-10);
    assert(Math.abs(result.lon - point.lon) < 1e-10);
  }
});
test("zoom remains above the surface and reverses at every scale", () => {
  let distance = 3.25;
  for (let i = 0; i < 30; i++) {
    const previous = distance;
    distance = nextZoom(distance, -0.45, 4);
    assert(distance <= previous);
    assert(distance >= 1 + MIN_ALTITUDE);
  }
  assert(Math.abs(distance - (1 + MIN_ALTITUDE)) < 1e-12);
  assert(nextZoom(distance, 0.45, 4) > distance);
  for (const initial of [1.0005, 1.01, 1.5, 3])
    assert(
      Math.abs(nextZoom(nextZoom(initial, -0.1, 4), 0.1, 4) - initial) < 1e-12,
    );
});
test("selection circles have the requested ground radius from meters to global scale", () => {
  for (const radius of [0.05, 0.5, 5, 100, 1500]) {
    const center = geoVector(34.0195, -118.4912),
      positions = circlePositions(34.0195, -118.4912, radius);
    for (let i = 0; i < positions.length; i += 3) {
      const edge = new THREE.Vector3(...positions.slice(i, i + 3)).normalize();
      const actual =
        Math.atan2(
          new THREE.Vector3().crossVectors(center, edge).length(),
          center.dot(edge),
        ) * EARTH_KM;
      assert(Math.abs(actual - radius) < 1e-8);
    }
  }
});
test("every rendered cluster anchor is a collected source location, never a floating average", () => {
  const locations = new Set(
    records.map((record) => `${record.lat},${record.lon}`),
  );
  for (const size of [90, 5.625, 0.02197265625]) {
    const clusters = clusterRecords(records, size, new Set([0, 1, 2, 3, 4, 5]));
    assert(
      clusters.every((cluster) =>
        locations.has(`${cluster.point.lat},${cluster.point.lon}`),
      ),
    );
  }
  assert(records.every((record) => record.locationName));
});

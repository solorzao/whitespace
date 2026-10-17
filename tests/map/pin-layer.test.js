import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  CELL_SIZES,
  clusterRecords,
  selectDetailLevel,
  createPinLayer,
} from "../../src/components/explorer/map/pin-layer.js";

const allTypes = new Set([0, 1, 2, 3, 4, 5]);
const records = Array.from({ length: 240 }, (_, i) => ({
  lat: -70 + ((i * 13.17) % 140),
  lon: -180 + ((i * 29.31) % 360),
  type: i % 6,
}));

test("clusters conserve records and filtered source counts at every detail level", () => {
  for (const size of CELL_SIZES) {
    assert.equal(
      clusterRecords(records, size, allTypes).reduce(
        (n, cell) => n + cell.count,
        0,
      ),
      records.length,
    );
    const filtered = clusterRecords(records, size, new Set([1, 4]));
    assert.equal(
      filtered.reduce((n, cell) => n + cell.count, 0),
      80,
    );
    assert(
      filtered.every((cell) =>
        cell.counts.every((count, type) => !count || type === 1 || type === 4),
      ),
    );
    assert.deepEqual(clusterRecords(records, size, new Set()), []);
  }
});

test("cluster identities and geographic anchors do not depend on input order or a camera", () => {
  for (const size of CELL_SIZES) {
    const original = clusterRecords(records, size, allTypes);
    const reordered = clusterRecords([...records].reverse(), size, allTypes);
    assert.deepEqual(
      original.map((c) => c.id),
      reordered.map((c) => c.id),
    );
    original.forEach((cell, i) => {
      assert(cell.anchor.distanceTo(reordered[i].anchor) < 1e-12);
      assert(Math.abs(cell.anchor.length() - 1) < 1e-12);
    });
  }
});

test("equivalent longitudes at the antimeridian use the same cluster", () => {
  const result = clusterRecords(
    [180, -180, 540, -540].map((lon) => ({ lat: 0, lon, type: 0 })),
    5.625,
    allTypes,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 4);
  assert(Math.abs(result[0].point.lon) > 179.99);
});

test("detail levels resist trackpad jitter and settle on one layer", () => {
  let previous = 3;
  for (const level of [3.49, 3.51, 3.48, 3.6, 3.64]) {
    previous = selectDetailLevel(CELL_SIZES[0] / 2 ** level, previous);
    assert.equal(previous, 3);
  }
  previous = selectDetailLevel(CELL_SIZES[0] / 2 ** 3.7, previous);
  assert.equal(previous, 4);
  for (const level of [3.51, 3.49, 3.4, 3.36]) {
    previous = selectDetailLevel(CELL_SIZES[0] / 2 ** level, previous);
    assert.equal(previous, 4);
  }
  assert.equal(selectDetailLevel(CELL_SIZES[0] / 2 ** 3.3, previous), 3);
  assert.equal(selectDetailLevel(0.000001, previous), CELL_SIZES.length - 1);
  assert.equal(selectDetailLevel(1000, previous), 0);
});

test("pins fade on source changes and never draw through the back of Earth", () => {
  const previousPath = globalThis.Path2D;
  globalThis.Path2D = class {};
  const draws = [];
  const context = {
    globalAlpha: 1,
    clearRect() {},
    setTransform() {},
    beginPath() {},
    arc(x, y) {
      draws.push({ x, y, alpha: this.globalAlpha });
    },
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    fillText() {},
    roundRect() {},
    measureText(text) {
      return { width: text.length * 5 };
    },
  };
  const canvas = { style: {}, getContext: () => context };
  const earth = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.z = 3.25;
  camera.updateMatrixWorld();
  earth.updateMatrixWorld();
  const layer = createPinLayer({
    canvas,
    camera,
    earth,
    reducedMotion: false,
    records: Array.from({ length: 10 }, () => ({ lat: 0, lon: -90, type: 0 })),
    types: ["wiki", "reviews", "video", "social", "property", "people"].map(
      (id) => ({ id }),
    ),
  });
  try {
    layer.resize(800, 800, 1);
    const step = () => {
      draws.length = 0;
      layer.update(1 / 60, 1);
      return Math.max(0, ...draws.map((draw) => draw.alpha));
    };
    const entering = step();
    assert(entering > 0 && entering < 0.3);
    for (let i = 0; i < 60; i++) step();
    const visible = step();
    assert(visible > entering);
    assert(layer.hitTest(400, 400));
    camera.position.z = 2;
    camera.updateMatrixWorld();
    step();
    assert.equal(
      draws.length,
      1,
      "a shared geographic anchor must stay a single pin between detail levels",
    );
    assert(
      step() > 0.95,
      "an unchanged anchor must not blink during a level transition",
    );
    for (let i = 0; i < 90; i++) step();
    assert.equal(
      draws.length,
      1,
      "a settled zoom must not leave duplicate ghost pins",
    );
    layer.filter(new Set());
    const leaving = step();
    assert(
      leaving > 0 && leaving < visible,
      "leaving pins must fade instead of disappearing",
    );
    for (let i = 0; i < 90; i++) step();
    assert.equal(step(), 0);
    assert.equal(layer.hitTest(400, 400), null);
    layer.filter(allTypes);
    for (let i = 0; i < 60; i++) step();
    earth.rotation.y = Math.PI;
    earth.updateMatrixWorld();
    assert.equal(step(), 0, "back-facing pins must be fully occluded");
  } finally {
    layer.dispose();
    globalThis.Path2D = previousPath;
  }
});

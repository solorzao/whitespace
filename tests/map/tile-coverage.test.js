import test from "node:test";
import assert from "node:assert/strict";
import {
  coverageFallbacks,
  overlapsTile,
  detailOpacity,
} from "../../src/components/explorer/map/tile-coverage.js";
const tile = (z, x, y, ready = true, alpha = 1) => ({
  z,
  x,
  y,
  ready,
  alpha,
  key: `${z}/${x}/${y}`,
});

test("zoom-in keeps the closest cached parent until its replacement is visible", () => {
  const parent = tile(7, 3, 4),
    older = tile(6, 1, 2),
    replacement = tile(8, 6, 8, false, 0);
  assert.deepEqual(
    [...coverageFallbacks([replacement], [older, parent])],
    [parent.key],
  );
  replacement.ready = true;
  replacement.alpha = 0.7;
  assert(coverageFallbacks([replacement], [parent]).has(parent.key));
  replacement.alpha = 0.99;
  assert.equal(coverageFallbacks([replacement], [parent]).size, 0);
});

test("zoom-out retains visible child tiles while the coarser replacement loads", () => {
  const replacement = tile(7, 3, 4, false, 0),
    child = tile(8, 6, 8),
    neighbor = tile(8, 7, 9),
    far = tile(8, 40, 40);
  const fallback = coverageFallbacks([replacement], [child, neighbor, far]);
  assert(fallback.has(child.key));
  assert(fallback.has(neighbor.key));
  assert(!fallback.has(far.key));
  replacement.ready = true;
  replacement.alpha = 1;
  assert.equal(coverageFallbacks([replacement], [child, neighbor]).size, 0);
});

test("cached tiles from unrelated regions cannot become fallback draw calls", () => {
  assert(!overlapsTile(tile(10, 4, 5), tile(10, 5, 5)));
  assert(overlapsTile(tile(2, 0, 0), tile(4, 3, 3)));
  assert(!overlapsTile(tile(2, 0, 0), tile(4, 4, 3)));
});

test("a visible fine tile does not fade merely because it becomes the next level’s blend layer", () => {
  const child = tile(8, 6, 8),
    replacement = tile(7, 3, 4, false, 0),
    wanted = new Set([child.key, replacement.key]);
  const fallback = coverageFallbacks([replacement], [child]);
  assert.equal(
    detailOpacity(child, { base: 7, blend: 0.1 }, wanted, fallback),
    1,
  );
  replacement.ready = true;
  replacement.alpha = 1;
  assert.equal(
    detailOpacity(
      child,
      { base: 7, blend: 0.1 },
      wanted,
      coverageFallbacks([replacement], [child]),
    ),
    0.1,
  );
});

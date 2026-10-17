import test from "node:test";
import assert from "node:assert/strict";
import { detailBlend } from "../../src/components/explorer/map/detail-blend.js";

test("detail blends continuously across integer zoom boundaries in both directions", () => {
  for (let boundary = 5; boundary < 19; boundary++) {
    const before = detailBlend(boundary - 1e-5, 4, 19);
    const after = detailBlend(boundary + 1e-5, 4, 19);
    // The previously sharper layer becomes the new fully visible foundation.
    assert.equal(before.fine, after.base);
    assert(before.blend > 0.999999);
    assert(after.blend < 0.000001);
  }
});

test("detail changes gradually through the zoom interval and clamps at limits", () => {
  let previous = 0;
  for (let i = 0; i < 100; i++) {
    const level = detailBlend(8 + i / 100, 4, 19);
    assert.equal(level.base, 8);
    assert.equal(level.fine, 9);
    assert(level.blend >= previous);
    assert(level.blend - previous < 0.016);
    previous = level.blend;
  }
  assert.deepEqual(detailBlend(-10, 4, 19), { base: 4, fine: 5, blend: 0 });
  assert.deepEqual(detailBlend(30, 4, 19), { base: 19, fine: 19, blend: 0 });
  assert.equal(detailBlend(8.5, 4, 19).blend, 0.5);
});

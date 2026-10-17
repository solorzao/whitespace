import test from "node:test";
import assert from "node:assert/strict";
import {
  imageryDetail,
  referenceDetail,
} from "../../src/components/explorer/map/imagery-detail.js";
import { EARTH_KM } from "../../src/components/explorer/map/geo.js";

test("regional view from the reported 206 km scale uses fully opaque detailed imagery", () => {
  const height = 718,
    scaleKm = 206;
  const altitude =
    (scaleKm * height) / (100 * 2 * Math.tan(Math.PI / 9) * EARTH_KM);
  const view = imageryDetail(altitude, 27, height, 2);
  assert(view.enabled);
  assert.equal(view.opacity, 1);
  assert(view.base >= 5);
});

test("imagery is preloaded before becoming visible and respects Retina resolution", () => {
  assert(imageryDetail(1, 30, 718).enabled);
  assert.equal(imageryDetail(1, 30, 718).opacity, 0);
  const normal = imageryDetail(0.3, 30, 718, 1),
    retina = imageryDetail(0.3, 30, 718, 2);
  assert.equal(retina.base, normal.base + 1);
  assert(Math.abs(retina.blend - normal.blend) < 1e-12);
  assert(!imageryDetail(2, 30, 718).enabled);
});

test("reference labels use one readable detail level and stay out of the splash screen", () => {
  const view = referenceDetail(0.002, 34, 720);
  assert.equal(view.base, view.fine);
  assert.equal(view.blend, 0);
  assert.equal(view.opacity, 1);
  assert(!referenceDetail(0.002, 34, 720, 40, 0).enabled);
  assert(referenceDetail(2.25, 34, 720).enabled);
});

import test from "node:test";
import assert from "node:assert/strict";
import { TileQueue } from "../../src/components/explorer/map/tile-queue.js";
import {
  contextZoom,
  labelName,
  boxesOverlap,
  stableLabelCandidates,
} from "../../src/components/explorer/map/map-context.js";
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("fast zooms cancel obsolete downloads and prioritize the new view", async () => {
  const queue = new TileQueue(2),
    started = [],
    aborted = [];
  let active = 0,
    maximum = 0;
  const job = (key, priority) => ({
    key,
    priority,
    run: (signal) =>
      new Promise((resolve) => {
        started.push(key);
        active++;
        maximum = Math.max(maximum, active);
        signal.addEventListener(
          "abort",
          () => {
            aborted.push(key);
            active--;
            resolve();
          },
          { once: true },
        );
      }),
  });
  queue.replace([job("coarse", 0), job("fine", 1), job("obsolete-edge", 2)]);
  await tick();
  queue.replace([job("new-center", 0), job("new-edge", 1)]);
  await tick();
  await tick();
  assert.deepEqual(started, ["coarse", "fine", "new-center", "new-edge"]);
  assert.deepEqual(aborted, ["coarse", "fine"]);
  assert.equal(maximum, 2);
  queue.dispose();
  await tick();
  assert.equal(active, 0);
});

test("map labels resist zoom-boundary jitter and preserve screen font size", () => {
  const latitude = 34,
    height = 720;
  let previous = null;
  for (const altitude of [0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001]) {
    const z = contextZoom(altitude, latitude, height, previous);
    if (previous !== null) assert(z >= previous);
    assert(z <= 15);
    previous = z;
  }
  const z = contextZoom(0.01, latitude, height);
  for (const altitude of [0.01001, 0.00999, 0.01002, 0.00998])
    assert.equal(contextZoom(altitude, latitude, height, z), z);
  assert.equal(
    labelName({ _name_en: "Ocean Avenue", _name_local: "Local name" }),
    "Ocean Avenue",
  );
  assert(
    boxesOverlap({ x: 0, y: 0, w: 50, h: 20 }, { x: 40, y: 0, w: 50, h: 20 }),
  );
  assert(
    !boxesOverlap({ x: 0, y: 0, w: 50, h: 20 }, { x: 60, y: 0, w: 50, h: 20 }),
  );
});

test("new tiles retain an already visible road label at its existing geographic anchor", () => {
  const old = {
    id: "old",
    name: "Ocean Avenue",
    anchor: { x: 200, y: 200 },
    road: true,
    country: false,
    weight: 1,
  };
  const incoming = { ...old, id: "new", anchor: { x: 300, y: 300 } };
  const states = new Map([["old", { label: old, alpha: 1 }]]),
    project = (anchor) => ({ ...anchor, visibility: 1 });
  const candidates = stableLabelCandidates(
    states,
    [incoming],
    project,
    800,
    600,
  );
  assert.equal(candidates[0].id, "old");
  assert.equal(candidates[0].retained, true);
  assert.deepEqual(candidates[0].anchor, { x: 200, y: 200 });
  old.anchor = { x: -100, y: 200 };
  assert.equal(
    stableLabelCandidates(states, [incoming], project, 800, 600)[0].id,
    "new",
  );
  assert.equal(stableLabelCandidates(states, [], project, 800, 600).length, 0);
});

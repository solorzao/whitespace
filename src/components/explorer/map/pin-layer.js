import * as THREE from "three";
import { detailBlend } from "./detail-blend.js";
import { sourcePaths } from "./icons.js";

// Geographic cells stay fixed while the camera moves. Each finer level is
// nested inside its parent, including at the antimeridian.
export const CELL_SIZES = Array.from(
  { length: 18 },
  (_, i) => 360 / 2 ** (i + 2),
);

export function clusterRecords(records, cellSize, types) {
  const cells = new Map();
  for (const record of records) {
    if (!types.has(record.type)) continue;
    const longitude = (((record.lon + 180) % 360) + 360) % 360;
    const column = Math.floor(longitude / cellSize);
    const row = Math.min(
      Math.ceil(180 / cellSize) - 1,
      Math.floor((record.lat + 90) / cellSize),
    );
    const id = `${cellSize}:${column}:${row}`;
    let cell = cells.get(id);
    if (!cell) {
      cell = {
        id,
        count: 0,
        counts: [0, 0, 0, 0, 0],
        x: 0,
        y: 0,
        z: 0,
        members: [],
      };
      cells.set(id, cell);
    }
    const lat = (record.lat * Math.PI) / 180,
      lon = (record.lon * Math.PI) / 180;
    cell.x += Math.cos(lat) * Math.cos(lon);
    cell.y += Math.sin(lat);
    cell.z -= Math.cos(lat) * Math.sin(lon);
    cell.members.push(record);
    cell.count++;
    cell.counts[record.type] = (cell.counts[record.type] || 0) + 1;
  }
  return [...cells.values()]
    .map((cell) => {
      const centroid = new THREE.Vector3(cell.x, cell.y, cell.z).normalize();
      // Pin to an actual member, never an average point in water or between blocks.
      const member = [...cell.members].sort((a, b) => {
        const score = (record) => {
          const lat = (record.lat * Math.PI) / 180,
            lon = (record.lon * Math.PI) / 180;
          return (
            Math.cos(lat) * Math.cos(lon) * centroid.x +
            Math.sin(lat) * centroid.y -
            Math.cos(lat) * Math.sin(lon) * centroid.z
          );
        };
        return score(b) - score(a) || a.lat - b.lat || a.lon - b.lon;
      })[0];
      const lat = (member.lat * Math.PI) / 180,
        lon = (member.lon * Math.PI) / 180;
      const anchor = new THREE.Vector3(
        Math.cos(lat) * Math.cos(lon),
        Math.sin(lat),
        -Math.cos(lat) * Math.sin(lon),
      );
      const type = cell.counts.findIndex(
        (count) => count === Math.max(...cell.counts.filter(Number.isFinite)),
      );
      return {
        id: `${cell.id}:${type}`,
        anchorId: `${member.lat}:${member.lon}:${type}`,
        count: cell.count,
        counts: cell.counts,
        type,
        anchor,
        radius: cell.count > 20 ? 13 : cell.count > 4 ? 11 : 9,
        point: {
          lat: member.lat,
          lon: member.lon,
          locationName: member.locationName,
        },
      };
    })
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export function selectDetailLevel(cellDegrees, previous = null) {
  const level = THREE.MathUtils.clamp(
    Math.log2(CELL_SIZES[0] / cellDegrees),
    0,
    CELL_SIZES.length - 1,
  );
  let selected = previous ?? Math.round(level);
  // A dead band prevents a trackpad from oscillating around a detail threshold.
  while (selected < CELL_SIZES.length - 1 && level > selected + 0.65)
    selected++;
  while (selected > 0 && level < selected - 0.65) selected--;
  return selected;
}

export function createPinLayer({
  canvas,
  camera,
  earth,
  records,
  types,
  reducedMotion,
}) {
  const ctx = canvas.getContext("2d");
  const icons = types.map((type) => new Path2D(sourcePaths[type.id]));
  const states = new Map();
  const cache = new Map();
  const projected = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    eye = new THREE.Vector3();
  let width = 1,
    height = 1,
    active = new Set(types.map((_, i) => i)),
    hitTargets = [];
  let layers = [],
    frameId = 0;

  const dotGeometry = new THREE.BufferGeometry();
  const dotMaterial = new THREE.PointsMaterial({
    color: "#fff",
    size: 1.15,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
  });
  const dots = new THREE.Points(dotGeometry, dotMaterial);
  earth.add(dots);

  function setTypes(next) {
    active = new Set(next);
    const key = [...active].sort().join(",");
    if (!cache.has(key)) {
      cache.set(key, new Map());
      if (cache.size > 4) cache.delete(cache.keys().next().value);
    }
    layers = cache.get(key);
    const positions = [];
    for (const record of records) {
      if (!active.has(record.type)) continue;
      const lat = (record.lat * Math.PI) / 180,
        lon = (record.lon * Math.PI) / 180;
      positions.push(
        Math.cos(lat) * Math.cos(lon) * 1.000005,
        Math.sin(lat) * 1.000005,
        -Math.cos(lat) * Math.sin(lon) * 1.000005,
      );
    }
    dotGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    dotGeometry.computeBoundingSphere();
  }
  setTypes(active);

  function resize(w, h, dpr) {
    width = w;
    height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function project(cluster, intro) {
    normal.copy(cluster.anchor).applyQuaternion(earth.quaternion);
    // Exact surface/view angle, rather than a camera-distance-dependent z cutoff.
    const facing =
      (normal.dot(eye) - 1) / Math.max(1e-8, eye.distanceTo(normal));
    const horizon = THREE.MathUtils.smoothstep(facing, 0.025, 0.2);
    projected
      .copy(normal)
      .multiplyScalar(1.000004)
      .add(earth.position)
      .project(camera);
    const x = (projected.x * 0.5 + 0.5) * width,
      y = (-projected.y * 0.5 + 0.5) * height;
    const top = 86;
    const edge = Math.min(
      THREE.MathUtils.smoothstep(x, 12, 44),
      THREE.MathUtils.smoothstep(width - x, 12, 44),
      THREE.MathUtils.smoothstep(y, top, top + 32),
      THREE.MathUtils.smoothstep(height - y, 110, 145),
    );
    return { x, y, visibility: horizon * edge * intro };
  }

  function update(dt, progress) {
    frameId++;
    ctx.clearRect(0, 0, width, height);
    hitTargets = [];
    const intro = THREE.MathUtils.smoothstep(progress, 0.45, 0.9);
    dotMaterial.opacity = intro * 0.17;
    eye.copy(camera.position).sub(earth.position);
    const focalPixels =
      height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const pixelsPerDegree =
      ((focalPixels / Math.max(1e-6, eye.length() - 1)) * Math.PI) / 180;
    const detail = detailBlend(
      Math.log2(CELL_SIZES[0] / (46 / pixelsPerDegree)),
      0,
      CELL_SIZES.length - 1,
    );
    for (const state of states.values()) {
      state.target = 0;
      state.weight = 0;
      state.nextAccepted = false;
    }

    for (const [level, weight] of [
      [detail.base, 1 - detail.blend],
      [detail.fine, detail.blend],
    ]) {
      if (weight < 0.001) continue;
      const layout = [],
        retained = [],
        entering = [];
      if (!layers.has(level))
        layers.set(level, clusterRecords(records, CELL_SIZES[level], active));
      for (const cluster of layers.get(level)) {
        const screen = project(cluster, intro);
        if (screen.visibility < 0.001) continue;
        const id = cluster.anchorId,
          state = states.get(id),
          entry = { cluster, screen, id };
        (state?.accepted ? retained : entering).push(entry);
      }
      for (const { cluster, screen, id } of [...retained, ...entering]) {
        let separation = 1;
        // Priority and anchors never change while orbiting. Collisions affect
        // opacity only, with a soft band instead of a binary merge/split.
        for (const other of layout) {
          const clearance = Math.max(
            Math.abs(screen.x - other.x) / (cluster.radius + other.radius + 22),
            Math.abs(screen.y - other.y) / (cluster.radius + other.radius + 12),
          );
          separation = Math.min(
            separation,
            THREE.MathUtils.smoothstep(clearance, 0.9, 1.18),
          );
          if (separation === 0) break;
        }
        // A shared geographic anchor stays a single pin while its cluster splits.
        let state = states.get(id);
        if (!state) {
          state = {
            cluster,
            alpha: 0,
            target: 0,
            displayRadius: cluster.radius,
          };
          states.set(id, state);
        }
        if (weight >= state.weight) {
          state.cluster = cluster;
          state.weight = weight;
        }
        const visible = separation > (state.accepted ? 0.3 : 0.7);
        state.nextAccepted ||= visible;
        state.screen = screen;
        state.frameId = frameId;
        state.target = Math.min(1, state.target + (visible ? weight : 0));
        if (visible) layout.push({ ...screen, radius: cluster.radius });
      }
    }

    // Persist entering and leaving clusters until their transition finishes.
    // Always reproject their geographic anchors; never tween screen positions.
    for (const [id, state] of states) {
      state.accepted = state.nextAccepted;
      state.alpha = reducedMotion
        ? state.target
        : THREE.MathUtils.damp(state.alpha, state.target, 8, dt);
      state.displayRadius = THREE.MathUtils.damp(
        state.displayRadius,
        state.cluster.radius,
        9,
        dt,
      );
      if (state.alpha < 0.002 && state.target === 0) {
        states.delete(id);
        continue;
      }
      const screen =
        state.frameId === frameId
          ? state.screen
          : project(state.cluster, intro);
      const alpha = state.alpha * screen.visibility;
      if (alpha < 0.003) continue;
      drawPin(state.cluster, screen, alpha, state.displayRadius);
      if (alpha > 0.42) hitTargets.push({ ...state.cluster, ...screen, alpha });
    }
    ctx.globalAlpha = 1;
  }

  function drawPin(cluster, screen, alpha, r = cluster.radius) {
    const { x, y } = screen;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(16,19,24,.9)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    const size = r + 3;
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = "#fff";
    ctx.fill(icons[cluster.type], "evenodd");
    ctx.restore();
    if (cluster.count > 5) {
      const text = cluster.count > 99 ? "99+" : String(cluster.count);
      ctx.font = "500 8px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const badgeWidth = ctx.measureText(text).width + 7;
      ctx.fillStyle = "#f2f2f3";
      ctx.beginPath();
      ctx.roundRect(x + r - 4, y - r - 5, badgeWidth, 12, 5);
      ctx.fill();
      ctx.fillStyle = "#17191d";
      ctx.fillText(text, x + r - 4 + badgeWidth / 2, y - r + 1);
    }
  }

  return {
    resize,
    update,
    filter: setTypes,
    setRecords(next) {
      records = next;
      states.clear();
      cache.clear();
      setTypes(active);
    },
    labelObstacles: () =>
      hitTargets.map((pin) => ({
        x: pin.x - pin.radius - 5,
        y: pin.y - pin.radius - 14,
        w: pin.radius * 2 + 25,
        h: pin.radius * 2 + 20,
      })),
    hitTest(x, y) {
      return (
        hitTargets
          .filter((pin) => Math.hypot(x - pin.x, y - pin.y) < pin.radius + 7)
          .sort((a, b) => b.alpha - a.alpha)[0] || null
      );
    },
    dispose() {
      earth.remove(dots);
      dotGeometry.dispose();
      dotMaterial.dispose();
      states.clear();
      cache.clear();
    },
  };
}

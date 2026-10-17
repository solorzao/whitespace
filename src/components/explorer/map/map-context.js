import * as THREE from "three";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { geoVector, vectorGeo, EARTH_KM } from "./geo.js";
import { coverageFallbacks, overlapsTile } from "./tile-coverage.js";
import { TileQueue } from "./tile-queue.js";
import { tilePoint, visibleTiles } from "./tile-view.js";

export function contextZoom(altitude, latitude, height, previous = null) {
  const mpp = Math.max(
    0.1,
    (altitude * EARTH_KM * 1000 * 2 * Math.tan(Math.PI / 9)) / height,
  );
  const detail = Math.log2(
    (Math.max(0.01, Math.cos((latitude * Math.PI) / 180)) * 40075016.7) /
      (512 * mpp),
  );
  let z = previous ?? Math.round(detail);
  while (detail > z + 0.7) z++;
  while (detail < z - 0.7) z--;
  return Math.max(0, Math.min(15, z));
}
export function labelName(properties) {
  return (
    properties._name_en ||
    properties._name_global ||
    properties._name ||
    properties._name_local ||
    ""
  );
}
export function boxesOverlap(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

export function stableLabelCandidates(
  states,
  candidates,
  project,
  width,
  height,
) {
  const byName = new Map();
  for (const label of candidates)
    if (!byName.has(label.name) || byName.get(label.name).weight < label.weight)
      byName.set(label.name, label);
  const retained = [],
    names = new Set();
  for (const state of [...states.values()].sort((a, b) => b.alpha - a.alpha)) {
    const replacement = byName.get(state.label.name);
    if (
      state.alpha < 0.15 ||
      !replacement ||
      names.has(state.label.name) ||
      replacement.road !== state.label.road ||
      replacement.country !== state.label.country
    )
      continue;
    const p = project(state.label.anchor);
    if (
      p.visibility < 0.15 ||
      p.x < 20 ||
      p.x > width - 20 ||
      p.y < 90 ||
      p.y > height - 120
    )
      continue;
    retained.push({
      ...state.label,
      weight: replacement.weight,
      retained: true,
    });
    names.add(state.label.name);
  }
  return [...retained, ...candidates];
}

export function createMapContext({
  earth,
  camera,
  overlay,
  onStatus,
  obstacles = () => [],
}) {
  const fontFamily = getComputedStyle(overlay).fontFamily;
  const canvas = document.createElement("canvas");
  canvas.className = "map-labels";
  canvas.setAttribute("aria-hidden", "true");
  overlay.before(canvas);
  const ctx = canvas.getContext("2d"),
    tiles = new Map(),
    states = new Map(),
    queue = new TileQueue(4);
  const projected = new THREE.Vector3(),
    eye = new THREE.Vector3(),
    normal = new THREE.Vector3();
  let width = 1,
    height = 1,
    z = null,
    wanted = new Set(),
    lastPlan = 0,
    lastVisible = false,
    disposed = false;
  let excluded = [],
    lastExclusion = 0,
    revision = 0,
    candidateRevision = -1,
    candidateKey = "",
    candidateList = [],
    lastLayout = 0,
    layoutAltitude = 0,
    layoutDirty = true;
  const layoutQuaternion = new THREE.Quaternion(),
    textWidths = new Map();
  function resize(w, h, dpr) {
    width = w;
    height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function create(request) {
    const { key, x, y, z } = request;
    if (tiles.has(key)) return tiles.get(key);
    const tile = {
      ...request,
      ready: false,
      labels: [],
      line: null,
      alpha: 0,
      lastUsed: performance.now(),
    };
    tiles.set(key, tile);
    tile.load = async (signal) => {
      try {
        const response = await fetch(
          `https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/tile/${z}/${y}/${x}.pbf`,
          { signal },
        );
        if (!response.ok) throw new Error("Map context unavailable");
        const data = new VectorTile(
          new PbfReader(new Uint8Array(await response.arrayBuffer())),
        );
        if (signal.aborted || disposed) return;
        const positions = [],
          labels = [];
        for (const [layerName, layer] of Object.entries(data.layers)) {
          const road = layerName === "Road",
            roadLabel = layerName === "Road/label";
          const city = /^City (small|large) scale$/.test(layerName),
            country = layerName === "Admin0 point";
          if (!road && !roadLabel && !city && !country) continue;
          for (let i = 0; i < layer.length; i++) {
            const feature = layer.feature(i),
              p = feature.properties,
              geometry = feature.loadGeometry(),
              name = labelName(p);
            const vector = (point) => {
              const geo = tilePoint(
                x + point.x / layer.extent,
                y + point.y / layer.extent,
                z,
              );
              return geoVector(geo.lat, geo.lon);
            };
            if (road && z >= 10) {
              for (const path of geometry)
                for (let j = 1; j < path.length; j++) {
                  const a = vector(path[j - 1]).multiplyScalar(1.000008),
                    b = vector(path[j]).multiplyScalar(1.000008);
                  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
                }
            }
            if (!name || name.length > 42 || !(roadLabel || city || country))
              continue;
            if ((roadLabel && z < 11) || (country && z > 5) || (city && z > 13))
              continue;
            // Esri minzoom fields are expressed in tenths of a zoom level.
            if (Number(p._minzoom || 0) > z * 10 + 10) continue;
            const path = geometry.reduce(
              (best, path) => (path.length > best.length ? path : best),
              [],
            );
            if (!path.length) continue;
            const index = Math.floor((path.length - 1) / 2),
              anchor = vector(path[index]);
            const end = roadLabel
              ? vector(path[Math.min(path.length - 1, index + 1)])
              : null;
            labels.push({
              name,
              anchor,
              end,
              road: roadLabel,
              country,
              priority: country
                ? 0
                : city
                  ? 20 + Number(p.SelectionPriority || 50)
                  : 200 + Number(p._label_class || 0),
              id: `${name}:${anchor.x.toFixed(5)}:${anchor.y.toFixed(5)}:${anchor.z.toFixed(5)}`,
            });
          }
        }
        if (signal.aborted || disposed) return;
        if (positions.length) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(positions, 3),
          );
          tile.line = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({
              color: "#d4dae3",
              transparent: true,
              opacity: 0,
              depthWrite: false,
            }),
          );
          tile.line.renderOrder = 40;
          earth.add(tile.line);
        }
        tile.labels = labels
          .sort((a, b) => a.priority - b.priority)
          .slice(0, 180);
        tile.ready = true;
        revision++;
      } catch (error) {
        if (error.name !== "AbortError")
          tile.retryAt = performance.now() + 12000;
      }
    };
    return tile;
  }
  function project(anchor) {
    normal.copy(anchor).applyQuaternion(earth.quaternion);
    const facing =
      (normal.dot(eye) - 1) / Math.max(1e-8, eye.distanceTo(normal));
    projected
      .copy(normal)
      .multiplyScalar(1.000008)
      .add(earth.position)
      .project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (-0.5 * projected.y + 0.5) * height,
      visibility: THREE.MathUtils.smoothstep(facing, 0.04, 0.22),
    };
  }
  function update(now, dt, progress) {
    ctx.clearRect(0, 0, width, height);
    eye.copy(camera.position).sub(earth.position);
    const altitude = eye.length() - 1,
      center = vectorGeo(
        eye.clone().applyQuaternion(earth.quaternion.clone().invert()),
      );
    const next = contextZoom(altitude, center.lat, height, z),
      intro = THREE.MathUtils.smoothstep(progress, 0.7, 0.98);
    if (intro === 0) {
      queue.replace([]);
      for (const tile of tiles.values())
        if (tile.line) tile.line.visible = false;
      return;
    }
    if (next !== z || now - lastPlan > 240) {
      z = next;
      lastPlan = now;
      wanted = new Set();
      const jobs = [];
      for (const request of visibleTiles(earth, camera, z, {
        maxColumns: 6,
        maxRows: 6,
        margin: 1,
      })) {
        const tile = create(request);
        wanted.add(tile.key);
        tile.lastUsed = now;
        if (!tile.ready && !(tile.retryAt > now))
          jobs.push({
            key: tile.key,
            priority: request.priority,
            run: tile.load,
          });
      }
      queue.replace(jobs);
    }
    if (now - lastExclusion > 200) {
      lastExclusion = now;
      excluded = [];
      const card = document.getElementById("region-card");
      if (card && !card.hidden) {
        const r = card.getBoundingClientRect();
        excluded.push({
          x: r.x - 10,
          y: r.y - 10,
          w: r.width + 20,
          h: r.height + 20,
        });
      }
    }
    const requested = [...wanted].map((key) => tiles.get(key));
    const fallback = coverageFallbacks(requested, [...tiles.values()]);
    const key =
      [...wanted].sort().join("|") + ";" + [...fallback].sort().join("|");
    const changed = revision !== candidateRevision || key !== candidateKey;
    if (changed) {
      candidateRevision = revision;
      candidateKey = key;
      layoutDirty = true;
      const unique = new Map();
      for (const tile of tiles.values())
        if (tile.ready && (wanted.has(tile.key) || fallback.has(tile.key))) {
          const weight = wanted.has(tile.key) ? 1 : 0.8;
          for (const label of tile.labels)
            if (!unique.has(label.id) || unique.get(label.id).weight < weight)
              unique.set(label.id, { ...label, weight });
        }
      candidateList = [...unique.values()].sort(
        (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
      );
    }
    for (const tile of tiles.values()) {
      const target =
        tile.ready && (wanted.has(tile.key) || fallback.has(tile.key)) ? 1 : 0;
      tile.alpha = THREE.MathUtils.damp(
        tile.alpha,
        target,
        7,
        Math.min(dt, 0.05),
      );
      if (tile.line) {
        const replacements = fallback.has(tile.key)
          ? requested.filter((request) => overlapsTile(tile, request))
          : [];
        const coverage = replacements.length
          ? replacements.reduce(
              (sum, request) => sum + (request.ready ? request.alpha : 0),
              0,
            ) / replacements.length
          : 0;
        tile.line.material.opacity = tile.alpha * intro * 0.18 * (1 - coverage);
        tile.line.visible = tile.line.material.opacity > 0.002;
      }
    }
    const moved =
      (earth.quaternion.angleTo(layoutQuaternion) * height) /
      (2 * Math.tan(Math.PI / 9) * Math.max(0.0001, altitude));
    const zoomed = Math.abs(
      Math.log(Math.max(0.0001, altitude) / Math.max(0.0001, layoutAltitude)),
    );
    // Project every frame, but only reconsider placement after meaningful movement.
    // Visible labels get first choice so incoming tiles cannot constantly replace them.
    if (
      (layoutDirty || moved > 14 || zoomed > 0.035 || now - lastLayout > 500) &&
      now - lastLayout >= 100
    ) {
      lastLayout = now;
      layoutDirty = false;
      if (textWidths.size > 2000) textWidths.clear();
      layoutQuaternion.copy(earth.quaternion);
      layoutAltitude = altitude;
      for (const state of states.values()) state.target = 0;
      const occupied = [...excluded, ...obstacles()],
        names = new Set();
      let roads = 0,
        places = 0;
      for (const label of stableLabelCandidates(
        states,
        candidateList,
        project,
        width,
        height,
      )) {
        if (names.has(label.name) || (label.road ? roads >= 16 : places >= 10))
          continue;
        const p = project(label.anchor),
          inset = label.retained ? 20 : 60;
        if (
          p.visibility < (label.retained ? 0.15 : 0.5) ||
          p.x < inset ||
          p.x > width - inset ||
          p.y < 105 ||
          p.y > height - 150
        )
          continue;
        const font = `${label.road ? 450 : 550} ${label.road ? 11 : label.country ? 11 : 12}px ${fontFamily}`;
        const widthKey = font + label.name;
        if (!textWidths.has(widthKey)) {
          ctx.font = font;
          textWidths.set(widthKey, ctx.measureText(label.name).width);
        }
        const textWidth = textWidths.get(widthKey);
        let angle = states.get(label.id)?.angle || 0;
        if (label.end) {
          const end = project(label.end),
            dx = end.x - p.x,
            dy = end.y - p.y;
          if (Math.hypot(dx, dy) < 3) {
            if (!label.retained) continue;
          } else {
            angle = Math.atan2(dy, dx);
            if (angle > Math.PI / 2) angle -= Math.PI;
            if (angle < -Math.PI / 2) angle += Math.PI;
          }
        }
        const padding = label.retained ? 18 : 35;
        const w =
            Math.abs(Math.cos(angle)) * textWidth +
            Math.abs(Math.sin(angle)) * 14 +
            padding,
          h =
            Math.abs(Math.sin(angle)) * textWidth +
            Math.abs(Math.cos(angle)) * 14 +
            (label.retained ? 14 : 24);
        const box = { x: p.x - w / 2, y: p.y - h / 2, w, h };
        if (occupied.some((other) => boxesOverlap(box, other))) continue;
        occupied.push(box);
        names.add(label.name);
        if (label.road) roads++;
        else places++;
        let state = states.get(label.id);
        if (!state) {
          state = { label, alpha: 0, target: 0, angle };
          states.set(label.id, state);
        }
        state.angle = angle;
        state.target = label.weight;
      }
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let any = false;
    for (const [id, state] of states) {
      state.alpha = THREE.MathUtils.damp(
        state.alpha,
        state.target,
        6,
        Math.min(dt, 0.05),
      );
      if (state.alpha < 0.005 && state.target === 0) {
        states.delete(id);
        continue;
      }
      const label = state.label,
        p = project(label.anchor);
      const edge = Math.min(
        THREE.MathUtils.smoothstep(p.x, 20, 60),
        THREE.MathUtils.smoothstep(width - p.x, 20, 60),
        THREE.MathUtils.smoothstep(p.y, 85, 115),
        THREE.MathUtils.smoothstep(height - p.y, 110, 155),
      );
      const alpha = state.alpha * p.visibility * intro * edge;
      if (alpha < 0.01) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(state.angle);
      ctx.globalAlpha = alpha * (label.road ? 0.74 : 0.9);
      ctx.font = `${label.road ? 450 : 550} ${label.road ? 11 : label.country ? 11 : 12}px ${fontFamily}`;
      ctx.fillStyle = label.road ? "#d4dae3" : "#eef1f6";
      ctx.shadowColor = "rgba(3,6,12,.95)";
      ctx.shadowBlur = 5;
      ctx.fillText(label.name, 0, 0);
      ctx.restore();
      any = true;
    }
    if (any !== lastVisible) {
      lastVisible = any;
      onStatus(any);
    }
    if (tiles.size > 80)
      for (const tile of [...tiles.values()].sort(
        (a, b) => a.lastUsed - b.lastUsed,
      )) {
        if (tiles.size <= 80) break;
        if (wanted.has(tile.key) || tile.alpha > 0.01) continue;
        if (tile.line) {
          earth.remove(tile.line);
          tile.line.geometry.dispose();
          tile.line.material.dispose();
        }
        tiles.delete(tile.key);
      }
  }
  return {
    resize,
    update,
    dispose() {
      disposed = true;
      queue.dispose();
      canvas.remove();
      for (const tile of tiles.values())
        if (tile.line) {
          earth.remove(tile.line);
          tile.line.geometry.dispose();
          tile.line.material.dispose();
        }
      tiles.clear();
    },
  };
}

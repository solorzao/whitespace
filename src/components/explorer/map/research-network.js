import * as THREE from "three";
import { geoVector } from "./geo.js";

// A small, fixed graph: no per-frame clustering or extra map requests.
export function createResearchNetwork({
  earth,
  camera,
  container,
  records,
  reducedMotion,
}) {
  const canvas = document.createElement("canvas");
  canvas.className = "research-network";
  canvas.setAttribute("aria-hidden", "true");
  container.append(canvas);
  const ctx = canvas.getContext("2d"),
    world = new THREE.Vector3(),
    eye = new THREE.Vector3();
  let anchors = [
    ...new Map(
      records.map((record) => [
        `${record.lat}:${record.lon}`,
        { anchor: geoVector(record.lat, record.lon) },
      ]),
    ).values(),
  ];
  let dirty = false;
  let active = false,
    alpha = 0,
    nodes = [],
    edges = [],
    width = 0,
    height = 0,
    dpr = 1,
    started = 0,
    origin = null,
    lastBuild = 0;
  function project(anchor) {
    world.copy(anchor).applyQuaternion(earth.quaternion);
    eye.copy(camera.position).sub(earth.position);
    if (world.dot(eye) <= 1.000001) return null;
    world.multiplyScalar(1.000008).add(earth.position).project(camera);
    return {
      x: (world.x * 0.5 + 0.5) * width,
      y: (0.5 - world.y * 0.5) * height,
    };
  }
  function build() {
    const center = origin ? project(geoVector(origin.lat, origin.lon)) : null;
    const candidates = anchors
      .filter((node) => {
        const p = project(node.anchor);
        if (
          !p ||
          p.x < 35 ||
          p.x > width - 35 ||
          p.y < 100 ||
          p.y > height - 110
        )
          return false;
        node.p = p;
        return true;
      })
      .sort(
        (a, b) =>
          Math.hypot(
            a.p.x - (center?.x ?? width * 0.5),
            a.p.y - (center?.y ?? height * 0.5),
          ) -
          Math.hypot(
            b.p.x - (center?.x ?? width * 0.5),
            b.p.y - (center?.y ?? height * 0.5),
          ),
      );
    nodes = [];
    for (const node of candidates) {
      if (
        nodes.every(
          (other) =>
            Math.hypot(node.p.x - other.p.x, node.p.y - other.p.y) > 24,
        )
      )
        nodes.push(node);
      if (nodes.length === 42) break;
    }
    if (origin) nodes.unshift({ anchor: geoVector(origin.lat, origin.lon) });
    edges = [];
    const linked = new Set([0]);
    while (linked.size < nodes.length) {
      let best = null;
      for (const a of linked)
        for (let b = 0; b < nodes.length; b++)
          if (!linked.has(b)) {
            const d = nodes[a].anchor.distanceToSquared(nodes[b].anchor);
            if (!best || d < best.d) best = { a, b, d };
          }
      if (!best) break;
      edges.push(best);
      linked.add(best.b);
    }
    for (let a = 0; a < nodes.length; a += 3) {
      const neighbors = nodes
        .map((node, b) => ({
          a,
          b,
          d: node.anchor.distanceToSquared(nodes[a].anchor),
        }))
        .filter((edge) => edge.a !== edge.b)
        .sort((a, b) => a.d - b.d);
      const next = neighbors[1];
      if (
        next &&
        !edges.some(
          (edge) =>
            (edge.a === a && edge.b === next.b) ||
            (edge.b === a && edge.a === next.b),
        )
      )
        edges.push(next);
    }
  }
  return {
    setRecords(next) {
      anchors = [
        ...new Map(
          next.map((record) => [
            `${record.lat}:${record.lon}`,
            { anchor: geoVector(record.lat, record.lon) },
          ]),
        ).values(),
      ];
      lastBuild = 0;
    },
    start(point) {
      origin = point ? { lat: point.lat, lon: point.lon } : null;
      active = true;
      started = performance.now();
      width = 0;
      lastBuild = 0;
    },
    stop() {
      active = false;
    },
    update(now, dt, w, h) {
      if (width !== w || height !== h) {
        width = w;
        height = h;
        dpr = Math.min(devicePixelRatio, 2);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (active) build();
      }
      alpha +=
        (Number(active) - alpha) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 3));
      if (alpha < 0.005) {
        if (dirty) {
          ctx.clearRect(0, 0, width, height);
          dirty = false;
        }
        return;
      }
      ctx.clearRect(0, 0, width, height);
      dirty = true;
      // Focus flights can move from continent to city after the question starts.
      // Re-sample only while travelling or when the visible graph leaves view.
      if (
        active &&
        now - lastBuild > 900 &&
        (now - started < 2800 ||
          nodes.filter((node) => {
            const p = project(node.anchor);
            return p && p.x > 0 && p.x < width && p.y > 80 && p.y < height - 80;
          }).length < 3)
      ) {
        build();
        lastBuild = now;
      }
      const time = (now - started) / 1000,
        breath = reducedMotion ? 0.7 : 0.65 + 0.25 * Math.sin(time * 1.6);
      const points = nodes.map((node) => project(node.anchor));
      edges.forEach((edge, i) => {
        const a = points[edge.a],
          b = points[edge.b];
        if (!a || !b) return;
        const reveal = reducedMotion
          ? 1
          : THREE.MathUtils.smoothstep(time - i * 0.035, 0, 1.3);
        if (!reveal) return;
        ctx.strokeStyle = `rgba(234,240,248,${alpha * breath * 0.72 * reveal})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * reveal, a.y + (b.y - a.y) * reveal);
        ctx.stroke();
        if (!reducedMotion && i % 3 === 0 && reveal === 1) {
          const t = (time * 0.16 + i * 0.173) % 1;
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.75 * Math.sin(t * Math.PI)})`;
          ctx.beginPath();
          ctx.arc(
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
            1.6,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      });
      points.forEach((p, i) => {
        if (!p) return;
        ctx.fillStyle = `rgba(245,248,255,${alpha * breath})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === 0 ? 3.5 : 2.3, 0, Math.PI * 2);
        ctx.fill();
        if (i % 4 === 0) {
          const phase = reducedMotion ? 0.5 : (time * 0.3 + i * 0.19) % 1;
          ctx.strokeStyle = `rgba(240,245,255,${alpha * (1 - phase) * 0.5})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4 + phase * 15, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    },
    dispose() {
      canvas.remove();
    },
  };
}

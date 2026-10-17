import * as THREE from "three";
import { imageryDetail, referenceDetail } from "./imagery-detail.js";
import { coverageFallbacks, detailOpacity } from "./tile-coverage.js";
import { TileQueue } from "./tile-queue.js";
import { visibleTiles } from "./tile-view.js";
import { vectorGeo, geoVector } from "./geo.js";

const defaultTileURL =
  process.env.NEXT_PUBLIC_IMAGERY_TILE_URL ||
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const coordinate = (x, y, z) => ({
  lon: (x / 2 ** z) * 360 - 180,
  lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI,
});

export function createImageryLayer(
  earth,
  camera,
  onStatus,
  {
    pixelRatio = 1,
    anisotropy = 1,
    reference = false,
    tileURL = defaultTileURL,
    order = 0,
  } = {},
) {
  const tiles = new Map(),
    queue = new TileQueue(6);
  let lastUpdate = 0,
    wanted = new Map(),
    disposed = false,
    lastVisible;
  function status(visible) {
    if (visible !== lastVisible) {
      lastVisible = visible;
      onStatus(visible);
    }
  }
  function createTile(x, y, z) {
    const n = 2 ** z,
      wrappedX = ((x % n) + n) % n,
      key = `${z}/${wrappedX}/${y}`;
    if (tiles.has(key)) return key;
    const segments = Math.max(2, Math.min(64, Math.ceil(1024 / 2 ** z)));
    const positions = [],
      uv = [],
      indices = [];
    for (let row = 0; row <= segments; row++)
      for (let col = 0; col <= segments; col++) {
        const geo = coordinate(
            wrappedX + col / segments,
            y + row / segments,
            z,
          ),
          p = geoVector(geo.lat, geo.lon).multiplyScalar(1.000004);
        positions.push(p.x, p.y, p.z);
        uv.push(col / segments, 1 - row / segments);
        if (row < segments && col < segments) {
          const a = row * (segments + 1) + col,
            b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: reference ? "#ffffff" : "#cbd7e5",
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = order + z;
    mesh.visible = false;
    earth.add(mesh);
    const tile = {
      key,
      x: wrappedX,
      y,
      z,
      mesh,
      ready: false,
      lastUsed: performance.now(),
      texture: null,
      alpha: 0,
    };
    tiles.set(key, tile);
    tile.load = async (signal) => {
      try {
        const response = await fetch(
          tileURL.replace("{z}", z).replace("{x}", wrappedX).replace("{y}", y),
          { signal },
        );
        if (!response.ok) throw new Error("Tile unavailable");
        const bitmap = await createImageBitmap(await response.blob(), {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
        });
        if (signal.aborted || disposed || tile.disposed) {
          bitmap.close();
          return;
        }
        const texture = new THREE.Texture(bitmap);
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
        material.map = texture;
        material.needsUpdate = true;
        tile.texture = texture;
        tile.ready = true;
      } catch (error) {
        if (error.name !== "AbortError")
          tile.retryAt = performance.now() + 10000;
      }
    };
    return key;
  }
  function update(now, width, height, dt = 0.016, progress = 1) {
    const altitude = camera.position.distanceTo(earth.position) - 1;
    const center = vectorGeo(
      camera.position
        .clone()
        .sub(earth.position)
        .applyQuaternion(earth.quaternion.clone().invert()),
    );
    const levels = reference
      ? referenceDetail(altitude, center.lat, height, camera.fov, progress)
      : imageryDetail(altitude, center.lat, height, pixelRatio, camera.fov);
    if (!levels.enabled) {
      for (const tile of tiles.values()) {
        tile.mesh.visible = false;
        tile.alpha = 0;
      }
      queue.replace([]);
      status(false);
      return;
    }
    if (
      now - lastUpdate > 180 ||
      ![...wanted.keys()].some(
        (key) => Number(key.split("/")[0]) === levels.fine,
      )
    ) {
      lastUpdate = now;
      wanted = new Map();
      const jobs = [],
        parents = new Set();
      for (const z of new Set([levels.base, levels.fine])) {
        for (const request of visibleTiles(earth, camera, z, { margin: 1 })) {
          const key = createTile(request.x, request.y, z),
            tile = tiles.get(key);
          wanted.set(key, z);
          tile.lastUsed = now;
          if (!tile.ready && !(tile.retryAt > now))
            jobs.push({
              key,
              priority: (z - levels.base) * 4 + request.priority,
              run: tile.load,
            });
          if (z === levels.base && !tile.ready && z > 4) {
            const parentZ = Math.max(4, z - 2),
              factor = 2 ** (z - parentZ),
              parentKey = createTile(
                Math.floor(request.x / factor),
                Math.floor(request.y / factor),
                parentZ,
              ),
              parent = tiles.get(parentKey);
            parent.lastUsed = now;
            if (
              !parents.has(parentKey) &&
              !parent.ready &&
              !(parent.retryAt > now)
            ) {
              parents.add(parentKey);
              jobs.push({
                key: parentKey,
                priority: -12 + request.priority / factor ** 2,
                run: parent.load,
              });
            }
          }
        }
      }
      queue.replace(jobs);
    }
    const baseTiles = [...wanted]
      .filter(([, z]) => z === levels.base)
      .map(([key]) => tiles.get(key));
    const fallback = coverageFallbacks(baseTiles, [...tiles.values()]);
    let any = false;
    for (const tile of tiles.values()) {
      const desired = detailOpacity(tile, levels, wanted, fallback);
      const target = tile.ready ? desired : 0;
      tile.alpha =
        reference && Math.abs(tile.z - levels.base) > 1
          ? 0
          : THREE.MathUtils.damp(tile.alpha, target, 10, Math.min(dt, 0.05));
      tile.mesh.material.opacity = tile.alpha * levels.opacity;
      tile.mesh.visible = tile.mesh.material.opacity > 0.002;
      any ||= tile.mesh.visible;
    }
    if (tiles.size > 320) {
      for (const tile of [...tiles.values()].sort(
        (a, b) => a.lastUsed - b.lastUsed,
      )) {
        if (tiles.size <= 320) break;
        if (
          wanted.has(tile.key) ||
          fallback.has(tile.key) ||
          tile.alpha > 0.002 ||
          now - tile.lastUsed < 2000
        )
          continue;
        tile.disposed = true;
        earth.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        tile.mesh.material.dispose();
        tile.texture?.image?.close?.();
        tile.texture?.dispose();
        tiles.delete(tile.key);
      }
    }
    status(any);
  }
  return {
    update,
    dispose() {
      disposed = true;
      queue.dispose();
      for (const tile of tiles.values()) {
        earth.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        tile.mesh.material.dispose();
        tile.texture?.image?.close?.();
        tile.texture?.dispose();
      }
      tiles.clear();
    },
  };
}

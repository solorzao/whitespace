export function overlapsTile(a, b) {
  const coarse = a.z <= b.z ? a : b,
    fine = a.z <= b.z ? b : a,
    scale = 2 ** (fine.z - coarse.z);
  return (
    Math.floor(fine.x / scale) === coarse.x &&
    Math.floor(fine.y / scale) === coarse.y
  );
}
// Keep previously drawn children on zoom-out, and parents on zoom-in, until
// the replacement tiles have actually finished fading into place.
export function coverageFallbacks(requested, available) {
  const result = new Set();
  for (const request of requested) {
    if (request.ready && request.alpha >= 0.98) continue;
    let parent = null;
    for (const tile of available) {
      if (!tile.ready || !overlapsTile(tile, request)) continue;
      if (tile.z < request.z) {
        const visible = tile.alpha > 0.01,
          previousVisible = parent?.alpha > 0.01;
        if (
          !parent ||
          (visible && !previousVisible) ||
          (visible === previousVisible && tile.z > parent.z)
        )
          parent = tile;
      } else if (tile.z > request.z && tile.alpha > 0.01) result.add(tile.key);
    }
    if (parent) result.add(parent.key);
  }
  return result;
}

export function detailOpacity(tile, levels, wanted, fallback) {
  const current = wanted.has(tile.key)
    ? tile.z <= levels.base
      ? 1
      : levels.blend
    : 0;
  return Math.max(current, fallback.has(tile.key) ? 1 : 0);
}

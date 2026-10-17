import { detailBlend } from "./detail-blend.js";
import { EARTH_KM } from "./geo.js";

export function imageryDetail(
  altitude,
  latitude,
  height,
  pixelRatio = 1,
  fov = 40,
) {
  const metersPerPixel = Math.max(
    0.1,
    (altitude * EARTH_KM * 1000 * 2 * Math.tan((fov * Math.PI) / 360)) /
      (height * pixelRatio),
  );
  const detail = Math.log2(
    (Math.max(0.01, Math.cos((latitude * Math.PI) / 180)) * 40075016.7) /
      (256 * metersPerPixel),
  );
  const fade = Math.max(0, Math.min(1, (0.9 - altitude) / 0.5));
  return {
    enabled: altitude < 1.1,
    opacity: fade * fade * (3 - 2 * fade),
    ...detailBlend(detail, 4, 19),
  };
}

// Reference tiles use CSS pixels so street names stay readable on Retina screens.
export function referenceDetail(
  altitude,
  latitude,
  height,
  fov = 40,
  progress = 1,
) {
  const metersPerPixel = Math.max(
    0.1,
    (altitude * EARTH_KM * 1000 * 2 * Math.tan((fov * Math.PI) / 360)) / height,
  );
  const detail = Math.log2(
    (Math.max(0.01, Math.cos((latitude * Math.PI) / 180)) * 40075016.7) /
      (256 * metersPerPixel),
  );
  const z = Math.max(0, Math.min(19, Math.round(detail)));
  const intro = Math.max(0, Math.min(1, (progress - 0.65) / 0.3));
  return {
    enabled: altitude < 3.2 && intro > 0,
    opacity: intro * intro * (3 - 2 * intro),
    base: z,
    fine: z,
    blend: 0,
  };
}

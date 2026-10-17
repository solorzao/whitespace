// Adjacent detail levels share a continuous transition, driven by zoom scale.
export function detailBlend(detail, minimum, maximum) {
  const value = Math.max(minimum, Math.min(maximum, detail));
  const base = Math.floor(value),
    fraction = value - base;
  const blend = fraction * fraction * (3 - 2 * fraction);
  return { base, fine: Math.min(maximum, base + 1), blend };
}

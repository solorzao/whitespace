export function createFrameProfiler(enabled) {
  if (!enabled) return null;
  let frames = [],
    active = false;
  return {
    begin() {
      frames = [];
      active = true;
    },
    sample(frame) {
      if (active) frames.push(frame);
    },
    report() {
      active = false;
      if (!frames.length) return;
      const result = { frames: frames.length };
      for (const key of Object.keys(frames[0])) {
        const values = frames.map((frame) => frame[key]).sort((a, b) => a - b);
        result[key] = {
          mean: +(
            values.reduce((sum, value) => sum + value, 0) / values.length
          ).toFixed(2),
          p95: +values[Math.floor((values.length - 1) * 0.95)].toFixed(2),
        };
      }
      console.info("[map-profile]", JSON.stringify(result));
      return result;
    },
  };
}

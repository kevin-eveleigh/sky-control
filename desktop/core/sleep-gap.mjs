const DEFAULT_FLOOR = 5_000;

/** Wall clock is the only sleep signal a plain process gets: macOS monotonic
 *  clocks stop while the machine is asleep, so "the Mac slept" looks like a
 *  large Date.now() jump between two ticks of an interval that never missed. */
export function createSleepGapDetector({
  intervalMs,
  floorMs = DEFAULT_FLOOR,
  now = () => Date.now(),
}) {
  const threshold = Math.max(intervalMs * 2, floorMs);
  let last = now();
  return {
    get threshold() {
      return threshold;
    },
    reset() {
      last = now();
    },
    /** Returns the elapsed milliseconds when they imply a sleep, otherwise 0. */
    tick() {
      const current = now();
      const gap = current - last;
      last = current;
      return gap > threshold ? gap : 0;
    },
  };
}

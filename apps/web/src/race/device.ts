function computeTouch(): boolean {
  if (typeof window === "undefined") return false;
  if ("ontouchstart" in window) return true;
  const mq = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
  return mq?.matches ?? false;
}

let cached: boolean | null = null;

export function isTouchDevice(): boolean {
  if (cached === null) cached = computeTouch();
  return cached;
}

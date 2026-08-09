/**
 * Per-track scenery manifest + asset spec. PURE DATA — no rendering, no physics.
 * Consumed by TrackCanvas.drawStatic to draw decorative vector stand-ins (or
 * optional PNG sprites) anchored to positions along the racing line.
 *
 * Anchor model: each entry places a decoration at s-fraction `s` along the
 * track, offset perpendicular to the racing line by `dist` screen pixels to
 * `side` ("left" = +normal, "right" = −normal; normal = (-sin θ, cos θ) where
 * θ is the path tangent). `dist` is in SCREEN pixels so visual placement is
 * consistent across tracks regardless of world-unit scale.
 *
 * Vector stand-ins render immediately with zero assets. When `asset` is set
 * and the PNG loads, the sprite takes over (anchored at base-center, scaled by
 * `scale`). Until files exist, stand-ins always show.
 *
 * ── ASSET SPEC ─────────────────────────────────────────────────────────────
 * Place PNGs under `apps/web/public/img/tracks/`. Naming convention:
 *   `<trackId>-<kind>-<n>.png`  e.g. `monaco-yacht-1.png`, `monza-cypress-2.png`
 * Reference them in entries as `asset: "<trackId>-<kind>-<n>.png"` (path is
 * resolved relative to `${BASE_URL}img/tracks/`).
 *
 * Recommended PNG sizes (transparent background, anchored at base-center):
 *   tree       → 64 × 80    (deciduous, rounded crown + trunk)
 *   cypress    → 48 × 96    (tall narrow tapered)
 *   grandstand → 128 × 48   (long low, with tiered roofline)
 *   wall       → 96 × 16    (armco segment, tileable on long edges)
 *   building   → 80 × 80    (Monaco-style cream block with windows)
 *   yacht      → 96 × 48    (white hull + mast, harbor-facing)
 *   sea        → 256 × 128  (soft blue water tile, alpha-feathered edges)
 *   hill       → 256 × 96   (soft green ridge, alpha-feathered base)
 *   barrier    → 64 × 16    (tyre stack / guardrail segment, tileable)
 *
 * The path prefix is baked in via `sceneryAssetUrl()` below; do not include
 * `img/tracks/` in the `asset` string.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type SceneryKind =
  | "tree"
  | "cypress"
  | "grandstand"
  | "wall"
  | "building"
  | "yacht"
  | "sea"
  | "hill"
  | "barrier";

export interface SceneryEntry {
  /** Anchor position along the track as s-fraction [0..1]. */
  s: number;
  /** Side of the track: "left" = +normal, "right" = −normal. */
  side: "left" | "right";
  /** Perpendicular distance from the racing line, in SCREEN pixels. */
  dist: number;
  kind: SceneryKind;
  /** Optional PNG filename under public/img/tracks/ (without folder prefix). */
  asset?: string;
  /** Optional scale factor (default 1). */
  scale?: number;
}

const BASE = import.meta.env.BASE_URL;

/** Resolve an asset filename to its full URL under public/img/tracks/. */
export function sceneryAssetUrl(asset: string): string {
  return `${BASE}img/tracks/${asset}`;
}

/**
 * Per-track decoration manifest. Entries are rendered in array order.
 * Background kinds (hill, sea, yacht) are drawn BEFORE the track surface so
 * the surface overlaps their base; foreground kinds (everything else) are
 * drawn AFTER the surface so they sit on top of the grass/gravel edge.
 *
 * s-fractions are chosen to approximately match real-world landmark locations
 * for each circuit (Monaco harbor ~0.4–0.55, Monza grandstand at S/F, etc.).
 */
export const SCENERY: Record<string, SceneryEntry[]> = {
  monza: [
    { s: 0.02, side: "left", dist: 34, kind: "grandstand", scale: 1.7 },
    { s: 0.04, side: "right", dist: 32, kind: "grandstand", scale: 1.4 },
    { s: 0.08, side: "right", dist: 28, kind: "barrier", scale: 1.2 },
    { s: 0.11, side: "left", dist: 32, kind: "cypress", scale: 1.2 },
    { s: 0.15, side: "right", dist: 30, kind: "tree" },
    { s: 0.18, side: "left", dist: 32, kind: "cypress" },
    { s: 0.22, side: "right", dist: 28, kind: "barrier", scale: 1.2 },
    { s: 0.25, side: "left", dist: 34, kind: "cypress", scale: 1.1 },
    { s: 0.30, side: "right", dist: 32, kind: "tree" },
    { s: 0.34, side: "left", dist: 30, kind: "cypress" },
    { s: 0.38, side: "right", dist: 32, kind: "tree" },
    { s: 0.42, side: "left", dist: 30, kind: "cypress", scale: 1.2 },
    { s: 0.46, side: "right", dist: 28, kind: "barrier", scale: 1.2 },
    { s: 0.50, side: "left", dist: 32, kind: "cypress" },
    { s: 0.54, side: "right", dist: 34, kind: "grandstand", scale: 1.1 },
    { s: 0.58, side: "left", dist: 30, kind: "tree" },
    { s: 0.64, side: "right", dist: 32, kind: "cypress" },
    { s: 0.70, side: "left", dist: 34, kind: "tree", scale: 1.1 },
    { s: 0.76, side: "right", dist: 32, kind: "cypress" },
    { s: 0.82, side: "left", dist: 30, kind: "tree" },
    { s: 0.88, side: "right", dist: 34, kind: "grandstand", scale: 1.3 },
    { s: 0.93, side: "left", dist: 32, kind: "cypress" },
    { s: 0.97, side: "right", dist: 30, kind: "tree" },
  ],
  red_bull_ring: [
    { s: 0.02, side: "left", dist: 34, kind: "grandstand", scale: 1.5 },
    { s: 0.05, side: "right", dist: 90, kind: "hill", scale: 1.8 },
    { s: 0.08, side: "left", dist: 30, kind: "tree" },
    { s: 0.12, side: "right", dist: 32, kind: "tree" },
    { s: 0.16, side: "left", dist: 34, kind: "tree", scale: 1.1 },
    { s: 0.20, side: "right", dist: 95, kind: "hill", scale: 1.5 },
    { s: 0.24, side: "left", dist: 30, kind: "tree" },
    { s: 0.28, side: "right", dist: 32, kind: "tree" },
    { s: 0.32, side: "left", dist: 34, kind: "tree", scale: 1.1 },
    { s: 0.36, side: "right", dist: 30, kind: "tree" },
    { s: 0.42, side: "left", dist: 32, kind: "tree" },
    { s: 0.48, side: "right", dist: 100, kind: "hill", scale: 1.6 },
    { s: 0.54, side: "left", dist: 30, kind: "tree" },
    { s: 0.60, side: "right", dist: 32, kind: "tree", scale: 1.1 },
    { s: 0.66, side: "left", dist: 34, kind: "tree" },
    { s: 0.72, side: "right", dist: 30, kind: "tree" },
    { s: 0.78, side: "left", dist: 95, kind: "hill", scale: 1.4 },
    { s: 0.84, side: "right", dist: 32, kind: "tree" },
    { s: 0.90, side: "left", dist: 30, kind: "tree" },
    { s: 0.94, side: "right", dist: 34, kind: "grandstand", scale: 1.2 },
    { s: 0.97, side: "left", dist: 32, kind: "tree" },
  ],
  interlagos: [
    { s: 0.02, side: "left", dist: 34, kind: "grandstand", scale: 1.6 },
    { s: 0.05, side: "right", dist: 32, kind: "grandstand", scale: 1.3 },
    { s: 0.08, side: "left", dist: 30, kind: "tree" },
    { s: 0.12, side: "right", dist: 32, kind: "tree", scale: 1.1 },
    { s: 0.16, side: "left", dist: 34, kind: "tree" },
    { s: 0.20, side: "right", dist: 100, kind: "hill", scale: 1.6 },
    { s: 0.24, side: "left", dist: 30, kind: "tree" },
    { s: 0.30, side: "right", dist: 32, kind: "tree", scale: 1.1 },
    { s: 0.34, side: "left", dist: 34, kind: "grandstand", scale: 1.1 },
    { s: 0.38, side: "right", dist: 30, kind: "tree" },
    { s: 0.44, side: "left", dist: 32, kind: "tree" },
    { s: 0.48, side: "right", dist: 95, kind: "hill", scale: 1.5 },
    { s: 0.54, side: "left", dist: 30, kind: "tree" },
    { s: 0.58, side: "right", dist: 32, kind: "tree", scale: 1.1 },
    { s: 0.64, side: "left", dist: 30, kind: "tree" },
    { s: 0.68, side: "right", dist: 28, kind: "barrier", scale: 1.2 },
    { s: 0.74, side: "left", dist: 32, kind: "tree" },
    { s: 0.78, side: "right", dist: 95, kind: "hill", scale: 1.3 },
    { s: 0.84, side: "left", dist: 30, kind: "tree" },
    { s: 0.88, side: "right", dist: 34, kind: "grandstand", scale: 1.2 },
    { s: 0.93, side: "left", dist: 30, kind: "tree" },
    { s: 0.97, side: "right", dist: 32, kind: "tree" },
  ],
};

/** Programmatic asset spec (mirrors the doc comment above). */
export const SCENERY_ASSET_SPEC: Record<SceneryKind, { size: [number, number]; naming: string; pathPrefix: string }> = {
  tree:       { size: [64, 80],   naming: "<trackId>-tree-<n>.png",       pathPrefix: "img/tracks/" },
  cypress:    { size: [48, 96],   naming: "<trackId>-cypress-<n>.png",    pathPrefix: "img/tracks/" },
  grandstand: { size: [128, 48],  naming: "<trackId>-grandstand-<n>.png", pathPrefix: "img/tracks/" },
  wall:       { size: [96, 16],   naming: "<trackId>-wall-<n>.png",       pathPrefix: "img/tracks/" },
  building:   { size: [80, 80],   naming: "<trackId>-building-<n>.png",   pathPrefix: "img/tracks/" },
  yacht:      { size: [96, 48],   naming: "<trackId>-yacht-<n>.png",      pathPrefix: "img/tracks/" },
  sea:        { size: [256, 128], naming: "<trackId>-sea-<n>.png",        pathPrefix: "img/tracks/" },
  hill:       { size: [256, 96],  naming: "<trackId>-hill-<n>.png",       pathPrefix: "img/tracks/" },
  barrier:    { size: [64, 16],   naming: "<trackId>-barrier-<n>.png",    pathPrefix: "img/tracks/" },
};

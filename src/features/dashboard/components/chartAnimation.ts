/**
 * Turning off G2 chart animation, correctly.
 *
 * G2 decides whether to run a phase in `createAnimationFunction`:
 *
 * ```js
 * const animate = mark.animate?.[type] || {};
 * const options = { type: animation || defaultAnimation, ...animate };
 * if (!options.type) return null;   // no animation
 * ```
 *
 * So the only value that actually switches a phase off is a falsy *resolved*
 * `type`. The obvious `animate: { enter: false }` does not work: `false || {}`
 * collapses back to `{}`, the spread leaves `type` untouched, and the phase
 * falls through to the shape's default animation.
 *
 * Why this matters here: `@antv/util`'s `getRotatedCurve` walks a path segment
 * index that can run past the end of the first path, so interpolating two area
 * paths of different segment counts dereferences `undefined`. That throw
 * happens inside a `new KeyframeEffect(...)` constructor — outside any
 * try/catch React owns — and escapes as an uncaught page-level `TypeError` on
 * every dashboard render.
 */

/** One phase with its animation type explicitly switched off. */
export interface DisabledAnimationPhase {
  type: false;
}

/** `animate` with every phase disabled. */
export interface DisabledAnimate {
  enter: DisabledAnimationPhase;
  update: DisabledAnimationPhase;
  exit: DisabledAnimationPhase;
}

export const DISABLED_ANIMATE: DisabledAnimate = {
  enter: { type: false },
  update: { type: false },
  exit: { type: false },
};

/**
 * Attaches {@link DISABLED_ANIMATE} to a chart config.
 *
 * The cast is deliberate and load-bearing. `@ant-design/plots` derives its
 * config types from `Spec = (Mark | Composition | AxisComponent | …) & {…}`, and
 * `keyof` over a union keeps only the shared keys — so `Mark.animate` is
 * dropped from `AreaConfig` entirely even though G2 reads it at runtime. The
 * value is real and honoured; only the published type is incomplete. Widening
 * by exactly this one key keeps the workaround in a single named place instead
 * of scattering `as` casts through both chart configs.
 */
export const withDisabledAnimation = <T extends object>(config: T): T & { animate: DisabledAnimate } => ({
  ...config,
  animate: DISABLED_ANIMATE,
});

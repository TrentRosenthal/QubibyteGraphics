/**
 * Public API. Import from here in scenes:
 *
 *   import { Circle, create } from 'qubibyte-graphics';
 *
 * @module qubibyte-graphics
 */

export { PROJECT } from './config.js';

export { Scene, Camera, buildScene, FRAME_SHORT_SIDE } from './core/scene.js';
export { Node, Group, PathNode, ValueTracker, direction } from './core/node.js';
export {
  Shape, Dot, Circle, Ellipse, Arc, Sector, Rect, Polygon, Polyline, RegularPolygon, Star, Line,
  Arrow, DoubleArrow, CurvedArrow, ARROW_HEADS, Brace, braceFor, SVGPathShape, Bezier, bezierPath, Spline,
  catmullRomPath, bSplinePath, ImageNode, VideoNode, Layer,
} from './core/shapes.js';
export {
  Animation, AnimationGroup, Succession, Wait, PropertyAnimation, stagger, lagStart, succession, parallel,
  Create, create, write, Uncreate, uncreate, unwrite, FadeIn, fadeIn, FadeOut, fadeOut,
  Grow, growFromCenter, growFromPoint, growFromEdge, spinIn, GrowArrow, growArrow, ShrinkToCenter, shrinkToCenter,
  Rotate, rotate, Transform, transform, replacementTransform, TransformMatching, transformMatching, matchByKeys,
  CrossFade, crossFade, Indicate, indicate, Wiggle, wiggle, Flash, flash, Circumscribe, circumscribe,
  FocusOn, focusOn, ShowPassingFlash, showPassingFlash, MoveAlongPath, moveAlongPath, followPath, Orbit, orbit,
  UpdateAnimation, animateWith, Typewriter, typewriter, Highlight, highlight,
} from './core/animations.js';
export * as easing from './core/easing.js';
export { resolveEasing, cubicBezier, spring } from './core/easing.js';
export {
  PathBuilder, circlePath, ellipsePath, polyPath, rectPath, parseSVGPath, toSVGPath, transformPath, partialPath,
  alignPaths, lerpAligned, pathBounds, pathLength, pointAtFraction, samplePath, flattenPath, mergePaths,
} from './core/path.js';
export { parseColor, toHex, toCSS, mix, contrast, oklchToRgb, rgbToOklch, phaseColor } from './core/color.js';
export { Random, noise1, noise2 } from './core/random.js';
export { setPlatform } from './core/platform.js';
export { sampleFrame } from './core/sampler.js';

export { getTheme, registerTheme, listThemes, exportTheme, importTheme } from './themes/index.js';
export { renderFrame, registerBoard, viewFor } from './render/canvas.js';
export { renderSVG } from './render/svg.js';
export * from './board/index.js';

export { FORMATS, PRESETS, RESOLUTIONS, parseResolution } from './export/formats.js';
export { toSRT } from './export/srt.js';
export { synthesize, encodeWav } from './export/audio.js';

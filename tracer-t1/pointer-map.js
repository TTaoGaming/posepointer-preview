// Camera space to page space. ONE place for the mirror and the cover-crop, so the picture (CSS: object-fit cover,
// scaleX(-1)) and the pointer use the same rule.
// Tao's fingertip adapter already turns a raw (unmirrored) camera frame into SELFIE space (x -> 1 - x) before calling
// cameraToPage, so the point arriving here is in the mirrored picture's own 0..1 frame space.
//  mirror ON : the picture is flipped, so selfie space is what the child sees: keep x.
//  mirror OFF: the picture is not flipped, so undo the adapter's flip: x -> 1 - x.
// Cover crop (video aspect va = w/h, screen aspect sa = W/H), applied to the displayed axis that overflows:
//  va > sa : the video is scaled to the screen height, its sides are cut:  x' = x*(va/sa) - (va/sa - 1)/2 , y' = y
//  va < sa : the video is scaled to the screen width, top and bottom cut:  y' = y*(sa/va) - (sa/va - 1)/2 , x' = x
// No video (video aspect unknown): identity crop (va = sa). Result clamped to the page 0..1.
const cfg = { va: null, mirror: true };
export const setVideoSize = (w, h) => { cfg.va = w > 0 && h > 0 ? w / h : null; };
export const setMirror = on => { cfg.mirror = !!on; };
const clamp = n => Math.max(0, Math.min(1, n));
export function mapCamera(point, { mirror = true, va = null, sa = 1 } = {}) {
  let x = mirror ? point.x : 1 - point.x, y = point.y;
  const v = va ?? sa;
  if (v > sa) x = x * (v / sa) - (v / sa - 1) / 2; else if (v < sa) y = y * (sa / v) - (sa / v - 1) / 2;
  return { x: clamp(x), y: clamp(y) };
}
export const cameraToPage = point => mapCamera(point, { mirror: cfg.mirror, va: cfg.va, sa: innerWidth / innerHeight });
export function pageToFrame(point, frame) {
  return { x: (point.x - frame.left) / frame.width, y: (point.y - frame.top) / frame.height };
}

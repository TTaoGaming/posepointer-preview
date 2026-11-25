// OPENING SCREEN BACKGROUND. Pure drawing on a 2D canvas context: soft light blobs drifting slowly and a few small stars rising. No assets, no timers,
// no flashing: every change is a slow sine (periods of 20 s and more, alpha never above 0.5). Called every frame with the clock `ts` (ms).
const PAL = {
  sky: [[255, 255, 255], [255, 226, 150], [150, 205, 255], [255, 190, 210], [200, 235, 255], [255, 244, 200]],
  cream: [[255, 250, 235], [255, 220, 160], [240, 200, 150], [255, 200, 180], [255, 238, 200], [230, 210, 170]],
  slate: [[70, 110, 190], [60, 160, 170], [110, 80, 190], [50, 130, 200], [70, 170, 150], [90, 100, 170]]
};
export function drawOpening(g, w, h, ts, look = 'sky') {
  const s = ts / 1000, u = Math.min(w, h), pal = PAL[look] || PAL.sky;
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const cx = w * (.5 + .42 * Math.sin(s * .21 + i * 1.9)), cy = h * (.5 + .40 * Math.cos(s * .17 + i * 2.3)), r = u * (.42 + .07 * Math.sin(s * .23 + i)), c = pal[i % pal.length];
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},.42)`); gr.addColorStop(.55, `rgba(${c[0]},${c[1]},${c[2]},.16)`); gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  for (let i = 0; i < 14; i++) {   // small round sparkles rising slowly, wrapping; alpha is a slow sine so nothing blinks
    const x = w * (((i * .137 + .04 * Math.sin(s * .3 + i)) % 1 + 1) % 1), y = h * (1 - ((s * .02 + i * .071) % 1)), r = u * .007 * (1 + .5 * Math.sin(s * .4 + i * 2)), a = .25 + .2 * Math.sin(s * .5 + i);
    g.fillStyle = look === 'slate' ? `rgba(200,225,255,${a})` : `rgba(255,255,255,${a + .2})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
}

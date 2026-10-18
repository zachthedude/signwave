// A drawn hand that can make every sign. It outputs the same 21 landmarks the
// camera tracker does, so the bot is read by the exact code that reads you.

const FINGERS = [ // MCP position, segment lengths, spread angle (deg from straight up)
  { base: [-0.31, -0.95], len: [.42, .25, .2], spread: -11 },
  { base: [-0.1, -1.0], len: [.47, .29, .21], spread: -3 },
  { base: [0.12, -0.97], len: [.44, .27, .2], spread: 5 },
  { base: [0.31, -0.86], len: [.34, .2, .18], spread: 14 },
];
const FLEX = [75, 110, 70]; // how far each joint folds at full curl
const rad = d => d * Math.PI / 180;

// curls: [thumb, index, middle, ring, pinky] in 0 (up) .. 1 (folded). Returns local
// points: palm length = 1, wrist at origin, fingers toward -y, thumb toward -x.
export function pose(curls) {
  const P = [[0, 0, 0]];
  const tc = curls[0];
  const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * tc);
  P[1] = [-0.25, -0.25, 0];
  P[2] = [-0.45, -0.45, 0];
  P[3] = mix([-0.68, -0.64, 0], [-0.22, -0.62, -0.12]);
  P[4] = mix([-0.9, -0.83, 0], [0.04, -0.64, -0.16]);
  FINGERS.forEach((f, k) => {
    const c = curls[k + 1], s = rad(f.spread) * (1 - c * .6);
    let [x, y] = f.base, z = 0, phi = 0;
    P.push([x, y, z]);
    f.len.forEach((L, j) => {
      phi += rad(FLEX[j]) * c;
      x += Math.sin(s) * Math.cos(phi) * L;
      y += -Math.cos(s) * Math.cos(phi) * L;
      z += -Math.sin(phi) * L;
      P.push([x, y, z]);
    });
  });
  return P;
}

export const curlsOf = mask => [...mask].map(c => c === '1' ? 0 : 1);

// Local points -> tracker landmarks for a hand centred at (cx, cy) in mirrored
// display space (0..1). `left` mirrors the hand so the thumb faces the middle.
export function toLandmarks(P, { cx, cy, size, aspect, left, tilt = 0 }) {
  const cs = Math.cos(tilt), sn = Math.sin(tilt);
  return P.map(([x, y, z]) => {
    const lx = (left ? -x : x), ly = y + .5;              // centre on the palm
    const rx = lx * cs - ly * sn, ry = lx * sn + ly * cs;
    const dx = cx + rx * size / aspect;
    return { x: 1 - dx, y: cy + ry * size, z: z * size / aspect };
  });
}

// A hand that eases toward whatever sign and place it is given.
export class Puppet {
  constructor(left) { this.left = left; this.c = [0, 0, 0, 0, 0]; this.target = [0, 0, 0, 0, 0]; this.x = .5; this.y = 1.3; this.tx = .5; this.ty = .5; this.alpha = 0; this.ta = 1; }
  sign(mask) { this.target = curlsOf(mask); return this; }
  move(x, y) { this.tx = x; this.ty = y; return this; }
  snap() { this.c = [...this.target]; this.x = this.tx; this.y = this.ty; this.alpha = this.ta; return this; }
  step(dt) {
    const k = 1 - Math.exp(-dt * 22), km = 1 - Math.exp(-dt * 7);   // fingers snap, the arm glides
    this.c = this.c.map((v, i) => v + (this.target[i] - v) * k);
    this.x += (this.tx - this.x) * km; this.y += (this.ty - this.y) * km;
    this.alpha += (this.ta - this.alpha) * km;
  }
  get settled() { return this.c.every((v, i) => Math.abs(v - this.target[i]) < .06); }
  landmarks(aspect, size, t = 0) {
    const sway = Math.sin(t * 1.3 + (this.left ? 1 : 0)) * .006;
    return toLandmarks(pose(this.c), { cx: this.x + sway, cy: this.y + sway * .6, size, aspect, left: this.left, tilt: (this.left ? .12 : -.12) + sway * 2 });
  }
}

// Flat, rounded hand drawing from screen-space points.
export function drawHand(g, pts, color, shade, scale) {
  const w = scale * .2;
  g.save();
  g.lineCap = g.lineJoin = 'round';
  const stroke = (idx, width, col) => { g.strokeStyle = col; g.lineWidth = width; g.beginPath(); idx.forEach((i, n) => n ? g.lineTo(...pts[i]) : g.moveTo(...pts[i])); g.stroke(); };
  const palm = [0, 1, 2, 5, 9, 13, 17, 0];
  g.fillStyle = color; g.strokeStyle = color; g.lineWidth = w * 1.3;
  g.beginPath(); palm.forEach((i, n) => n ? g.lineTo(...pts[i]) : g.moveTo(...pts[i])); g.fill(); g.stroke();
  const fingers = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  // Folded fingers lie over the palm, so draw them last, with an edge to read against it.
  const folded = f => Math.hypot(pts[f[3]][0] - pts[0][0], pts[f[3]][1] - pts[0][1]) < Math.hypot(pts[f[1]][0] - pts[0][0], pts[f[1]][1] - pts[0][1]) * 1.1;
  const order = [...fingers].sort((a, b) => folded(a) - folded(b));
  for (const f of order) {
    const wf = f[0] === 1 ? w * 1.1 : f[0] === 17 ? w * .85 : w;
    stroke(f, wf + Math.max(1.5, scale * .014) * 2, shade);
    stroke(f, wf, color);
  }
  g.restore();
}

// The page's background is one long sound wave (ported from Aloud's landing).
// Each section is a phrase; scrolling slides the wave past a playhead at the
// centre of the screen, and what has been played turns brass. Here the wave
// also listens: whatever you play makes it swell.

function noise(i, salt) { const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); }

const SHAPES = {
  burst: (t, n) => .5 + .4 * n + (t > .3 && t < .62 ? .2 : 0),
  pulse: (t, n) => (.28 + .72 * Math.pow(.5 + .5 * Math.sin(t * Math.PI * 7), 2)) * (.72 + .28 * n),
  steady: (_t, n) => .46 + .26 * n,
  calm: (_t, n) => .16 + .18 * n,
  rise: (t, n) => (.14 + .86 * t) * (.64 + .36 * n),
};

export function waveBackdrop(node, sections, level = () => 0) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = node.appendChild(document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  let viewW = 0, viewH = 0, pitch = 0, barWidth = 0, bars = [], centres = [], ends = [];
  let shownX = null, energy = 0, sound = 0, lastScrollY = scrollY, lastTime = performance.now(), frame = null, colours = null;

  function build() {
    viewW = innerWidth; viewH = innerHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pitch = Math.max(10, viewW / (viewW < 700 ? 36 : 70));
    barWidth = pitch * .46;
    const perPhrase = Math.round(viewW * .94 / pitch), silence = Math.max(3, Math.round(viewW * .16 / pitch));
    bars = []; centres = []; ends = [];
    let index = 0;
    sections.forEach((s, p) => {
      const shape = SHAPES[s.shape] || SHAPES.steady, start = index * pitch;
      for (let i = 0; i < perPhrase; i++) {
        const t = i / (perPhrase - 1), taper = Math.pow(Math.sin(Math.PI * (t * .94 + .03)), .6);
        bars.push({ x: index * pitch, loud: Math.min(1, shape(t, noise(index, p + 1)) * taper), seed: noise(index, 9) });
        index++;
      }
      const end = (index - 1) * pitch;
      ends.push([start, end]); centres.push((start + end) / 2);
      index += silence;
    });
    const st = getComputedStyle(node);
    colours = { ahead: st.color, played: st.getPropertyValue('--wave-played').trim(), aheadAlpha: +st.getPropertyValue('--wave-ahead-alpha') || .08, playedAlpha: +st.getPropertyValue('--wave-played-alpha') || .2 };
  }

  function measure() {
    const max = Math.max(0, document.documentElement.scrollHeight - viewH), y = scrollY;
    const raw = sections.map((s, i) => i ? Math.max(0, document.getElementById(s.id).getBoundingClientRect().top + y) : 0);
    let reach = 0; raw.forEach((p, i) => { if (p < max) reach = i; });
    const spare = raw.length - 1 - reach;
    const pts = raw.map((p, i) => i <= reach ? p : raw[reach] + (max - raw[reach]) * (i - reach) / spare);
    const last = pts.length - 1;
    let x;
    if (y >= pts[last]) { const tail = max - pts[last]; x = centres[last] + (tail > 0 ? Math.min(1, (y - pts[last]) / tail) : 0) * (ends[last][1] - centres[last]); }
    else {
      let i = 0; while (i < last - 1 && y >= pts[i + 1]) i++;
      const span = pts[i + 1] - pts[i];
      x = centres[i] + (span > 0 ? Math.max(0, Math.min(1, (y - pts[i]) / span)) : 0) * (centres[i + 1] - centres[i]);
    }
    let near = 0; centres.forEach((c, i) => { if (Math.abs(c - x) < Math.abs(centres[near] - x)) near = i; });
    return { x, near };
  }

  function draw(now) {
    ctx.clearRect(0, 0, viewW, viewH);
    const mid = viewW / 2, midY = viewH / 2, amp = viewH * .36 * (1 + energy * .22), off = mid - shownX;
    const path = (from, to) => {
      ctx.beginPath();
      for (const b of bars) {
        const x = b.x + off;
        if (x < from - barWidth) continue;
        if (x > to + barWidth) break;
        // Sound lifts the bars nearest the playhead most, each on its own beat.
        const near = Math.max(0, 1 - Math.abs(x - mid) / (viewW * .45));
        const lift = sound * near * (.35 + .65 * Math.abs(Math.sin(now / 160 + b.seed * 9)));
        const half = Math.max(barWidth / 2, Math.min(1.25, b.loud + lift * .6) * amp);
        ctx.moveTo(x, midY - half); ctx.lineTo(x, midY + half);
      }
    };
    ctx.lineCap = 'round'; ctx.lineWidth = barWidth;
    ctx.globalAlpha = colours.aheadAlpha; ctx.fillStyle = colours.ahead; ctx.fillRect(0, midY - .5, viewW, 1);
    ctx.save(); ctx.beginPath(); ctx.rect(mid, 0, viewW - mid, viewH); ctx.clip();
    ctx.globalAlpha = colours.aheadAlpha * (1 + sound * 1.5); ctx.strokeStyle = colours.ahead; path(mid, viewW); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mid, viewH); ctx.clip();
    ctx.globalAlpha = colours.playedAlpha * (1 + sound); ctx.strokeStyle = colours.played; path(0, mid); ctx.stroke(); ctx.restore();
    ctx.globalAlpha = 1;
  }

  function update(force) {
    frame = null;
    if (!bars.length) return;
    const now = performance.now(), m = measure();
    node.dataset.phrase = m.near;
    const speed = Math.abs(scrollY - lastScrollY) / Math.max(1, now - lastTime);
    if (reduced) { shownX = centres[m.near]; sound = 0; }
    else {
      energy += (Math.min(1, speed / 2.5) - energy) * (speed > energy ? .35 : .08);
      const lv = Math.min(1, level() * 4);
      sound += (lv - sound) * (lv > sound ? .3 : .06);
      shownX = shownX == null || force ? m.x : shownX + (m.x - shownX) * .16;
    }
    lastScrollY = scrollY; lastTime = now;
    draw(now);
    if (!reduced && (Math.abs(m.x - shownX) > .5 || energy > .01 || sound > .005 || level() > 0)) schedule();
  }
  const schedule = () => { if (frame == null) frame = requestAnimationFrame(() => update()); };

  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => { build(); update(true); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { build(); update(true); });
  build(); update(true);
  document.fonts?.ready?.then(() => update(true));
  return { wake: schedule };
}

// The motion-graphic tutorial: four short chapters drawn live on a canvas.
// Each chapter is a list of timed events; hands ease toward whatever the latest
// event says, so every movement is continuous however the timeline is scrubbed.
import { Puppet, drawHand } from './hands.js';

const SIGN = { 1: '01000', 2: '01100', 3: '01110', 4: '01111', 5: '11111', 6: '10000', 7: '00001', 8: '01001', fist: '00000' };
const NAME = { 1: 'Point', 2: 'Peace', 3: 'Three', 4: 'Four', 5: 'Open palm', 6: 'Thumbs up', 7: 'Pinky', 8: 'Rock' };

function chapters(song) {
  const melody = [], beat = .5;
  song.forEach(([b, zone, deg, len]) => melody.push([.6 + b * beat, zone, deg, len * beat]));
  return [
    { title: 'Raise a hand', text: 'The camera is split down the middle. Each half is its own instrument.', dur: 5.4, ev: [
      [0, 'R', { sign: SIGN[5], x: .74, y: 1.5 }], [0, 'L', { sign: SIGN[5], x: .26, y: 1.5 }], [0, 'divider', 1],
      [.25, 'R', { y: .5 }], [1.1, 'tag', { zone: 'R', text: 'Right half plays the lead' }],
      [2.1, 'L', { y: .5 }], [2.9, 'tag', { zone: 'L', text: 'Left half plays chords' }],
    ] },
    { title: 'Make a sign', text: 'Each hand sign plays one note of the scale, so nothing you play is out of key.', dur: 6.2, ev: [
      [0, 'L', { y: 1.5 }], [0, 'R', { sign: SIGN.fist, x: .6, y: .52 }], [0, 'divider', 0],
      ...[1, 2, 3, 4, 5].flatMap((d, i) => [[.35 + i * 1.05, 'R', { sign: SIGN[d] }], [.5 + i * 1.05, 'note', { zone: 'R', deg: d, len: .8, sign: NAME[d] }]]),
    ] },
    { title: 'Make a fist to stop', text: 'Hold a sign to hold the note. Close your hand and it goes quiet.', dur: 4.6, ev: [
      [0, 'L', { y: 1.5 }], [0, 'R', { sign: SIGN[5], x: .6, y: .52 }], [0, 'divider', 0],
      [.3, 'note', { zone: 'R', deg: 5, len: 1.4, sign: NAME[5] }],
      [1.8, 'R', { sign: SIGN.fist }], [1.9, 'rest', {}],
      [3.2, 'R', { sign: SIGN[8] }], [3.35, 'note', { zone: 'R', deg: 8, len: 1, sign: NAME[8] }],
    ] },
    { title: 'Play with both hands', text: 'Chords on the left, a melody on the right. That is a song.', dur: 9, ev: [
      [0, 'L', { sign: SIGN[1], x: .26, y: 1.5 }], [0, 'R', { sign: SIGN[5], x: .74, y: 1.5 }], [0, 'divider', 1],
      [.1, 'L', { y: .5 }], [.1, 'R', { y: .5 }],
      ...melody.flatMap(([t, z, d, len]) => [[t - .16, z, { sign: SIGN[d] }], [t, 'note', { zone: z, deg: d, len, sign: NAME[d] }]]),
    ] },
  ];
}

export function tutorial(root, { colors, label, play, song }) {
  const CH = chapters(song);
  const cv = root.querySelector('canvas'), g = cv.getContext('2d');
  const caption = root.querySelector('[data-caption]'), steps = [...root.querySelectorAll('[data-chapter]')];
  const playBtn = root.querySelector('[data-play]'), soundBtn = root.querySelector('[data-sound]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, ch = 0, t = 0, playing = false, visible = false, sound = false, last = 0, applied = 0;
  let hands, divider, tags, notes, bars = new Array(28).fill(0);

  new ResizeObserver(() => { dpr = Math.min(2, devicePixelRatio || 1); W = cv.width = cv.clientWidth * dpr; H = cv.height = cv.clientHeight * dpr; }).observe(cv);

  function enter(i) {
    ch = (i + CH.length) % CH.length; t = 0; applied = 0;
    hands = { L: new Puppet(true), R: new Puppet(false) }; divider = 0; tags = []; notes = [];
    apply(0); hands.L.snap(); hands.R.snap();
    steps.forEach((s, k) => { s.classList.toggle('done', k < ch); s.setAttribute('aria-current', k === ch ? 'step' : 'false'); s.style.setProperty('--p', k < ch ? 1 : 0); });
    caption.classList.remove('in'); void caption.offsetWidth;
    caption.querySelector('h3').textContent = CH[ch].title; caption.querySelector('p').textContent = CH[ch].text;
    caption.classList.add('in');
  }

  function apply(until) {
    const ev = CH[ch].ev;
    while (applied < ev.length && ev[applied][0] <= until) {
      const [, kind, v] = ev[applied++];
      if (kind === 'L' || kind === 'R') { const p = hands[kind]; if (v.sign) p.sign(v.sign); p.move(v.x ?? p.tx, v.y ?? p.ty); }
      else if (kind === 'divider') divider = v;
      else if (kind === 'tag') tags.push({ ...v, at: t });
      else if (kind === 'rest') notes.push({ zone: 'R', text: 'Rest', sub: 'Fist', at: t });
      else if (kind === 'note') {
        notes.push({ zone: v.zone, text: label(v.zone, v.deg), sub: v.sign, at: t });
        bars = bars.map((b, k) => Math.max(b, .35 + .65 * Math.abs(Math.sin(k * 1.7 + v.deg))));
        if (sound && playing) play(v.zone, v.deg, v.len);
      }
    }
  }

  const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  function render(now) {
    requestAnimationFrame(render);
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
    if (!W || !visible) return;
    if (playing) {
      t += dt;
      if (t >= CH[ch].dur) enter(ch + 1);
      apply(t);
      steps[ch].style.setProperty('--p', Math.min(1, t / CH[ch].dur));
    }
    hands.L.step(dt); hands.R.step(dt);
    bars = bars.map(b => b * Math.exp(-dt * 3));

    // Chapters fade through the room colour at both ends, so cuts never jump.
    const fade = Math.min(ease(t / .35), ease((CH[ch].dur - t) / .35));
    g.clearRect(0, 0, W, H);
    g.save(); g.globalAlpha = reduced ? 1 : fade;

    const u = H / 100;
    if (divider) {
      g.save(); g.globalAlpha *= .5; g.setLineDash([u * 1.2, u * 1.6]); g.strokeStyle = colors.line; g.lineWidth = u * .25;
      g.beginPath(); g.moveTo(W / 2, u * 6); g.lineTo(W / 2, H - u * 6); g.stroke(); g.restore();
    }
    // a small wave along the floor that answers each note
    const bw = W / bars.length;
    g.save(); g.lineCap = 'round'; g.lineWidth = bw * .42; g.strokeStyle = colors.line;
    bars.forEach((b, k) => { const x = bw * (k + .5), hh = u * (1 + b * 7); g.beginPath(); g.moveTo(x, H - u * 9 - hh); g.lineTo(x, H - u * 9 + hh); g.stroke(); });
    g.restore();

    for (const z of ['L', 'R']) {
      const p = hands[z], size = Math.min(.26, .3 * (W / H) / 1.6), pts = p.landmarks(W / H, size, now / 1000).map(q => [(1 - q.x) * W, q.y * H]);
      drawHand(g, pts, colors[z], colors.room, H * size);
    }
    for (const tg of tags) {
      const a = ease((t - tg.at) / .45);
      g.save(); g.globalAlpha *= a; g.font = `600 ${u * 3.4}px Figtree, sans-serif`; g.textAlign = 'center'; g.fillStyle = colors[tg.zone];
      g.fillText(tg.text, W * (tg.zone === 'L' ? .25 : .75), H * .8 + (1 - a) * u * 3); g.restore();
    }
    // Note labels rise in; the one before slides up and away.
    const shown = notes.slice(-2);
    shown.forEach((n, k) => {
      const isNew = k === shown.length - 1, a = isNew ? ease((t - n.at) / .3) : 1 - ease((t - shown[k + 1].at) / .3);
      if (a <= 0) return;
      const x = n.zone === 'L' ? W * .25 : (divider ? W * .75 : W * .28), y = H * .42 + (isNew ? (1 - a) * u * 5 : -(1 - a) * u * 5);
      g.save(); g.globalAlpha *= a; g.textAlign = 'center'; g.fillStyle = colors.text;
      g.font = `500 ${u * (divider ? 11 : 16)}px Newsreader, serif`; g.fillText(n.text, x, y);
      g.font = `600 ${u * 3}px Figtree, sans-serif`; g.fillStyle = colors[n.zone]; g.fillText(n.sub, x, y + u * 6);
      g.restore();
    });
    g.restore();
  }

  function setPlaying(on) {
    playing = on; playBtn.setAttribute('aria-label', on ? 'Pause the tutorial' : 'Play the tutorial');
    playBtn.dataset.on = on;
  }
  playBtn.onclick = () => setPlaying(!playing);
  soundBtn.onclick = () => { sound = !sound; soundBtn.setAttribute('aria-pressed', sound); if (sound) setPlaying(true); };
  steps.forEach((s, k) => s.onclick = () => { enter(k); setPlaying(true); });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (!reduced) setPlaying(visible); }, { threshold: .35 }).observe(cv);

  enter(0); requestAnimationFrame(render);
  return { setSound: on => { sound = on; soundBtn.setAttribute('aria-pressed', on); } };
}

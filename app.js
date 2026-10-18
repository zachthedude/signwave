import { Engine, PRESETS, PRESET_MAP, PATTERNS, SCALES, NOTE, nname } from './engine.js';
import { Puppet, drawHand, pose, toLandmarks, curlsOf } from './hands.js';
import { waveBackdrop } from './wave.js';
import { tutorial } from './tutorial.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (a, n) => ((a % n) + n) % n;

/* ================= hand signs ================= */
// mask = thumb,index,middle,ring,pinky (1 = finger up)
const SIGNS = [
  { m: '00000', n: 'Fist', d: 0 },
  { m: '01000', n: 'Point', d: 1 },
  { m: '01100', n: 'Peace', d: 2 },
  { m: '01110', n: 'Three', d: 3 },
  { m: '01111', n: 'Four', d: 4 },
  { m: '11111', n: 'Open palm', d: 5 },
  { m: '10000', n: 'Thumbs up', d: 6 },
  { m: '00001', n: 'Pinky', d: 7 },
  { m: '01001', n: 'Rock', d: 8 },
  { m: '10001', n: 'Call me', d: 9 },
  { m: '11000', n: 'L-shape', d: 10 },
];
const SIGN_BY_MASK = Object.fromEntries(SIGNS.map(s => [s.m, s]));
SIGN_BY_MASK['11100'] = SIGNS[3];   // three counted with the thumb
SIGN_BY_MASK['11110'] = SIGNS[4];
SIGN_BY_MASK['11001'] = SIGNS[8];   // "I love you" reads as rock
const MASK_OF = Object.fromEntries(SIGNS.map(s => [s.d, s.m]));
const HAND_LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

// The bot's song and the tutorial's last chapter: [beat, hand, sign degree, beats held]
const SONG = [
  [0, 'L', 1, 4], [4, 'L', 6, 4], [8, 'L', 3, 4], [12, 'L', 7, 4],
  [0, 'R', 5, 1], [1, 'R', 8, 1], [2, 'R', 7, 1], [3, 'R', 5, 1],
  [4, 'R', 6, 1.5], [5.5, 'R', 5, .5], [6, 'R', 3, 2],
  [8, 'R', 2, 1], [9, 'R', 5, 1], [10, 'R', 8, 2],
  [12, 'R', 7, 1], [13, 'R', 5, 1], [14, 'R', 2, 2],
];

/* ================= state ================= */
const S = { key: 9, scale: 'Minor', mode: 'signs', stab: 3, camOp: .55, quant: true, clipFmt: 'video', source: 'idle' };
const T = { running: false, bpm: 96, step: 0, nextTime: 0, pattern: 'Synthwave' };
const L = { bars: 2, layers: [], state: 'idle', origin: null, armAt: 0, recStart: 0, recEnd: 0, recEndStep: 0, recLayer: null, get beats() { return this.bars * 4; } };

function mkZone(i, preset, role) {
  return {
    i, preset, role, oct: PRESET_MAP[preset].oct, arp: 0, vol: .85, name: i ? 'Right' : 'Left',
    src: { gesture: [], keys: [] }, keyDegs: new Set(), voices: new Map(), held: [], arpIdx: 0,
    bright: .6, brightT: .6, lastBright: .6, glow: 0,
    hand: null, lost: 99, cand: null, candN: 0, stable: null, sign: null, pinch: [false, false, false, false], upper: false, degs: [],
  };
}
const zones = [mkZone(0, 'pad', 'chord'), mkZone(1, 'lead', 'note')];
const C = {};   // colours, read from CSS so the canvas follows the theme
function readColours() {
  const st = getComputedStyle(document.documentElement), v = n => st.getPropertyValue(n).trim();
  Object.assign(C, { L: v('--brass'), R: v('--mint'), night: v('--night'), line: v('--night-line'), text: v('--night-text'), soft: v('--night-soft'), faint: v('--night-faint'), ink: v('--ink'), card: v('--chalk-raised') });
}
readColours();
const zc = z => z.i ? C.R : C.L;

let E = null, recDest = null;
const cam = { ready: false, lm: null, lastT: -1, video: $('#vid'), aspect: 16 / 9 };

/* ================= music helpers ================= */
function deg2midi(z, d) {
  const sc = SCALES[S.scale], n = sc.length, i = d - 1;
  return 12 * (z.oct + 1) + S.key + sc[mod(i, n)] + 12 * Math.floor(i / n);
}
function notesFor(z, d) {
  if (d <= 0) return [];
  if (z.role === 'chord') {
    const r = deg2midi(z, d);
    if (PRESET_MAP[z.preset].power) return [r, r + 7, r + 12];
    return [d, d + 2, d + 4].map(x => deg2midi(z, x));
  }
  return [deg2midi(z, d)];
}
function chordName(ms) {
  if (ms.length < 3) return ms.map(nname).join(' ');
  const r = ms[0], a = ms[1] - r, b = ms[2] - r, root = NOTE[mod(r, 12)];
  if (a === 7 && b === 12) return root + '5';
  const q = { '4,7': '', '3,7': 'm', '3,6': 'dim', '4,8': 'aug', '2,7': 'sus2', '5,7': 'sus4' }[a + ',' + b];
  return q === undefined ? ms.map(nname).join(' ') : root + q;
}
const labelFor = (z, d) => z.role === 'chord' ? chordName(notesFor(z, d)) : nname(deg2midi(z, d));
const shortLabel = ms => !ms.length ? '' : ms.length >= 3 ? chordName(ms) : ms.map(nname).join(' ');
const stepDur = () => 60 / T.bpm / 4;
const beatDur = () => 60 / T.bpm;
const curStepF = () => T.step - (T.nextTime - E.ctx.currentTime) / stepDur();
const beatAt = t => (T.step - (T.nextTime - t) / stepDur()) / 4;

/* ================= voices ================= */
function setGesture(z, notes, retrig) { z.src.gesture = notes; refresh(z, retrig); }
function setKeys(z, retrig) { z.src.keys = [...z.keyDegs].flatMap(d => notesFor(z, d)); refresh(z, retrig); }

function refresh(z, retrig = false) {
  if (!E) return;
  const want = [...new Set([...z.src.gesture, ...z.src.keys])].sort((a, b) => a - b);
  if (z.arp) {
    for (const m of [...z.voices.keys()]) endVoice(z, m);
    if (!want.length || !z.held.length) z.arpIdx = 0;
    z.held = want;
    if (want.length && !T.running) startT();
    return;
  }
  z.held = [];
  if (retrig && PRESET_MAP[z.preset].perc) for (const m of [...z.voices.keys()]) endVoice(z, m);
  for (const m of [...z.voices.keys()]) if (!want.includes(m)) endVoice(z, m);
  for (const m of want) if (!z.voices.has(m)) startVoice(z, m);
}
function startVoice(z, m) {
  const t = E.ctx.currentTime;
  z.voices.set(m, { v: E.play(z.preset, m, t, z.vol, z.bright), t, preset: z.preset, bright: z.bright, vol: z.vol });
  midiSend(z.i, true, m, z.vol);
  ripple(z);
}
function endVoice(z, m) {
  const r = z.voices.get(m); if (!r) return;
  const t = E.ctx.currentTime;
  r.v.stop(t); z.voices.delete(m);
  midiSend(z.i, false, m);
  loopRecord(z.i, r.preset, m, r.vol, r.bright, r.t, t);
}
function resetZone(z) {
  z.hand = null; z.lost = 99; z.stable = z.cand = z.sign = null; z.pinch = [false, false, false, false]; z.degs = [];
  z.keyDegs.clear(); z.src.keys = []; setGesture(z, [], false);
}
function regen(z) {   // key/scale/role/octave changed while something is held
  if (S.mode === 'signs' && z.sign) z.src.gesture = notesFor(z, z.sign.d);
  if (S.mode === 'pinch') z.src.gesture = [...new Set(z.degs.flatMap(d => notesFor(z, d)))];
  z.src.keys = [...z.keyDegs].flatMap(d => notesFor(z, d));
  if (E) for (const m of [...z.voices.keys()]) endVoice(z, m);
  refresh(z);
}

/* ================= transport, arp, looper ================= */
function startT() {
  if (T.running || !E) return;
  let s = Math.ceil(T.step / 16) * 16;
  if (L.origin != null) while (mod(s / 4 - L.origin, L.beats) !== 0) s += 16;
  T.step = s; T.nextTime = E.ctx.currentTime + .06; T.running = true;
  uiTransport();
}
function stopT() {
  T.running = false;
  if (L.state === 'armed') { L.layers.pop(); L.state = L.layers.length ? 'play' : 'idle'; if (!L.layers.length) L.origin = null; }
  if (L.state === 'rec') L.state = 'play';
  uiTransport();
}
setInterval(() => {
  if (!T.running || !E) return;
  const ahead = E.ctx.currentTime + .12;
  while (T.nextTime < ahead) { scheduleStep(T.step, T.nextTime); T.nextTime += stepDur(); T.step++; }
}, 20);

function scheduleStep(s, t) {
  const sd = stepDur(), b = s / 4, i16 = mod(s, 16);
  const pat = PATTERNS[T.pattern] || {};
  const swing = (s % 2) ? (pat.swing || 0) * sd * 2 : 0;

  if (L.state === 'rec' && s >= L.recEndStep) L.state = 'play';
  if (L.state === 'armed' && s === L.armAt) {
    if (L.origin == null) L.origin = b;
    L.recStart = b; L.recEnd = b + L.beats; L.recEndStep = s + L.beats * 4;
    L.recLayer = L.layers[L.layers.length - 1]; L.state = 'rec';
  }
  const clicking = L.state === 'armed' || (L.state === 'rec' && T.pattern === 'Off');
  if (clicking && s % 4 === 0) E.drum(i16 === 0 ? 'clickHi' : 'click', t, .9);

  for (const [name, line] of Object.entries(pat)) if (typeof line === 'string' && line[i16] === 'x') E.drum(name, t + swing, s % 4 === 0 ? 1 : .8);

  for (const z of zones) {
    if (!z.arp || !z.held.length) continue;
    const every = z.arp === 8 ? 2 : 1;
    if (s % every) continue;
    const h = z.held, seq = h.length === 1 ? [h[0], h[0] + 12] : h.length > 2 ? [...h, ...h.slice(1, -1).reverse()] : h;
    const m = seq[z.arpIdx++ % seq.length], st = t + swing, dur = sd * every * .62;
    playScheduled(z.i, z.preset, m, st, dur, z.vol, z.bright);
    loopRecord(z.i, z.preset, m, z.vol, z.bright, st, st + dur);
    z.glow = 1;
  }

  if (L.origin != null && L.layers.length) {
    const lp = mod(b - L.origin, L.beats);
    for (const layer of L.layers) for (const n of layer) {
      if (b < n.activeFrom - 1e-6) continue;
      const off = n.pos - lp;
      if (off >= -1e-6 && off < .25 - 1e-6) playScheduled(n.zone, n.preset, n.m, t + off * 4 * sd, n.dur * beatDur(), n.vel, n.bright);
    }
  }
}

function playScheduled(zi, preset, m, st, dur, vel, bright) {
  E.play(preset, m, st, vel, bright).stop(st + dur);
  midiSend(zi, true, m, vel, st); midiSend(zi, false, m, 0, st + dur);
  wave.wake();
}

function loopRecord(zone, preset, m, vel, bright, t0, t1) {
  if (!L.recLayer || !T.running) return;
  let b0 = beatAt(t0);
  if (b0 < L.recStart - .2 || b0 >= L.recEnd) return;
  b0 = Math.max(b0, L.recStart);   // a slightly early first note belongs on the downbeat
  let pos = mod(b0 - L.origin, L.beats);
  if (S.quant) pos = mod(Math.round(pos * 4) / 4, L.beats);
  const pass = Math.floor((b0 - L.origin + .2) / L.beats);
  L.recLayer.push({ zone, preset, m, vel, bright, pos, dur: clamp((t1 - t0) / beatDur(), .1, L.beats), activeFrom: L.origin + (pass + 1) * L.beats });
}

function loopPress() {
  initAudio();
  if (L.state === 'armed') { L.layers.pop(); L.state = L.layers.length ? 'play' : 'idle'; if (!L.layers.length) L.origin = null; return uiLoop(); }
  if (L.state === 'rec') return;
  const wasRunning = T.running;
  startT();
  L.layers.push([]); L.recLayer = null;
  let s;
  if (L.origin == null) {
    s = Math.ceil(T.step / 16) * 16;
    if (!wasRunning || s - T.step < 12) s += 16;    // always most of a bar of count-in
  } else {
    s = Math.ceil(T.step / 4) * 4;
    while (mod(s / 4 - L.origin, L.beats) !== 0 || s - T.step < 4) s += 4;
  }
  L.armAt = s; L.state = 'armed'; uiLoop();
}
function loopUndo() {
  if (!L.layers.length) return;
  L.layers.pop(); L.recLayer = null;
  L.state = L.layers.length ? 'play' : 'idle';
  if (!L.layers.length) L.origin = null;
  uiLoop(); toast('Removed the last layer');
}
function loopClear() { L.layers = []; L.state = 'idle'; L.origin = null; L.recLayer = null; uiLoop(); toast('Loop cleared'); }

/* ================= MIDI ================= */
let midiAcc = null, midiPort = null;
function midiSend(ch, on, m, vel = .8, t) {
  if (!midiPort || m < 0 || m > 127) return;
  const ts = t != null ? performance.now() + Math.max(0, t - E.ctx.currentTime) * 1000 : undefined;
  try { midiPort.send(on ? [0x90 | ch, m, Math.max(1, Math.round(vel * 127))] : [0x80 | ch, m, 0], ts); } catch (e) { /* port closed */ }
}
async function initMidi() {
  if (midiAcc || !navigator.requestMIDIAccess) return;
  try {
    midiAcc = await navigator.requestMIDIAccess();
    const fill = () => {
      const sel = $('#midiOut'), cur = sel.value;
      sel.innerHTML = '<option value="">Off</option>' + [...midiAcc.outputs.values()].map(o => `<option value="${o.id}">${o.name}</option>`).join('');
      sel.value = cur;
    };
    fill(); midiAcc.onstatechange = fill;
  } catch (e) { /* MIDI blocked: the select stays at Off */ }
}

/* ================= camera ================= */
async function startCamera() {
  const status = $('#camStatus');
  status.classList.remove('trouble');
  status.textContent = 'Asking for your camera…';
  try {
    if (!cam.ready) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
      const v = cam.video; v.srcObject = stream; await v.play();
      status.textContent = 'Loading hand tracking…';
      const vision = await import('./vendor/vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(new URL('vendor/wasm', location.href).href);
      const opts = delegate => ({ baseOptions: { modelAssetPath: new URL('vendor/hand_landmarker.task', location.href).href, delegate }, runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .6, minHandPresenceConfidence: .6, minTrackingConfidence: .5 });
      try { cam.lm = await vision.HandLandmarker.createFromOptions(files, opts('GPU')); }
      catch (e) { cam.lm = await vision.HandLandmarker.createFromOptions(files, opts('CPU')); }
      cam.ready = true;
    }
    cam.aspect = cam.video.videoWidth / cam.video.videoHeight;
    setSource('camera');
    toast('Raise a hand. Point one finger to play your first note.');
  } catch (e) {
    console.error(e);
    status.classList.add('trouble');
    status.textContent = e.name === 'NotAllowedError'
      ? 'Camera access is blocked. Allow it from the camera icon in the address bar, then try again.'
      : e.name === 'NotFoundError' ? 'No camera found. Watch the bot, or play with your keyboard.' : 'The camera could not start: ' + (e.message || e.name);
    if (!$('#stageStart').hidden) return;
    $('#stageStart').hidden = false;
  }
}

function setSource(src) {
  if (S.source === 'bot' && src !== 'bot') stopT();
  S.source = src;
  zones.forEach(resetZone);
  $('#stage').dataset.source = src;
  $('#stageStart').hidden = src !== 'idle';
  $('#sourceBtn').textContent = src === 'camera' ? 'Watch the bot' : 'Use my camera';
  if (src === 'bot') {
    cam.aspect = W / H || 16 / 9;
    for (const p of [bot.L, bot.R]) { p.sign('11111').move(p.left ? .27 : .73, .54); p.y = 1.4; }
    if (T.pattern === 'Off') { T.pattern = 'Synthwave'; $('#beat').value = T.pattern; }
    startT();
  }
}

/* ================= reading hands ================= */
function analyze(lm) {
  const a = cam.aspect, P = lm.map(p => [p.x * a, p.y, p.z * a]);
  const d = (i, j) => Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1], P[i][2] - P[j][2]);
  const palm = d(0, 9) || 1e-3;
  const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => d(0, tip) > d(0, pip) * 1.1);
  const thumb = d(4, 9) > palm * .75 && d(4, 17) > d(3, 17);
  return {
    lm, palm,
    mask: (thumb ? '1' : '0') + fingers.map(f => f ? '1' : '0').join(''),
    pd: [8, 12, 16, 20].map(tip => d(4, tip) / palm),
    tw: [8, 12, 16, 20].map(tip => d(0, tip) / palm),   // curled fingertips sit < 1.0 palm from the wrist
    thw: d(0, 4) / palm,
    mx: 1 - lm[9].x, my: lm[9].y,
  };
}

function processHands(list) {
  const hs = list.map(analyze), assign = [null, null];
  if (hs.length >= 2) { hs.sort((a, b) => a.mx - b.mx); assign[0] = hs[0]; assign[1] = hs[1]; }
  else if (hs.length === 1) assign[hs[0].mx < .5 ? 0 : 1] = hs[0];
  zones.forEach((z, i) => {
    const h = assign[i];
    if (!h) {
      if (++z.lost === 6) { z.hand = null; z.stable = z.cand = z.sign = null; z.pinch = [false, false, false, false]; z.degs = []; setGesture(z, [], false); }
      return;
    }
    z.lost = 0; z.hand = h;
    S.mode === 'signs' ? signLogic(z, h) : pinchLogic(z, h);
  });
}

function signLogic(z, h) {
  z.brightT = clamp(1 - (h.my - .15) / .65, 0, 1);
  if (h.mask === z.cand) z.candN++; else { z.cand = h.mask; z.candN = 1; }
  if (z.candN >= S.stab && h.mask !== z.stable) {
    const sg = SIGN_BY_MASK[h.mask];
    if (!sg) return;               // unknown shapes keep the current note instead of flickering
    z.stable = h.mask; z.sign = sg;
    setGesture(z, notesFor(z, sg.d), true);
  }
}

function pinchLogic(z, h) {
  z.brightT = clamp((h.mx - (z.i ? .5 : 0)) / .5, 0, 1);
  let changed = false;
  const thumbOut = h.thw > 1.1;   // in a fist the thumb lies over the fingers, so nothing counts as a pinch
  h.pd.forEach((d, f) => {
    const now = z.pinch[f] ? d < .42 && h.tw[f] > .95 : d < .27 && h.tw[f] > 1.05 && thumbOut;
    if (now !== z.pinch[f]) { z.pinch[f] = now; changed = true; }
  });
  const upper = z.upper ? h.my < .53 : h.my < .47;
  if (upper !== z.upper) { z.upper = upper; changed = changed || z.pinch.some(Boolean); }
  if (!changed) return;
  z.degs = z.pinch.map((p, f) => p ? f + 1 + (z.upper ? 4 : 0) : 0).filter(Boolean);
  setGesture(z, [...new Set(z.degs.flatMap(d => notesFor(z, d)))], false);
}

/* ================= the bot ================= */
// Two drawn hands that play SONG. Their landmarks go through analyze() and
// signLogic() like a camera frame would, so the bot proves the real pipeline.
const bot = { L: new Puppet(true), R: new Puppet(false) };
for (const p of [bot.L, bot.R]) p.sign('11111').move(p.left ? .27 : .73, .54);
const LEAD = .3;
// Hand size in stage heights: smaller on tall (phone) stages so two hands still fit side by side.
const handSize = aspect => Math.min(.26, .3 * aspect / 1.6);   // beats early the hand starts moving, so the sign lands on the beat
function botFrame(dt, now) {
  const beat = T.running ? mod(curStepF() / 4 + LEAD, 16) : -1;
  for (const z of zones) {
    const p = z.i ? bot.R : bot.L, key = z.i ? 'R' : 'L';
    if (beat >= 0) {
      const mine = SONG.filter(e => e[1] === key);
      const cur = [...mine].reverse().find(e => e[0] <= beat) || mine[mine.length - 1];
      p.sign(MASK_OF[cur[2]]);
    }
    p.step(dt);
    if (S.source !== 'bot') continue;
    const h = analyze(p.landmarks(cam.aspect, handSize(cam.aspect), now / 1000));
    z.hand = h; z.lost = 0;
    if (p.settled && p.y < .7) (S.mode === 'signs' ? signLogic : pinchLogic)(z, h);
  }
}

/* ================= drawing ================= */
const cv = $('#cv'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, ripples = [], freq = null;
new ResizeObserver(() => {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = cv.width = Math.round(cv.clientWidth * DPR); H = cv.height = Math.round(cv.clientHeight * DPR);
  if (S.source !== 'camera') cam.aspect = W / H;
}).observe(cv);

function videoRect() {
  const h = Math.max(W / cam.aspect, H), w = h * cam.aspect;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
const toScreen = (p, r) => [r.x + (1 - p.x) * r.w, r.y + p.y * r.h];

function ripple(z) {
  z.glow = 1; wave.wake();
  let x = W * (z.i ? .75 : .25), y = H * .5;
  if (z.hand) [x, y] = toScreen(z.hand.lm[9], videoRect());
  ripples.push({ x, y, c: zc(z), t: performance.now() });
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - (frame.last || now)) / 1000); frame.last = now;
  if (!W) return;
  const v = cam.video;
  if (S.source === 'camera' && cam.ready && v.readyState >= 2 && v.currentTime !== cam.lastT) {
    cam.lastT = v.currentTime;
    try { processHands(cam.lm.detectForVideo(v, now).landmarks || []); } catch (e) { /* skip frame */ }
  }
  if (S.source !== 'camera') botFrame(dt, now);
  for (const z of zones) {
    z.bright += (z.brightT - z.bright) * .2;
    if (Math.abs(z.bright - z.lastBright) > .01) { z.lastBright = z.bright; for (const r of z.voices.values()) r.v.setBright(z.bright); }
    const active = z.voices.size || z.held.length ? .55 : 0;
    z.glow += (Math.max(active, z.glow * .9) - z.glow) * .15;
  }
  draw(now);
  uiFrame();
}

function draw(now) {
  const u = H / 100;
  g.fillStyle = C.night; g.fillRect(0, 0, W, H);

  // Each half warms with its hand's colour while that hand is playing.
  for (const z of zones) {
    if (z.glow < .01) continue;
    const gr = g.createRadialGradient(W * (z.i ? .75 : .25), H * .55, 0, W * (z.i ? .75 : .25), H * .55, W * .42);
    gr.addColorStop(0, zc(z) + Math.round(z.glow * 60).toString(16).padStart(2, '0')); gr.addColorStop(1, zc(z) + '00');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }

  const r = videoRect();
  if (S.source === 'camera' && cam.ready && cam.video.readyState >= 2 && S.camOp > 0) {
    g.save(); g.globalAlpha = S.camOp; g.filter = 'saturate(.55) brightness(.9)';
    g.translate(W, 0); g.scale(-1, 1); g.drawImage(cam.video, r.x, r.y, r.w, r.h); g.restore();
  }

  // The floor: the sound itself, as bars.
  if (E) {
    freq ||= new Uint8Array(E.analyser.frequencyBinCount);
    E.analyser.getByteFrequencyData(freq);
    const n = 48, bw = W / n;
    g.save(); g.lineCap = 'round'; g.lineWidth = bw * .42; g.strokeStyle = C.line;
    for (let k = 0; k < n; k++) {
      const val = freq[Math.floor(Math.pow(k / n, 1.6) * 300) + 2] / 255, hh = u * (.6 + val * 7);
      g.beginPath(); g.moveTo(bw * (k + .5), H - u * 7 - hh); g.lineTo(bw * (k + .5), H - u * 7 + hh); g.stroke();
    }
    g.restore();
  }

  g.save();
  g.setLineDash([u * 1.1, u * 1.5]); g.strokeStyle = C.line; g.lineWidth = Math.max(1, u * .2);
  g.beginPath(); g.moveTo(W / 2, u * 5); g.lineTo(W / 2, H - u * 5); g.stroke();
  g.restore();

  if (S.source !== 'idle') {
    g.save(); g.font = `600 ${Math.max(11 * DPR, u * 2.6)}px Figtree, sans-serif`; g.textBaseline = 'top';
    zones.forEach(z => {
      g.fillStyle = zc(z); g.textAlign = z.i ? 'right' : 'left';
      g.fillText(`${PRESET_MAP[z.preset].name} ${z.role === 'chord' ? 'chords' : 'notes'}${z.arp ? ', arpeggio' : ''}`, z.i ? W - u * 4 : u * 4, u * 4);
      if (S.source === 'camera' && !z.hand) {
        g.textAlign = 'center'; g.fillStyle = C.faint; g.font = `500 ${Math.max(13 * DPR, u * 3)}px Figtree, sans-serif`;
        g.fillText(`Show your ${z.name.toLowerCase()} hand here`, W * (z.i ? .75 : .25), H * .48);
        g.font = `600 ${Math.max(11 * DPR, u * 2.6)}px Figtree, sans-serif`;
      }
    });
    g.restore();
  }

  for (const z of zones) {
    if (S.source === 'camera') { if (z.hand) skeleton(z, r); continue; }
    const p = z.i ? bot.R : bot.L, size = handSize(cam.aspect), pts = p.landmarks(cam.aspect, size, now / 1000).map(q => toScreen(q, r));
    g.globalAlpha = S.source === 'idle' ? .35 : 1;   // behind the start buttons, the hands step back
    drawHand(g, pts, zc(z), C.night, r.h * size);
    g.globalAlpha = 1;
    if (S.source === 'bot') label(z, pts);
  }
  if (S.source === 'idle') for (const z of zones) if (z.voices.size || z.held.length) bigLabel(z, W * (z.i ? .75 : .25), H * .3, activeNotes(z));

  // Ripples: one ring per new note, spreading from the hand.
  ripples = ripples.filter(rp => now - rp.t < 700);
  for (const rp of ripples) {
    const k = (now - rp.t) / 700, e = 1 - Math.pow(1 - k, 3);
    g.save(); g.globalAlpha = (1 - k) * .8; g.strokeStyle = rp.c; g.lineWidth = u * .5 * (1 - k) + 1;
    g.beginPath(); g.arc(rp.x, rp.y, u * (4 + e * 18), 0, 7); g.stroke(); g.restore();
  }

  if (E && L.state === 'armed' && T.running) {
    const left = Math.ceil((L.armAt - curStepF()) / 4);
    if (left > 0 && left <= 4) {
      g.save(); g.font = `500 ${u * 30}px Newsreader, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = C.text; g.globalAlpha = .9; g.fillText(left, W / 2, H / 2); g.restore();
    }
  }
  if (L.state === 'rec') { g.fillStyle = '#e0796a'; g.beginPath(); g.arc(W / 2, u * 5.5, u * 1.1, 0, 7); g.fill(); }
}

function activeNotes(z) { return z.arp ? z.held : [...z.voices.keys()].sort((a, b) => a - b); }

function skeleton(z, r) {
  const pts = z.hand.lm.map(p => toScreen(p, r)), c = zc(z), u = H / 100;
  g.save(); g.strokeStyle = c; g.lineWidth = Math.max(2, u * .6); g.lineCap = 'round'; g.globalAlpha = z.lost ? .4 : 1;
  g.beginPath(); for (const [a, b] of HAND_LINKS) { g.moveTo(...pts[a]); g.lineTo(...pts[b]); } g.stroke();
  [4, 8, 12, 16, 20].forEach((tip, k) => {
    const up = z.hand.mask[k] === '1';
    g.fillStyle = up ? C.text : c; g.beginPath(); g.arc(...pts[tip], u * (up ? 1.1 : .7), 0, 7); g.fill();
  });
  if (S.mode === 'pinch') {
    g.font = `600 ${u * 2.4}px Figtree, sans-serif`; g.textAlign = 'center';
    [8, 12, 16, 20].forEach((tip, f) => {
      const [x, y] = pts[tip];
      if (z.pinch[f]) { g.lineWidth = 2; g.strokeStyle = C.text; g.beginPath(); g.arc(x, y, u * 2.4, 0, 7); g.stroke(); }
      g.fillStyle = z.pinch[f] ? C.text : C.soft; g.fillText(labelFor(z, f + 1 + (z.upper ? 4 : 0)), x, y - u * 3);
    });
  }
  g.restore();
  label(z, pts);
}

function label(z, pts) {
  let top = Infinity, cx = 0; for (const [x, y] of pts) { top = Math.min(top, y); cx += x / pts.length; }
  const ms = activeNotes(z);
  if (ms.length) bigLabel(z, cx, top - H * .04, ms);
  else if (S.mode === 'signs' && z.sign && z.sign.d === 0) bigLabel(z, cx, top - H * .04, [], 'Rest');
}

function bigLabel(z, x, y, ms, text) {
  const u = H / 100;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `500 ${u * 9}px Newsreader, serif`; g.fillStyle = C.text;
  g.fillText(text || shortLabel(ms), x, y);
  if (S.mode === 'signs' && z.sign && z.hand) {
    g.font = `600 ${u * 2.4}px Figtree, sans-serif`; g.fillStyle = zc(z);
    g.fillText(z.sign.n, x, y - u * 9.5);
  }
  g.restore();
}

/* ================= UI ================= */
function pressed(group, value) { $$('button', group).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === String(value))); }
function segment(el, cb) { el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; pressed(el, b.dataset.v); cb(b.dataset.v); }); }
function switcher(el, cb) { el.onclick = () => { const on = el.getAttribute('aria-pressed') !== 'true'; el.setAttribute('aria-pressed', on); cb(on); }; }

function buildZone(z) {
  const el = $(`.hand[data-z="${z.i}"]`);
  el.innerHTML = `
    <div class="panel-head"><span class="dot"></span><div><h3>${z.name} hand</h3><p data-sub></p></div><span class="now" data-now aria-live="polite"></span></div>
    <div class="field"><span>Instrument</span><div class="chips">${PRESETS.map(p => `<button class="chip" data-p="${p.id}">${p.name}</button>`).join('')}</div></div>
    <div class="row" style="justify-content:space-between">
      <div class="field"><span>Each sign plays</span><div class="seg" data-role><button data-v="note">A note</button><button data-v="chord">A chord</button></div></div>
      <div class="field"><span>Arpeggio</span><div class="seg" data-arp><button data-v="0">Off</button><button data-v="8">1/8</button><button data-v="16">1/16</button></div></div>
    </div>
    <div class="row-split"><div class="field"><span>Octave</span><div class="stepper"><button data-o="-1" aria-label="Octave down">−</button><output data-oct></output><button data-o="1" aria-label="Octave up">+</button></div></div>
      <label class="field"><span>Volume</span><input type="range" min="0" max="100" data-vol></label></div>`;
  el.querySelector('.chips').onclick = e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    z.preset = b.dataset.p; z.oct = PRESET_MAP[z.preset].oct; regen(z); syncZone(z); renderGuide();
    preview(z);
  };
  segment(el.querySelector('[data-role]'), v => { z.role = v; regen(z); syncZone(z); renderGuide(); });
  segment(el.querySelector('[data-arp]'), v => { z.arp = +v; regen(z); syncZone(z); });
  $$('[data-o]', el).forEach(b => b.onclick = () => { z.oct = clamp(z.oct + +b.dataset.o, 0, 7); regen(z); syncZone(z); renderGuide(); preview(z); });
  const vol = el.querySelector('[data-vol]'); vol.value = z.vol * 100; vol.oninput = () => z.vol = vol.value / 100;
  syncZone(z);
}
function syncZone(z) {
  const el = $(`.hand[data-z="${z.i}"]`);
  $$('.chip', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.p === z.preset));
  pressed(el.querySelector('[data-role]'), z.role);
  pressed(el.querySelector('[data-arp]'), z.arp);
  el.querySelector('[data-oct]').textContent = z.oct;
  el.querySelector('[data-sub]').textContent = `${PRESET_MAP[z.preset].name}, ${z.role === 'chord' ? 'chords' : 'notes'}`;
}
// A taste of an instrument the moment you pick it.
function preview(z) {
  initAudio();
  const t = E.ctx.currentTime, ms = notesFor(z, 1);
  ms.forEach(m => E.play(z.preset, m, t, z.vol, z.bright).stop(t + .5));
  ripple(z);
}

function renderGuide() {
  const el = $('#guide'), [Lz, Rz] = zones;
  const list = S.mode === 'signs' ? SIGNS : [1, 2, 3, 4, 5, 6, 7, 8].map(d => ({ d, n: `${d > 4 ? 'High' : 'Low'} ${['index', 'middle', 'ring', 'pinky'][(d - 1) % 4]} pinch`, m: '1' + [0, 1, 2, 3].map(k => k === (d - 1) % 4 ? '1' : '0').join(''), pinch: true }));
  el.innerHTML = list.map(s => `<button class="sign" data-d="${s.d}" aria-label="${s.n}${s.d ? ': ' + labelFor(Rz, s.d) : ', stop'}"><canvas></canvas><b>${s.n}</b>
    <small>${s.d ? `<span class="l">${labelFor(Lz, s.d)}</span><span class="r">${labelFor(Rz, s.d)}</span>` : '<span>stop</span>'}</small></button>`).join('');
  $$('.sign', el).forEach((b, k) => drawIcon(b.querySelector('canvas'), list[k]));
  guideState = '';
}
function drawIcon(c, s) {
  const px = 64 * Math.min(2, devicePixelRatio || 1); c.width = c.height = px;
  const x = c.getContext('2d');
  const curls = curlsOf(s.m);
  if (s.pinch) curls[0] = .35;
  const pts = toLandmarks(pose(curls), { cx: .5, cy: .55, size: .36, aspect: 1, left: false, tilt: -.1 }).map(q => [(1 - q.x) * px, q.y * px]);
  if (s.pinch) { const f = 8 + ((s.d - 1) % 4) * 4; pts[4] = [pts[f][0], pts[f][1] + px * .03]; pts[f] = [pts[f][0], pts[f][1] + px * .03]; }
  drawHand(x, pts, C.ink, C.card, px * .36);
}
$('#guide').addEventListener('click', e => {
  const b = e.target.closest('.sign'); if (!b) return;
  initAudio(); playSign(+b.dataset.d);
});
$('#guide').addEventListener('pointerover', e => {
  const b = e.target.closest('.sign');
  if (b && E && E.ctx.state === 'running' && !b.contains(e.relatedTarget)) playSign(+b.dataset.d);
});
function playSign(d) {
  const z = zones[1], t = E.ctx.currentTime;
  for (const m of notesFor(z, d)) E.play(z.preset, m, t, z.vol * .8, .6).stop(t + .45);
  if (d) ripple(z);
}

let guideState = '', lastNow = ['', ''];
const stepEls = [];
function uiFrame() {
  const act = zones.map(z => {
    const s = new Set();
    if (S.mode === 'signs' && z.sign && z.hand) s.add(z.sign.d);
    if (S.mode === 'pinch') z.degs.forEach(d => s.add(d));
    z.keyDegs.forEach(d => s.add(d));
    return s;
  });
  const key = act.map(s => [...s].join(',')).join('|');
  if (key !== guideState) {
    guideState = key;
    $$('#guide .sign').forEach(c => { const d = +c.dataset.d; c.classList.toggle('onL', act[0].has(d)); c.classList.toggle('onR', act[1].has(d)); });
  }
  zones.forEach(z => {
    const txt = shortLabel(activeNotes(z));
    if (txt !== lastNow[z.i]) { lastNow[z.i] = txt; $(`.hand[data-z="${z.i}"] [data-now]`).textContent = txt; }
  });
  if (E) {
    const cs = T.running ? mod(Math.floor(curStepF()), 16) : -1;
    stepEls.forEach((s, i) => s.classList.toggle('on', i === cs));
    if (L.origin != null && T.running) $('#lprog').style.width = (mod(curStepF() / 4 - L.origin, L.beats) / L.beats * 100) + '%';
    uiLoop();
  }
}

let loopUi = '';
function uiLoop() {
  const n = L.layers.length - (L.state === 'armed' || L.state === 'rec' ? 1 : 0);
  const k = L.state + n;
  if (k === loopUi) return; loopUi = k;
  const b = $('#loopBtn'); b.dataset.s = L.state;
  b.textContent = { idle: 'Record a loop', armed: 'Count-in…', rec: 'Recording', play: 'Add a layer' }[L.state];
  $('#layers').textContent = n ? `${n} layer${n === 1 ? '' : 's'} looping` : L.state === 'idle' ? 'Nothing recorded' : 'First layer';
  $('#loopBars').disabled = L.origin != null;
  if (L.origin == null) $('#lprog').style.width = '0';
}
function uiTransport() {
  $('#playIco').innerHTML = T.running ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M7 4v16l13-8z"/>';
  $('#playBtn').setAttribute('aria-label', T.running ? 'Stop the beat' : 'Start the beat');
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }

function rotator(el) {
  const words = $$('.rotator-stack > span', el);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let cur = 0;
  setInterval(() => {
    if (document.hidden) return;
    words[cur].dataset.state = 'above';
    cur = (cur + 1) % words.length;
    words[cur].dataset.state = 'below';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      words[cur].dataset.state = 'in';
      words.forEach((w, i) => { if (i !== cur && w.dataset.state === 'above') w.dataset.state = 'below'; });
    }));
  }, 2200);
}

function initUI() {
  zones.forEach(buildZone);
  $('#key').innerHTML = NOTE.map((n, i) => `<option value="${i}">${n}</option>`).join(''); $('#key').value = S.key;
  $('#scale').innerHTML = Object.keys(SCALES).map(s => `<option>${s}</option>`).join(''); $('#scale').value = S.scale;
  $('#beat').innerHTML = Object.keys(PATTERNS).map(s => `<option>${s}</option>`).join(''); $('#beat').value = T.pattern;
  const st = $('#steps'); for (let i = 0; i < 16; i++) stepEls.push(st.appendChild(document.createElement('i')));
  $('#key').onchange = e => { S.key = +e.target.value; zones.forEach(regen); renderGuide(); };
  $('#scale').onchange = e => { S.scale = e.target.value; zones.forEach(regen); renderGuide(); };
  $('#beat').onchange = e => { T.pattern = e.target.value; };
  segment($('#mode'), v => {
    S.mode = v;
    zones.forEach(z => { z.sign = z.stable = z.cand = null; z.pinch = [false, false, false, false]; z.degs = []; setGesture(z, [], false); });
    renderGuide(); toast(v === 'signs' ? 'Each hand sign plays a note' : 'Touch your thumb to a finger to play');
  });
  const bpm = $('#bpm');
  bpm.oninput = () => { T.bpm = +bpm.value; $('#bpmTxt').textContent = T.bpm + ' bpm'; E?.setTempo(T.bpm); };
  $('#playBtn').onclick = () => { initAudio(); T.running ? stopT() : startT(); };
  $('#loopBtn').onclick = loopPress;
  $('#undoBtn').onclick = loopUndo;
  $('#clearBtn').onclick = loopClear;
  $('#loopBars').onchange = e => { L.bars = +e.target.value; };
  $$('[data-camera]').forEach(b => b.onclick = () => { initAudio(); $('#play').scrollIntoView({ behavior: 'smooth' }); startCamera(); });
  $('#botBtn').onclick = () => { initAudio(); setSource('bot'); toast('The bot is playing. Change its instruments below.'); };
  $('#sourceBtn').onclick = () => { initAudio(); S.source === 'camera' ? setSource('bot') : startCamera(); };
  $('#clipBtn').onclick = toggleClip;
  $$('[data-open]').forEach(b => b.onclick = () => { $('#' + b.dataset.open).showModal(); initMidi(); });
  segment($('#stab'), v => S.stab = +v);
  $('#camOp').oninput = e => S.camOp = e.target.value / 100;
  switcher($('#quant'), on => S.quant = on);
  switcher($('#mic'), on => { initAudio(); setMic(on).catch(() => { $('#mic').setAttribute('aria-pressed', false); toast('The microphone could not start'); }); });
  switcher($('#monitor'), on => { mic.monitor = on; if (mic.mon) mic.mon.gain.value = on ? 1 : 0; });
  segment($('#clipFmt'), v => S.clipFmt = v);
  $('#midiOut').onchange = e => { midiPort = e.target.value ? midiAcc.outputs.get(e.target.value) : null; };
  rotator($('.rotator'));
  renderGuide();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColours(); renderGuide(); });
}

/* ================= keyboard ================= */
const KEYS_R = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
const KEYS_L = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];
function keyTarget(code) {
  let i = KEYS_R.indexOf(code); if (i >= 0) return [zones[1], i + 1];
  i = KEYS_L.indexOf(code); if (i >= 0) return [zones[0], i + 1];
  return null;
}
addEventListener('keydown', e => {
  if (e.target.matches?.('input,select,dialog *') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = keyTarget(e.code);
  if (k) { e.preventDefault(); if (e.repeat) return; initAudio(); k[0].keyDegs.add(k[1]); setKeys(k[0], true); return; }
  if (e.repeat || !E) return;
  if (e.code === 'Space' && !e.target.matches?.('button')) { e.preventDefault(); T.running ? stopT() : startT(); }
});
addEventListener('keyup', e => {
  const k = keyTarget(e.code);
  if (k && E) { k[0].keyDegs.delete(k[1]); setKeys(k[0], false); }
});
addEventListener('blur', () => { if (E) zones.forEach(z => { z.keyDegs.clear(); setKeys(z, false); }); });

/* ================= audio, mic, clips ================= */
const mic = { stream: null, bus: null, mon: null, monitor: false };
function initAudio() {
  if (E) { if (E.ctx.state === 'suspended') E.ctx.resume(); return; }
  E = new Engine(new AudioContext({ latencyHint: 'interactive' }));
  E.setTempo(T.bpm);
  recDest = E.ctx.createMediaStreamDestination();
  E.master.connect(recDest);
}
async function setMic(on) {
  if (!on) { mic.stream?.getTracks().forEach(t => t.stop()); mic.bus?.disconnect(); mic.stream = mic.bus = mic.mon = null; return; }
  mic.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = E.ctx.createMediaStreamSource(mic.stream);
  mic.bus = E.ctx.createGain(); src.connect(mic.bus); mic.bus.connect(recDest);
  mic.mon = E.ctx.createGain(); mic.mon.gain.value = mic.monitor ? 1 : 0; mic.bus.connect(mic.mon).connect(E.ctx.destination);
}

let rec = null, recStart = 0, recTimer = null;
function toggleClip() {
  initAudio();
  if (rec) { rec.stop(); return; }
  const video = S.clipFmt === 'video';
  const tracks = [...(video ? cv.captureStream(30).getVideoTracks() : []), ...recDest.stream.getAudioTracks()];
  const types = video ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'] : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : {});
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const type = rec.mimeType || mime, blob = new Blob(chunks, { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `signwave-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${type.includes('mp4') ? (video ? 'mp4' : 'm4a') : 'webm'}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    tracks.forEach(t => t.kind === 'video' && t.stop());
    rec = null; clearInterval(recTimer);
    $('#clipBtn').setAttribute('aria-pressed', false); $('#clipBtn').textContent = 'Record clip';
    toast('Clip saved to your downloads');
  };
  rec.start(250); recStart = Date.now();
  $('#clipBtn').setAttribute('aria-pressed', true);
  recTimer = setInterval(() => { const s = (Date.now() - recStart) / 1000 | 0; $('#clipBtn').textContent = `Stop  ${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`; }, 250);
}

/* ================= start ================= */
let level = new Float32Array(512);
const wave = waveBackdrop($('#wave'), [
  { id: 'play', shape: 'burst' }, { id: 'learn', shape: 'pulse' }, { id: 'private', shape: 'calm' }, { id: 'start', shape: 'rise' },
], () => {
  if (!E) return 0;
  E.analyser.getFloatTimeDomainData(level);
  let s = 0; for (let i = 0; i < level.length; i += 4) s += level[i] * level[i];
  return Math.sqrt(s / (level.length / 4));
});

initUI();
tutorial($('#tutorial'), {
  colors: { L: C.L, R: C.R, line: C.line, text: C.text, room: C.night },
  song: SONG,
  label: (zone, d) => labelFor(zones[zone === 'L' ? 0 : 1], d),
  play: (zone, d, len) => {
    initAudio();
    const z = zones[zone === 'L' ? 0 : 1], t = E.ctx.currentTime;
    for (const m of notesFor(z, d)) E.play(z.preset, m, t, z.vol, .6).stop(t + len);
    wave.wake();
  },
});
addEventListener('pointerdown', () => initAudio(), { once: true });
requestAnimationFrame(frame);
window.__signwave = { get E() { return E; }, zones, S, T, L, bot, cam, analyze, processHands, setSource, loopPress, curls: curlsOf, pose, toLandmarks, SIGN_BY_MASK };

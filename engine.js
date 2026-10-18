// Signwave sound engine: every instrument is synthesized live with Web Audio (no samples).

export const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const nname = m => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export const SCALES = {
  'Minor': [0, 2, 3, 5, 7, 8, 10],
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Blues': [0, 3, 5, 6, 7, 10],
};

// rev/dly = effect send levels, oct = default octave, perc = re-strike on every new sign
export const PRESETS = [
  { id: 'lead',  name: 'Lead',      group: 'Synth',  rev: .22, dly: .32, oct: 4 },
  { id: 'pad',   name: 'Pad',       group: 'Synth',  rev: .55, dly: .12, oct: 3 },
  { id: 'vox',   name: 'Choir',     group: 'Voice',  rev: .45, dly: .1,  oct: 4 },
  { id: 'keys',  name: 'E-Piano',   group: 'Keys',   rev: .25, dly: .1,  oct: 4, perc: true },
  { id: 'bells', name: 'Bells',     group: 'Keys',   rev: .45, dly: .3,  oct: 5, perc: true },
  { id: 'pluck', name: 'Guitar',    group: 'Guitar', rev: .3,  dly: .15, oct: 3, perc: true },
  { id: 'drive', name: 'Overdrive', group: 'Guitar', rev: .18, dly: .08, oct: 3, perc: true, power: true },
  { id: 'bass',  name: 'Bass',      group: 'Bass',   rev: .04, dly: 0,   oct: 2 },
  { id: 'sub',   name: '808',       group: 'Bass',   rev: 0,   dly: 0,   oct: 1, perc: true },
];
export const PRESET_MAP = Object.fromEntries(PRESETS.map(p => [p.id, p]));

export const PATTERNS = {
  'Off': {},
  'Synthwave': { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', ohat: '..............x.' },
  'Hip-Hop':   { kick: 'x.....x...x..x..', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  'Lo-Fi':     { kick: 'x......x..x.....', snare: '....x.......x...', hat: '..x...x...x...x.', swing: .14 },
  'Trap':      { kick: 'x......x..x.....', clap: '........x.......', hat: 'x.x.x.xxx.x.x.xx' },
  'House':     { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.' },
  'Rock':      { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
};

export class Engine {
  constructor(ctx) {
    const c = this.ctx = ctx;
    this.out = c.createGain(); this.out.gain.value = .9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .2;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = .001; lim.release.value = .08;
    this.out.connect(comp).connect(lim);
    this.master = lim;
    lim.connect(c.destination);
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048;
    lim.connect(this.analyser);

    this.revIn = c.createGain();
    const conv = c.createConvolver(); conv.buffer = this._ir(2.8);
    this.revIn.connect(conv).connect(this.out);

    this.dlyIn = c.createGain();
    this.delay = c.createDelay(2); this.delay.delayTime.value = .45;
    const fb = c.createGain(); fb.gain.value = .36;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    this.dlyIn.connect(this.delay); this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delay.connect(this.out);
    const dRev = c.createGain(); dRev.gain.value = .25; this.delay.connect(dRev).connect(this.revIn);

    this.drumBus = c.createGain(); this.drumBus.gain.value = 1.15; this.drumBus.connect(this.out);
    this.drumRev = c.createGain(); this.drumRev.gain.value = .3; this.drumRev.connect(this.revIn);

    this.chans = {};
    this.ksCache = {};
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  setTempo(bpm) { this.delay.delayTime.setTargetAtTime(60 / bpm * .75, this.ctx.currentTime, .05); }

  chan(id) {
    if (!this.chans[id]) {
      const c = this.ctx, p = PRESET_MAP[id], g = c.createGain();
      g.connect(this.out);
      const r = c.createGain(); r.gain.value = p.rev; g.connect(r).connect(this.revIn);
      const d = c.createGain(); d.gain.value = p.dly; g.connect(d).connect(this.dlyIn);
      this.chans[id] = g;
    }
    return this.chans[id];
  }

  play(id, midi, t, vel = .8, bright = .6) {
    return VOICES[id](this, midi, Math.max(t, this.ctx.currentTime), vel, bright, this.chan(id));
  }

  _ir(sec) {
    const c = this.ctx, sr = c.sampleRate, n = (sr * sec) | 0, b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * .55; d[i] = lp * Math.pow(1 - i / n, 3.4); }
    }
    return b;
  }

  // Karplus-Strong plucked string, rendered once per note and cached.
  _ks(midi, kind) {
    const key = kind + midi;
    if (this.ksCache[key]) return this.ksCache[key];
    const c = this.ctx, sr = c.sampleRate, f = mtof(midi);
    const N = Math.max(2, Math.floor(sr / f - .5)), f0 = sr / (N + .5);
    const drive = kind === 'drive', len = (sr * (drive ? 4 : 2.8)) | 0;
    const buf = c.createBuffer(1, len, sr), y = buf.getChannelData(0), ring = new Float32Array(N);
    let lp = 0, mean = 0;
    for (let i = 0; i < N; i++) { lp += ((Math.random() * 2 - 1) - lp) * (drive ? .75 : .5); ring[i] = lp; mean += lp; }
    mean /= N; for (let i = 0; i < N; i++) ring[i] -= mean;
    const decay = drive ? .9993 : .9968;
    for (let i = 0, p = 0; i < len; i++) {
      const a = ring[p], nb = ring[(p + 1) % N];
      y[i] = a; ring[p] = decay * .5 * (a + nb); p = (p + 1) % N;
    }
    return (this.ksCache[key] = { buf, rate: f / f0 });
  }

  _noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    s.start(t, Math.random() * .5); s.stop(t + dur); return s;
  }

  drum(name, t, v = 1) {
    const c = this.ctx, o = this.drumBus;
    const g = c.createGain(); g.connect(o);
    if (name === 'kick') {
      const s = c.createOscillator(); s.frequency.setValueAtTime(165, t); s.frequency.exponentialRampToValueAtTime(42, t + .11);
      g.gain.setValueAtTime(v * 1.1, t); g.gain.exponentialRampToValueAtTime(.001, t + .5);
      s.connect(g); s.start(t); s.stop(t + .55);
    } else if (name === 'snare' || name === 'clap') {
      const n = this._noiseSrc(t, .4), f = c.createBiquadFilter();
      if (name === 'snare') { f.type = 'highpass'; f.frequency.value = 1000; } else { f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = .8; }
      n.connect(f).connect(g); g.connect(this.drumRev);
      if (name === 'snare') {
        g.gain.setValueAtTime(v * .55, t); g.gain.exponentialRampToValueAtTime(.001, t + .2);
        const b = c.createOscillator(), bg = c.createGain(); b.type = 'triangle';
        b.frequency.setValueAtTime(190, t); b.frequency.exponentialRampToValueAtTime(150, t + .08);
        bg.gain.setValueAtTime(v * .45, t); bg.gain.exponentialRampToValueAtTime(.001, t + .1);
        b.connect(bg).connect(o); b.start(t); b.stop(t + .12);
      } else {
        g.gain.setValueAtTime(0, t);
        for (const k of [0, .011, .022]) { g.gain.setValueAtTime(v * .7, t + k); g.gain.exponentialRampToValueAtTime(.08, t + k + .01); }
        g.gain.setValueAtTime(v * .6, t + .033); g.gain.exponentialRampToValueAtTime(.001, t + .2);
      }
    } else if (name === 'hat' || name === 'ohat') {
      const n = this._noiseSrc(t, .35), f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
      n.connect(f).connect(g);
      g.gain.setValueAtTime(v * (name === 'hat' ? .32 : .2), t);
      g.gain.exponentialRampToValueAtTime(.001, t + (name === 'hat' ? .05 : .3));
    } else if (name === 'click' || name === 'clickHi') {
      const s = c.createOscillator(); s.frequency.value = name === 'clickHi' ? 1760 : 1180;
      g.gain.setValueAtTime(v * .3, t); g.gain.exponentialRampToValueAtTime(.001, t + .05);
      s.connect(g); s.start(t); s.stop(t + .06);
    }
  }
}

/* ---------- voice helpers ---------- */

function ampEnv(c, t, peak, a, d, s) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (d) g.gain.setTargetAtTime(peak * s, t + a, d);
  return g;
}

function voice(c, srcs, amp, rel, extra = {}) {
  let done = false;
  return {
    stop(t = c.currentTime) {
      if (done) return; done = true;
      t = Math.max(t, c.currentTime);
      const p = amp.gain;
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
      p.setTargetAtTime(0, t, rel / 4);
      const end = t + rel * 1.5 + .05;
      for (const s of srcs) try { s.stop(end); } catch (e) { /* already stopped */ }
    },
    setBright() {},
    ...extra,
  };
}

function osc(c, type, f, t, det = 0) {
  const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.start(t); return o;
}

function lfo(c, t, rate, depth, delay = 0) {
  const o = osc(c, 'sine', rate, t), g = c.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(depth, t + delay + .01);
  o.connect(g); return [o, g];
}

function shaper(c, k) {
  const ws = c.createWaveShaper(), n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
  ws.curve = curve; ws.oversample = '2x'; return ws;
}

/* ---------- instruments ---------- */

const VOICES = {
  lead(E, m, t, v, b, out) {
    const c = E.ctx, f = mtof(m), cut = x => 450 + x * 5200;
    const amp = ampEnv(c, t, v * .3, .008, .25, .75);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 5;
    flt.frequency.setValueAtTime(cut(b) * 2.2, t); flt.frequency.setTargetAtTime(cut(b), t, .12);
    const [lo, lg] = lfo(c, t, 5.6, 9, .35);
    const os = [['sawtooth', -8, 1], ['sawtooth', 8, 1], ['square', -1200, .35]].map(([ty, det, gv]) => {
      const o = osc(c, ty, f, t, det), g = c.createGain(); g.gain.value = gv;
      lg.connect(o.detune); o.connect(g).connect(flt); return o;
    });
    flt.connect(amp).connect(out);
    return voice(c, [...os, lo], amp, .35, { setBright: x => flt.frequency.setTargetAtTime(cut(x), c.currentTime, .05) });
  },

  pad(E, m, t, v, b, out) {
    const c = E.ctx, f = mtof(m), cut = x => 280 + x * 2600;
    const amp = ampEnv(c, t, v * .14, .45, 1, .85);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 1.4;
    flt.frequency.setValueAtTime(cut(b) * .5, t); flt.frequency.setTargetAtTime(cut(b), t, .35);
    const os = [-14, -5, 5, 14].map(d => osc(c, 'sawtooth', f, t, d));
    const tri = osc(c, 'triangle', f * 2, t), tg = c.createGain(); tg.gain.value = .4; tri.connect(tg).connect(flt);
    os.forEach(o => o.connect(flt));
    flt.connect(amp).connect(out);
    return voice(c, [...os, tri], amp, 1.6, { setBright: x => flt.frequency.setTargetAtTime(cut(x), c.currentTime, .08) });
  },

  vox(E, m, t, v, b, out) {
    const c = E.ctx, f = mtof(m);
    const OO = [300, 870, 2240], AH = [730, 1090, 2440];
    const fm = x => OO.map((o, i) => o + (AH[i] - o) * x);
    const amp = ampEnv(c, t, v * .4, .14, .3, .9);
    const [lo, lg] = lfo(c, t, 5.1, 14, .25);
    const src = c.createGain();
    const os = [-6, 6].map(d => { const o = osc(c, 'sawtooth', f, t, d); lg.connect(o.detune); o.connect(src); return o; });
    const bps = fm(b).map((fr, i) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9; bp.frequency.value = fr;
      const g = c.createGain(); g.gain.value = [2.2, 1.3, .7][i];
      src.connect(bp).connect(g).connect(amp); return bp;
    });
    amp.connect(out);
    return voice(c, [...os, lo], amp, .6, {
      setBright: x => fm(x).forEach((fr, i) => bps[i].frequency.setTargetAtTime(fr, c.currentTime, .06)),
    });
  },

  keys(E, m, t, v, b, out) {
    const c = E.ctx, f = mtof(m);
    const amp = ampEnv(c, t, v * .32, .002, 1.1, .05);
    const car = osc(c, 'sine', f, t);
    const mod = osc(c, 'sine', f, t), mg = c.createGain();
    mg.gain.setValueAtTime(f * (1 + b * 2.5) * v, t); mg.gain.setTargetAtTime(f * .25, t, .35);
    const tine = osc(c, 'sine', f * 14, t), tg = c.createGain();
    tg.gain.setValueAtTime(f * .7 * v, t); tg.gain.setTargetAtTime(0, t, .02);
    mod.connect(mg).connect(car.frequency); tine.connect(tg).connect(car.frequency);
    car.connect(amp).connect(out);
    return voice(c, [car, mod, tine], amp, .4);
  },

  bells(E, m, t, v, b, out) {
    const c = E.ctx, f = mtof(m);
    const amp = ampEnv(c, t, v * .22, .002, 1.4, 0);
    const car = osc(c, 'sine', f, t), mod = osc(c, 'sine', f * 3.5, t), mg = c.createGain();
    mg.gain.setValueAtTime(f * (1.2 + b * 2.4), t); mg.gain.setTargetAtTime(f * .1, t, .9);
    mod.connect(mg).connect(car.frequency); car.connect(amp).connect(out);
    return voice(c, [car, mod], amp, 1.2);
  },

  pluck(E, m, t, v, b, out) {
    const c = E.ctx, { buf, rate } = E._ks(m, 'clean');
    const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 1400 + b * 6000;
    const amp = ampEnv(c, t, v * 1.35, .001, 0, 1);
    s.connect(flt).connect(amp).connect(out); s.start(t);
    return voice(c, [s], amp, .25, { setBright: x => flt.frequency.setTargetAtTime(1400 + x * 6000, c.currentTime, .05) });
  },

  drive(E, m, t, v, b, out) {
    const c = E.ctx, { buf, rate } = E._ks(m, 'drive');
    const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const pre = c.createGain(); pre.gain.value = 1;
    const ws = shaper(c, 6 + b * 10);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const cab = c.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3400; cab.Q.value = .9;
    const amp = ampEnv(c, t, v * .16, .002, 0, 1);
    s.connect(pre).connect(ws).connect(hp).connect(cab).connect(amp).connect(out); s.start(t);
    return voice(c, [s], amp, .18);
  },

  bass(E, m, t, v, b, out) {
    const c = E.ctx, f = mtof(m), cut = x => 110 + x * 1500;
    const amp = ampEnv(c, t, v * .42, .004, .25, .7);
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 7;
    flt.frequency.setValueAtTime(cut(b) * 4, t); flt.frequency.setTargetAtTime(cut(b), t, .08);
    const a = osc(c, 'sawtooth', f, t), sq = osc(c, 'square', f, t, 6), sub = osc(c, 'sine', f / 2, t);
    const sg = c.createGain(); sg.gain.value = .5; sq.connect(sg).connect(flt); a.connect(flt);
    const subg = c.createGain(); subg.gain.value = .55; sub.connect(subg).connect(amp);
    flt.connect(amp).connect(out);
    return voice(c, [a, sq, sub], amp, .12, { setBright: x => flt.frequency.setTargetAtTime(cut(x), c.currentTime, .05) });
  },

  sub(E, m, t, v, b, out) {
    const c = E.ctx, f = mtof(m);
    const s = osc(c, 'sine', f, t);
    s.frequency.setValueAtTime(f * 3, t); s.frequency.exponentialRampToValueAtTime(f, t + .06);
    const amp = c.createGain(); amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v * .55, t + .003); amp.gain.setTargetAtTime(0, t + .003, .7);
    const ws = shaper(c, 1.2 + b * 4);
    s.connect(ws).connect(amp).connect(out);
    return voice(c, [s], amp, .25);
  },
};

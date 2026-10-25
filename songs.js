// Demo songs, and the checks every song passes before the page uses it.
// A bar is [sign degree, lyric]. Degrees are the same numbers the hand signs
// play (1 = Point, 6 = Thumbs up...), so a song is literally a list of signs.
import { SCALES, PATTERNS, PRESET_MAP } from './engine.js';

export const DEMOS = [
  {
    id: 'porch-light', title: 'Porch Light', key: 9, scale: 'Minor', bpm: 76, beat: 'Lo-Fi',
    left: { preset: 'pad', role: 'chord', arp: 0 }, right: { preset: 'lead' },
    sing: { skill: 'Breath support', how: 'Take one breath before each pair of bars and make it last the whole line. Breathe low, into your belly, so your shoulders stay still. If you run out early, sing softer, not faster.' },
    play: { skill: 'Change on the downbeat', how: 'Make each new sign exactly when the bar starts, on the loud kick. Hold it for the whole bar, then move straight to the next one.' },
    bars: [[1, 'I left the porch light on'], [6, 'it\'s burning through the rain'], [3, 'if you find your way back'], [7, 'you\'ll know the way again'],
      [1, 'breathe in, hold it steady'], [6, 'let the long note ring'], [3, 'every night I\'m ready'], [7, 'for the songs you bring']],
  },
  {
    id: 'late-train', title: 'Late Train', key: 4, scale: 'Minor', bpm: 96, beat: 'Synthwave',
    left: { preset: 'bass', role: 'note', arp: 8 }, right: { preset: 'lead' },
    sing: { skill: 'Singing in time', how: 'Land the first word of every bar on the kick drum. Count "one, two, three, four" under your breath during the count-in, then start on the next "one".' },
    play: { skill: 'Arpeggio bass', how: 'The left hand is set to Arpeggio 1/8, so one held sign turns into a moving bass line. Each sign lasts two bars, which gives you time to get the next one ready.' },
    bars: [[1, 'Late train rolling'], [1, 'down the line'], [6, 'city lights are'], [6, 'keeping time'],
      [4, 'one, two, I\'m on my way'], [4, 'three, four, I\'m here to stay'], [5, 'every beat a station'], [5, 'every word on time']],
  },
  {
    id: 'paper-planes', title: 'Paper Planes', key: 0, scale: 'Major', bpm: 100, beat: 'Hip-Hop',
    left: { preset: 'keys', role: 'chord', arp: 0 }, right: { preset: 'bells' },
    sing: { skill: 'Dynamics', how: 'Sing the first four bars quietly, close to a speaking voice. On bar five, open up to full voice for the chorus, then let it fall again when the song repeats.' },
    play: { skill: 'Brightness with hand height', how: 'Keep your left hand low for the quiet verse. Raise it for the chorus: the higher your hand, the brighter the chords sound.' },
    bars: [[1, 'Folding up a letter'], [5, 'nothing left to say'], [6, 'sending paper planes out'], [4, 'watch them float away'],
      [1, 'Fly, fly, over the town'], [5, 'higher, never coming down'], [6, 'fly, fly, catch the sun'], [4, 'every plane a brand new one']],
  },
  {
    id: 'two-voices', title: 'Two Voices', key: 7, scale: 'Major', bpm: 88, beat: 'Synthwave',
    left: { preset: 'pad', role: 'chord', arp: 0 }, right: { preset: 'vox' },
    sing: { skill: 'Finding your note', how: 'Under each chord you can see its three notes. Sing the first one (the root) all the way through. On the second time around, try the top note instead: that is a harmony.' },
    play: { skill: 'Two hands at once', how: 'Play the chords with your left hand and add any sign with your right. Every sign is in the key, so whatever the right hand picks will fit.' },
    bars: [[6, 'You sing the low line'], [4, 'I\'ll find the high'], [1, 'two voices meeting'], [5, 'somewhere in the sky'],
      [6, 'hold your note under'], [4, 'I\'ll hold mine above'], [1, 'nothing out of tune here'], [5, 'everything we\'re made of']],
  },
];

// Common progressions, as sign degrees. Names are filled in for the current key.
export const PROGRESSIONS = [
  { name: 'Pop', degs: [1, 5, 6, 4] },
  { name: 'Sad pop', degs: [6, 4, 1, 5] },
  { name: 'Minor drive', degs: [1, 6, 3, 7] },
  { name: 'Jazz turn', degs: [2, 5, 1, 1] },
  { name: 'Blues', degs: [1, 1, 1, 1, 4, 4, 1, 1, 5, 4, 1, 5] },
];

const int = (v, lo, hi, d) => Number.isInteger(v) && v >= lo && v <= hi ? v : d;
const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';

// Shared links and saved songs come from outside the page: keep only known fields.
export function cleanSong(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.bars) || !o.bars.length) return null;
  const preset = (p, d) => PRESET_MAP[p] ? p : d;
  return {
    id: str(o.id, 40) || 'song-' + Date.now().toString(36),
    title: str(o.title, 60).trim() || 'Untitled song',
    key: int(o.key, 0, 11, 9),
    scale: SCALES[o.scale] ? o.scale : 'Minor',
    bpm: int(o.bpm, 60, 160, 96),
    beat: PATTERNS[o.beat] ? o.beat : 'Synthwave',
    left: { preset: preset(o.left?.preset, 'pad'), role: o.left?.role === 'note' ? 'note' : 'chord', arp: [0, 8, 16].includes(o.left?.arp) ? o.left.arp : 0 },
    right: { preset: preset(o.right?.preset, 'lead') },
    bars: o.bars.slice(0, 32).map(b => [int(Array.isArray(b) ? b[0] : 0, 0, 10, 1), str(Array.isArray(b) ? b[1] : '', 80)]),
  };
}

export const encodeSong = s => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(s))));
export function decodeSong(text) {
  try { return cleanSong(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0))))); }
  catch (e) { return null; }
}

// The one check this logic needs: hostile input is clamped, real songs round-trip.
console.assert(cleanSong({ bars: 'x' }) === null && cleanSong(null) === null, 'cleanSong rejects non-songs');
console.assert(cleanSong({ bars: [[99, 5]], bpm: 9e9, left: { preset: 'nope' } }).bars[0][0] === 1, 'cleanSong clamps fields');
console.assert(decodeSong(encodeSong(cleanSong(DEMOS[0]))).bars[1][1] === DEMOS[0].bars[1][1], 'songs survive a share link');

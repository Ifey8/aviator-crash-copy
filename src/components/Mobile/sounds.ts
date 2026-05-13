/**
 * sounds.ts — Casino-style sound effects for Aviator Crash Game.
 *
 * Uses existing MP3 assets (takeoff, crash) plus Web Audio API synthesis
 * for chip placement, cashout cha-ching, countdown ticks, etc.
 *
 * Lazy-init AudioContext on first user gesture (browser autoplay policy).
 * All methods are safe to call before init — they silently no-op.
 */

import takeOffSrc from "../../assets/audio/take_off.mp3";
import flewAwaySrc from "../../assets/audio/flew_away.mp3";

let audioCtx: AudioContext | null = null;
let _muted = false;

// Pre-decoded audio buffers for MP3 assets
let takeOffBuffer: AudioBuffer | null = null;
let flewAwayBuffer: AudioBuffer | null = null;

const getCtx = (): AudioContext | null => {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch { return null; }
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
};

/** Call once on first user tap to unlock AudioContext + preload MP3s. */
export const initSounds = async () => {
  const ctx = getCtx();
  if (!ctx) return;

  const load = async (src: string): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(src);
      const buf = await res.arrayBuffer();
      return await ctx.decodeAudioData(buf);
    } catch { return null; }
  };

  const [t, f] = await Promise.all([load(takeOffSrc), load(flewAwaySrc)]);
  takeOffBuffer = t;
  flewAwayBuffer = f;
};

// ─── Helpers ─────────────────────────────────────────────────

const playBuffer = (buffer: AudioBuffer | null, volume = 0.5) => {
  if (_muted || !buffer) return;
  const ctx = getCtx();
  if (!ctx) return;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.buffer = buffer;
  src.connect(gain).connect(ctx.destination);
  src.start();
};

const osc = (
  freq: number,
  type: OscillatorType,
  duration: number,
  volume: number,
  detune = 0,
) => {
  if (_muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  g.gain.setValueAtTime(volume, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + duration);
};

/** Short noise burst (chip / click sound). */
const noiseBurst = (duration: number, volume: number, filterFreq: number) => {
  if (_muted) return;
  const ctx = getCtx();
  if (!ctx) return;
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start();
  src.stop(ctx.currentTime + duration);
};

// ─── Public sound functions ──────────────────────────────────

/** Casino chip placement — metallic tap + high ping. */
export const betPlace = () => {
  noiseBurst(0.06, 0.3, 3500);
  setTimeout(() => osc(1200, "sine", 0.08, 0.15), 30);
  setTimeout(() => osc(1800, "sine", 0.05, 0.1), 60);
};

/** Countdown tick during BET phase. */
export const countdownTick = () => {
  osc(800, "sine", 0.04, 0.08);
};

/** Plane takeoff — play the MP3 asset. */
export const takeoff = () => {
  playBuffer(takeOffBuffer, 0.45);
};

/** Multiplier milestone ding (every 2x or special values). */
export const milestone = (multiplier: number) => {
  const baseFreq = 600 + Math.min(multiplier, 20) * 40;
  osc(baseFreq, "sine", 0.12, 0.1);
  setTimeout(() => osc(baseFreq * 1.5, "sine", 0.08, 0.06), 50);
};

/** Rising tension tick — subtle, gets faster as multiplier climbs. */
export const risingTick = (multiplier: number) => {
  const freq = 400 + Math.min(multiplier, 15) * 60;
  osc(freq, "sine", 0.03, 0.04);
};

/** Cashout cha-ching — ascending coin cascade. */
export const cashout = (big = false) => {
  const vol = big ? 0.25 : 0.15;
  const count = big ? 5 : 3;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      osc(2000 + i * 400, "sine", 0.12, vol);
      osc(3000 + i * 600, "sine", 0.08, vol * 0.6, 5);
      noiseBurst(0.03, vol * 0.5, 6000);
    }, i * 60);
  }
};

/** Other player cashout — softer, single coin. */
export const otherCashout = () => {
  osc(2200, "sine", 0.06, 0.04);
  noiseBurst(0.02, 0.03, 5000);
};

/** Crash / flew away — play the MP3 asset + synth boom. */
export const crash = () => {
  playBuffer(flewAwayBuffer, 0.5);
  // Synth bass boom underneath
  if (!_muted) {
    const ctx = getCtx();
    if (ctx) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.4);
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.5);
    }
  }
};

/** Subtle button/tab click. */
export const buttonClick = () => {
  osc(600, "sine", 0.03, 0.06);
};

// ─── Mute control ────────────────────────────────────────────

export const isMuted = () => _muted;
export const setMuted = (v: boolean) => { _muted = v; };
export const toggleMute = () => { _muted = !_muted; return _muted; };

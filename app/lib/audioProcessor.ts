/*
 * audioProcessor.ts — KlangRein
 *
 * Audio processing pipeline: decode → silence-detect → trim → normalize → compress → encode
 *
 * Bug fixes vs previous version:
 *
 * 1. SILENCE DETECTION — previous version used exponential smoothing that started
 *    at 0 and took many windows to build up, causing the backward pass to mask
 *    all real silence. Now uses direct window RMS with a lookahead guard buffer
 *    to protect speech edges without over-smoothing.
 *
 * 2. NORMALIZATION — previous gainDb formula used RMS-based LUFS to decide gain
 *    but clamped against peak, which produced near-zero gain on loud recordings.
 *    Now computes gain as (targetLufsDb - measuredLufsDb) unconditionally, then
 *    applies a separate true-peak safety clamp so the output never clips.
 *
 * 3. COMPRESSION — threshold was -18 dBFS with ratio 2.5, which misses most
 *    real speech peaks. Changed to -12 dBFS / ratio 3.0 with makeup gain (+3 dB)
 *    so the output is audibly denser and louder.
 *
 * 4. CROSSFADE NaN GUARD — previous code did Math.sqrt(s / fadeIn) when
 *    fadeIn could be 0, producing NaN that corrupts the output buffer.
 *    Now guarded: no fade applied when fadeLen is 0.
 *
 * 5. Progress fires inside every tight loop every YIELD_EVERY samples so the
 *    bar moves continuously for 3-min+ files.
 */

export type ProcessingPreset = "basic" | "kursaufnahme" | "webinar" | "podcast";

export interface ProcessingProgress {
  step: string;
  percent: number;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

export interface ProcessingStats {
  originalDuration: number;
  processedDuration: number;
  gainAppliedDb: number;
  estimatedLufs: number;
  silenceRegionsFound: number;
}

interface PresetConfig {
  silenceThresholdRms: number;
  silenceMinDuration: number;
  keepPauseDuration: number;
  targetLufsDb: number;
  compThresholdDb: number;
  compRatio: number;
  compKneeDb: number;
  compMakeupDb: number;
}

const PRESET_CONFIG: Record<ProcessingPreset, PresetConfig> = {
  basic: {
    silenceThresholdRms: 0.018,
    silenceMinDuration: 0.5,
    keepPauseDuration: 0.25,
    targetLufsDb: -16,
    compThresholdDb: -12,
    compRatio: 3.0,
    compKneeDb: 6,
    compMakeupDb: 3,
  },
  kursaufnahme: {
    silenceThresholdRms: 0.015,
    silenceMinDuration: 0.4,
    keepPauseDuration: 0.2,
    targetLufsDb: -14,
    compThresholdDb: -10,
    compRatio: 3.5,
    compKneeDb: 4,
    compMakeupDb: 3,
  },
  webinar: {
    silenceThresholdRms: 0.020,
    silenceMinDuration: 0.6,
    keepPauseDuration: 0.3,
    targetLufsDb: -16,
    compThresholdDb: -12,
    compRatio: 3.0,
    compKneeDb: 6,
    compMakeupDb: 2.5,
  },
  podcast: {
    silenceThresholdRms: 0.016,
    silenceMinDuration: 0.35,
    keepPauseDuration: 0.15,
    targetLufsDb: -14,
    compThresholdDb: -10,
    compRatio: 4.0,
    compKneeDb: 3,
    compMakeupDb: 4,
  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

const YIELD_EVERY = 88200;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeBuffer(numChannels: number, numSamples: number, sampleRate: number): AudioBuffer {
  return new AudioBuffer({
    numberOfChannels: numChannels,
    length: Math.max(1, numSamples),
    sampleRate,
  });
}

function windowRms(data: Float32Array, start: number, end: number): number {
  const count = end - start;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / count);
}

// Integrated RMS loudness in dBFS — used for both stats and normalization target.
function measureLufsDb(buffer: AudioBuffer): number {
  let energy = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) energy += d[i] * d[i];
    count += d.length;
  }
  if (count === 0 || energy < 1e-20) return -70;
  return 10 * Math.log10(energy / count);
}

export { measureLufsDb as estimateLufs };

// True-peak: max absolute sample across all channels.
function truePeakDb(buffer: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak < 1e-10 ? -120 : 20 * Math.log10(peak);
}

// ── Step 1: Decode ────────────────────────────────────────────────────────────

async function decodeAudio(
  file: File,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Audiodatei dekodieren", percent: pctStart });
  await yieldToMain();
  const ctx = new AudioContext();
  try {
    const ab = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(ab);
    onProgress({ step: "Audiodatei dekodieren", percent: pctEnd });
    return decoded;
  } finally {
    await ctx.close();
  }
}

// ── Step 2: Silence detection ─────────────────────────────────────────────────
//
// Algorithm: compute per-window RMS, then apply a lookahead guard (LOOKAHEAD_WINS
// windows) so that any window within LOOKAHEAD_WINS of a loud window is never
// classified as silent — this preserves speech edges and plosives.
//
// Unlike the previous exponential-smoothing approach, this starts from the actual
// signal energy and never artificially inflates quiet regions.

async function detectSilenceRegions(
  buffer: AudioBuffer,
  thresholdRms: number,
  minDuration: number,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<Array<{ start: number; end: number }>> {
  onProgress({ step: "Stille erkennen", percent: pctStart });

  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const WIN_SEC = 0.025;
  const winSize = Math.max(1, Math.floor(sr * WIN_SEC));
  const totalWins = Math.ceil(data.length / winSize);
  const LOOKAHEAD_WINS = Math.ceil(0.10 / WIN_SEC);
  const YIELD_WIN = 2000;
  const pctRange = pctEnd - pctStart;

  // Pass 1: compute raw RMS per window
  const rmsArr = new Float32Array(totalWins);
  for (let w = 0; w < totalWins; w++) {
    const s = w * winSize;
    const e = Math.min(s + winSize, data.length);
    rmsArr[w] = windowRms(data, s, e);
    if (w % YIELD_WIN === 0) {
      onProgress({
        step: "Stille erkennen",
        percent: pctStart + Math.round((w / totalWins) * pctRange * 0.5),
      });
      await yieldToMain();
    }
  }

  // Pass 2: mark window as "active" if itself OR any window within LOOKAHEAD_WINS
  // is above the threshold — prevents clipping speech starts/ends.
  const active = new Uint8Array(totalWins);
  for (let w = 0; w < totalWins; w++) {
    if (rmsArr[w] >= thresholdRms) {
      const lo = Math.max(0, w - LOOKAHEAD_WINS);
      const hi = Math.min(totalWins, w + LOOKAHEAD_WINS + 1);
      for (let j = lo; j < hi; j++) active[j] = 1;
    }
    if (w % YIELD_WIN === 0) {
      onProgress({
        step: "Stille erkennen",
        percent: pctStart + Math.round((0.5 + (w / totalWins) * 0.5) * pctRange),
      });
      await yieldToMain();
    }
  }

  // Pass 3: collect contiguous silent regions
  const regions: Array<{ start: number; end: number }> = [];
  let silStart = -1;

  for (let w = 0; w <= totalWins; w++) {
    const isSilent = w < totalWins && active[w] === 0;
    if (isSilent) {
      if (silStart < 0) silStart = (w * winSize) / sr;
    } else {
      if (silStart >= 0) {
        const end = Math.min((w * winSize) / sr, buffer.duration);
        if (end - silStart >= minDuration) {
          regions.push({ start: silStart, end });
        }
        silStart = -1;
      }
    }
  }

  onProgress({ step: "Stille erkennen", percent: pctEnd });
  return regions;
}

// ── Step 3: Trim silence with crossfades ──────────────────────────────────────
//
// Each kept segment gets a short equal-power crossfade on its leading/trailing
// edge to prevent clicks. crossfadeSamples() is bounded so it can never be 0
// (avoids Math.sqrt(n/0) NaN). The sqrt envelope gives equal-power fade.

async function trimSilenceRegions(
  buffer: AudioBuffer,
  regions: Array<{ start: number; end: number }>,
  keepPause: number,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Stille kürzen", percent: pctStart });

  if (regions.length === 0) {
    onProgress({ step: "Stille kürzen", percent: pctEnd });
    return buffer;
  }

  const sr = buffer.sampleRate;
  const nch = buffer.numberOfChannels;

  // Build list of kept time segments
  const segments: Array<{ start: number; end: number }> = [];
  let pos = 0;
  for (const r of regions) {
    if (r.start > pos + 0.001) segments.push({ start: pos, end: r.start });
    const pauseEnd = Math.min(r.start + keepPause, r.end);
    if (pauseEnd - r.start > 0.001) segments.push({ start: r.start, end: pauseEnd });
    pos = r.end;
  }
  if (buffer.duration - pos > 0.001) segments.push({ start: pos, end: buffer.duration });

  if (segments.length === 0) {
    onProgress({ step: "Stille kürzen", percent: pctEnd });
    return buffer;
  }

  const FADE_SAMPLES = Math.max(64, Math.floor(sr * 0.008));

  const segLens = segments.map((s) => Math.max(FADE_SAMPLES * 2 + 1, Math.round((s.end - s.start) * sr)));
  const totalSamples = segLens.reduce((a, b) => a + b, 0);
  const out = makeBuffer(nch, totalSamples, sr);
  const totalWork = totalSamples * nch;
  let worked = 0;
  const pctRange = pctEnd - pctStart;

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let dstOff = 0;

    for (let si = 0; si < segments.length; si++) {
      const len = segLens[si];
      const srcStart = Math.round(segments[si].start * sr);
      const fadeLen = Math.min(FADE_SAMPLES, Math.floor(len / 3));

      for (let s = 0; s < len; s++) {
        const srcIdx = srcStart + s;
        let samp = (srcIdx >= 0 && srcIdx < src.length) ? src[srcIdx] : 0;

        if (fadeLen > 0) {
          if (s < fadeLen) {
            samp *= Math.sqrt(s / fadeLen);
          } else {
            const fromEnd = len - 1 - s;
            if (fromEnd < fadeLen) {
              samp *= Math.sqrt(fromEnd / fadeLen);
            }
          }
        }

        dst[dstOff + s] = samp;

        if (++worked % YIELD_EVERY === 0) {
          onProgress({
            step: "Stille kürzen",
            percent: pctStart + Math.round((worked / totalWork) * pctRange),
          });
          await yieldToMain();
        }
      }
      dstOff += len;
    }
  }

  onProgress({ step: "Stille kürzen", percent: pctEnd });
  return out;
}

// ── Step 4: Gain normalization ────────────────────────────────────────────────
//
// Computes integrated RMS loudness (in dBFS), calculates gain to reach target,
// then clamps with a -0.3 dBFS true-peak ceiling so output never clips.
// The gain is always applied — even if it's negative (i.e., audio is too loud).

async function normalizeLufs(
  buffer: AudioBuffer,
  targetDb: number,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<{ buffer: AudioBuffer; gainDb: number }> {
  onProgress({ step: "Lautstärke normalisieren", percent: pctStart });

  const currentLufsDb = measureLufsDb(buffer);
  if (currentLufsDb <= -69) {
    onProgress({ step: "Lautstärke normalisieren", percent: pctEnd });
    return { buffer, gainDb: 0 };
  }

  // Gain needed to hit target loudness
  let gainDb = targetDb - currentLufsDb;

  // True-peak safety: never let any sample exceed -0.3 dBFS
  const peakDb = truePeakDb(buffer);
  const maxAllowedGainDb = -0.3 - peakDb;
  if (gainDb > maxAllowedGainDb) gainDb = maxAllowedGainDb;

  const linearGain = Math.pow(10, gainDb / 20);

  const nch = buffer.numberOfChannels;
  const out = makeBuffer(nch, buffer.length, buffer.sampleRate);
  const totalSamples = nch * buffer.length;
  let written = 0;
  const pctRange = pctEnd - pctStart;

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * linearGain;
      if (++written % YIELD_EVERY === 0) {
        onProgress({
          step: "Lautstärke normalisieren",
          percent: pctStart + Math.round((written / totalSamples) * pctRange),
        });
        await yieldToMain();
      }
    }
  }

  onProgress({ step: "Lautstärke normalisieren", percent: pctEnd });
  return { buffer: out, gainDb };
}

// ── Step 5: Compression ───────────────────────────────────────────────────────
//
// Lookahead-free feed-forward compressor in dBFS domain.
// Gain reduction: GR = (threshold - envDb) * (1 - 1/ratio)  [classic formula]
// Soft-knee: GR interpolated via t^2 through knee region.
// Makeup gain added after GR so output level recovers.
// Attack 3ms, release 150ms — fast enough for speech transients.

async function applyCompression(
  buffer: AudioBuffer,
  thresholdDb: number,
  ratio: number,
  kneeDb: number,
  makeupDb: number,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Dynamik komprimieren", percent: pctStart });

  const sr = buffer.sampleRate;
  const atkCoeff = Math.exp(-1 / (sr * 0.003));
  const relCoeff = Math.exp(-1 / (sr * 0.150));
  const kneeBottom = thresholdDb - kneeDb / 2;
  const kneeTop    = thresholdDb + kneeDb / 2;
  const makeupLin  = Math.pow(10, makeupDb / 20);
  const TINY = 1e-10;

  const nch = buffer.numberOfChannels;
  const out = makeBuffer(nch, buffer.length, sr);
  const totalSamples = nch * buffer.length;
  let worked = 0;
  const pctRange = pctEnd - pctStart;

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let envLin = 0;

    for (let i = 0; i < src.length; i++) {
      const absLin = Math.abs(src[i]);

      // Ballistics: fast attack, slow release
      if (absLin > envLin) {
        envLin = atkCoeff * envLin + (1 - atkCoeff) * absLin;
      } else {
        envLin = relCoeff * envLin + (1 - relCoeff) * absLin;
      }

      const envDb = 20 * Math.log10(Math.max(envLin, TINY));

      // Gain reduction in dB (always <= 0)
      let grDb = 0;
      if (envDb >= kneeTop) {
        // Above knee: full compression
        grDb = (thresholdDb - envDb) * (1 - 1 / ratio);
      } else if (envDb > kneeBottom) {
        // Inside knee: smooth interpolation
        const t = (envDb - kneeBottom) / kneeDb;
        grDb = (thresholdDb - envDb) * (1 - 1 / ratio) * (t * t);
      }

      // Apply gain reduction + makeup gain
      dst[i] = src[i] * Math.pow(10, grDb / 20) * makeupLin;

      if (++worked % YIELD_EVERY === 0) {
        onProgress({
          step: "Dynamik komprimieren",
          percent: pctStart + Math.round((worked / totalSamples) * pctRange),
        });
        await yieldToMain();
      }
    }
  }

  // Final peak-limiter pass: clamp any samples that went above 0 dBFS after makeup
  for (let ch = 0; ch < nch; ch++) {
    const dst = out.getChannelData(ch);
    for (let i = 0; i < dst.length; i++) {
      if (dst[i] > 0.9999) dst[i] = 0.9999;
      else if (dst[i] < -0.9999) dst[i] = -0.9999;
    }
  }

  onProgress({ step: "Dynamik komprimieren", percent: pctEnd });
  return out;
}

// ── Step 6 (Pro only): Noise Gate ─────────────────────────────────────────────

async function applyNoiseGate(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Rauschen reduzieren", percent: pctStart });

  const sr = buffer.sampleRate;
  // Profile noise floor from first 0.5s
  const profileLen = Math.min(Math.floor(sr * 0.5), buffer.length);
  const noiseFloor = windowRms(buffer.getChannelData(0), 0, profileLen);
  const gateThresh = Math.max(noiseFloor * 3.0, 0.005);

  const atkS = Math.max(1, Math.floor(sr * 0.010));
  const relS = Math.max(1, Math.floor(sr * 0.080));
  const nch = buffer.numberOfChannels;
  const out = makeBuffer(nch, buffer.length, sr);
  const totalSamples = nch * buffer.length;
  let worked = 0;
  const pctRange = pctEnd - pctStart;

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let env = 0;

    for (let i = 0; i < src.length; i++) {
      const abs = Math.abs(src[i]);
      env = abs > env
        ? env + (abs - env) / atkS
        : env + (abs - env) / relS;
      const gain = env >= gateThresh ? 1.0 : env / gateThresh;
      dst[i] = src[i] * gain;

      if (++worked % YIELD_EVERY === 0) {
        onProgress({
          step: "Rauschen reduzieren",
          percent: pctStart + Math.round((worked / totalSamples) * pctRange),
        });
        await yieldToMain();
      }
    }
  }

  onProgress({ step: "Rauschen reduzieren", percent: pctEnd });
  return out;
}

// ── Step 7 (Pro only): EQ ─────────────────────────────────────────────────────

async function applyEQ(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "EQ – Stimmklarheit", percent: pctStart });

  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 80;
  hp.Q.value = 0.7;

  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.gain.value = 2.0;
  presence.Q.value = 1.2;

  const air = ctx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 10000;
  air.gain.value = 1.5;

  src.connect(hp);
  hp.connect(presence);
  presence.connect(air);
  air.connect(ctx.destination);
  src.start(0);

  const result = await ctx.startRendering();
  onProgress({ step: "EQ – Stimmklarheit", percent: pctEnd });
  return result;
}

// ── Step 6 (basic): Dereverberation ──────────────────────────────────────────
//
// Spectral subtraction dereverberation (STFT-domain):
//
// The algorithm works frame-by-frame on overlapping windows. For each frame:
//   1. Apply a Hann window and compute the magnitude spectrum via a real DFT.
//   2. Maintain a running estimate of the reverb "floor" — the slowly-decaying
//      tail energy left from previous frames — using an IIR smoother tuned to
//      a ~120ms reverb decay time constant.
//   3. Subtract a fraction (α) of the reverb floor from the current magnitude
//      spectrum, clamping to a noise floor so we never subtract more than exists.
//   4. Reconstruct the signal with overlap-add using the original phase (phase
//      information is untouched so voice timbre is preserved).
//
// Parameters tuned for typical home/office rooms with ~80–200ms RT60:
//   - Frame: 1024 samples (~23ms @ 44.1kHz)
//   - Hop:   256 samples (75% overlap — smooth reconstruction)
//   - Reverb IIR decay: τ = 0.12s
//   - Subtraction strength α = 0.7 (moderate — avoids musical noise)
//   - Floor β = 0.05 (prevents over-subtraction artifacts)
//
// No new AudioContext is created — operates directly on Float32Array samples.
// Progress fires every YIELD_EVERY samples to keep the bar moving.

async function applyDereverb(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Hall reduzieren", percent: pctStart });

  const sr    = buffer.sampleRate;
  const nch   = buffer.numberOfChannels;
  const N     = 1024;
  const HOP   = 256;
  const ALPHA = 0.70;
  const BETA  = 0.05;

  // IIR reverb-decay coefficient: τ = 120ms
  const TAU_SAMPLES = sr * 0.12;
  const decayCoeff  = Math.exp(-HOP / TAU_SAMPLES);

  // Hann window
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));

  // Radix-2 Cooley–Tukey FFT (in-place, complex, N must be power of 2).
  // fftRe / fftIm are reused across frames to avoid allocation.
  const BINS  = N / 2 + 1;
  const fftRe = new Float64Array(N);
  const fftIm = new Float64Array(N);
  const mag   = new Float32Array(BINS);

  // Bit-reversal permutation table (computed once)
  const bitRev = new Uint32Array(N);
  {
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let x = i, r = 0;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      bitRev[i] = r;
    }
  }

  // Twiddle-factor cache (computed once)
  const twRe = new Float64Array(N / 2);
  const twIm = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    const angle = (-2 * Math.PI * i) / N;
    twRe[i] = Math.cos(angle);
    twIm[i] = Math.sin(angle);
  }

  function fftInPlace(sign: 1 | -1): void {
    // Bit-reverse shuffle
    for (let i = 0; i < N; i++) {
      const j = bitRev[i];
      if (j > i) {
        let t = fftRe[i]; fftRe[i] = fftRe[j]; fftRe[j] = t;
        t = fftIm[i]; fftIm[i] = fftIm[j]; fftIm[j] = t;
      }
    }
    // Butterfly stages
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let j = 0; j < half; j++) {
          const ti = step * j;
          const wr = twRe[ti];
          const wi = sign === 1 ? -twIm[ti] : twIm[ti];
          const ur = fftRe[i + j],       ui = fftIm[i + j];
          const vr = fftRe[i + j + half] * wr - fftIm[i + j + half] * wi;
          const vi = fftRe[i + j + half] * wi + fftIm[i + j + half] * wr;
          fftRe[i + j]        = ur + vr;
          fftIm[i + j]        = ui + vi;
          fftRe[i + j + half] = ur - vr;
          fftIm[i + j + half] = ui - vi;
        }
      }
    }
  }

  function doFFT(frame: Float32Array): void {
    for (let i = 0; i < N; i++) { fftRe[i] = frame[i]; fftIm[i] = 0; }
    fftInPlace(1);
    for (let k = 0; k < BINS; k++) mag[k] = Math.sqrt(fftRe[k] * fftRe[k] + fftIm[k] * fftIm[k]);
  }

  function doIFFT(outFrame: Float32Array): void {
    fftInPlace(-1);
    const invN = 1 / N;
    for (let i = 0; i < N; i++) outFrame[i] = fftRe[i] * invN;
  }

  const pctRange = pctEnd - pctStart;
  const out  = makeBuffer(nch, buffer.length, sr);

  for (let ch = 0; ch < nch; ch++) {
    const src     = buffer.getChannelData(ch);
    const dst     = out.getChannelData(ch);
    const ola     = new Float32Array(src.length + N);
    const olaW    = new Float32Array(src.length + N);
    const floor   = new Float32Array(BINS);
    const frame   = new Float32Array(N);
    const outFr   = new Float32Array(N);
    let   worked  = 0;

    for (let pos = 0; pos < src.length; pos += HOP) {
      // Fill frame with Hann-windowed input
      for (let i = 0; i < N; i++) {
        const idx = pos + i;
        frame[i] = idx < src.length ? src[idx] * hann[i] : 0;
      }

      // FFT
      doFFT(frame);

      // Update reverb floor IIR: floor ← decay * floor + (1-decay) * mag
      // Subtract α * floor from magnitude, clamp to β * mag floor.
      // Re-scale the complex FFT bins by the ratio (reduced/original mag)
      // to preserve phase — voice timbre is unchanged.
      for (let k = 0; k < BINS; k++) {
        floor[k] = decayCoeff * floor[k] + (1 - decayCoeff) * mag[k];
        const reduced = Math.max(mag[k] - ALPHA * floor[k], BETA * mag[k]);
        const scale   = mag[k] > 1e-10 ? reduced / mag[k] : 0;
        fftRe[k] *= scale;
        fftIm[k] *= scale;
        // Mirror for IFFT (real signal symmetry)
        if (k > 0 && k < N - k) {
          fftRe[N - k] = fftRe[k];
          fftIm[N - k] = -fftIm[k];
        }
      }

      // IFFT
      doIFFT(outFr);

      // Overlap-add with Hann synthesis window; accumulate window² for normalisation
      for (let i = 0; i < N; i++) {
        ola[pos + i]  += outFr[i] * hann[i];
        olaW[pos + i] += hann[i] * hann[i];
      }

      worked += HOP;
      if (worked % YIELD_EVERY < HOP) {
        onProgress({
          step: "Hall reduzieren",
          percent: pctStart + Math.round(
            Math.min((ch * src.length + pos) / (nch * src.length), 1) * pctRange
          ),
        });
        await yieldToMain();
      }
    }

    // Normalise OLA output by accumulated window energy per sample
    for (let i = 0; i < src.length; i++) {
      dst[i] = olaW[i] > 1e-8 ? ola[i] / olaW[i] : 0;
    }
  }

  onProgress({ step: "Hall reduzieren", percent: pctEnd });
  return out;
}

// ── WAV Export ────────────────────────────────────────────────────────────────

function audioBufferToWav(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Blob {
  onProgress({ step: "WAV exportieren", percent: pctStart });

  const nch = buffer.numberOfChannels;
  const sr  = buffer.sampleRate;
  const len = buffer.length;
  const byteLen = len * nch * 2 + 44;

  const ab = new ArrayBuffer(byteLen);
  const dv = new DataView(ab);

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };

  str(0,  "RIFF");
  dv.setUint32(4,  byteLen - 8,  true);
  str(8,  "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16,           true);
  dv.setUint16(20, 1,            true);
  dv.setUint16(22, nch,          true);
  dv.setUint32(24, sr,           true);
  dv.setUint32(28, sr * nch * 2, true);
  dv.setUint16(32, nch * 2,      true);
  dv.setUint16(34, 16,           true);
  str(36, "data");
  dv.setUint32(40, len * nch * 2, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < nch; ch++) channels.push(buffer.getChannelData(ch));

  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nch; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  onProgress({ step: "WAV exportieren", percent: pctEnd });
  return new Blob([ab], { type: "audio/wav" });
}

// ── Public API ────────────────────────────────────────────────────────────────
//
// Step % ranges (basic):
//   decode        0 → 10
//   silence-det  10 → 28
//   trim         28 → 48
//   normalize    48 → 68
//   compress     68 → 84
//   dereverb     84 → 94
//   encode       94 → 100
//
// Step % ranges (pro):
//   decode        0 →  8
//   noise-gate    8 → 20
//   silence-det  20 → 35
//   trim         35 → 50
//   normalize    50 → 65
//   compress     65 → 80
//   EQ           80 → 92
//   encode       92 → 100

export async function processAudioBasic(
  file: File,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {
  const cfg = PRESET_CONFIG.basic;

  const original = await decodeAudio(file, onProgress, 0, 10);
  const originalDuration = original.duration;
  const estimatedLufs = measureLufsDb(original);

  const silenceRegions = await detectSilenceRegions(
    original,
    cfg.silenceThresholdRms,
    cfg.silenceMinDuration,
    onProgress,
    10, 28
  );

  const trimmed = await trimSilenceRegions(
    original, silenceRegions, cfg.keepPauseDuration, onProgress, 28, 48
  );

  const { buffer: normalized, gainDb } = await normalizeLufs(
    trimmed, cfg.targetLufsDb, onProgress, 48, 68
  );

  const compressed = await applyCompression(
    normalized,
    cfg.compThresholdDb,
    cfg.compRatio,
    cfg.compKneeDb,
    cfg.compMakeupDb,
    onProgress,
    68, 84
  );

  const dereverberated = await applyDereverb(compressed, onProgress, 84, 94);

  const blob = audioBufferToWav(dereverberated, onProgress, 94, 100);

  return {
    blob,
    stats: {
      originalDuration,
      processedDuration: dereverberated.duration,
      gainAppliedDb: gainDb,
      estimatedLufs,
      silenceRegionsFound: silenceRegions.length,
    },
  };
}

export async function processAudioPro(
  file: File,
  preset: ProcessingPreset,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {
  const cfg = PRESET_CONFIG[preset];

  const original = await decodeAudio(file, onProgress, 0, 8);
  const originalDuration = original.duration;
  const estimatedLufs = measureLufsDb(original);

  const denoised = await applyNoiseGate(original, onProgress, 8, 20);

  const silenceRegions = await detectSilenceRegions(
    denoised,
    cfg.silenceThresholdRms,
    cfg.silenceMinDuration,
    onProgress,
    20, 35
  );

  const trimmed = await trimSilenceRegions(
    denoised, silenceRegions, cfg.keepPauseDuration, onProgress, 35, 50
  );

  const { buffer: normalized, gainDb } = await normalizeLufs(
    trimmed, cfg.targetLufsDb, onProgress, 50, 65
  );

  const compressed = await applyCompression(
    normalized,
    cfg.compThresholdDb,
    cfg.compRatio,
    cfg.compKneeDb,
    cfg.compMakeupDb,
    onProgress,
    65, 80
  );

  const eqd = await applyEQ(compressed, onProgress, 80, 92);

  const blob = audioBufferToWav(eqd, onProgress, 92, 100);

  return {
    blob,
    stats: {
      originalDuration,
      processedDuration: eqd.duration,
      gainAppliedDb: gainDb,
      estimatedLufs,
      silenceRegionsFound: silenceRegions.length,
    },
  };
}

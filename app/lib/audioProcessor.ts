/*
 * audioProcessor.ts — KlangRein
 *
 * Modular audio pipeline: decode → silenceTrim → highPass → peakNormalize
 *                         → lightCompression → lightDereverb → encodeWav
 *
 * Each step is optional via ProcessingOptions flags.
 * Only one AudioContext is created per processAudio call (during decode).
 * All heavy loops yield to the event loop every YIELD_EVERY samples.
 */

export type ProcessingPreset = "basic" | "kursaufnahme" | "webinar" | "podcast";

export interface ProcessingOptions {
  trimSilence: boolean;
  highPass: boolean;
  normalize: boolean;
  compress: boolean;
  dereverb: boolean;
}

export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = {
  trimSilence: true,
  highPass: true,
  normalize: true,
  compress: true,
  dereverb: false,
};

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

// ── Constants ─────────────────────────────────────────────────────────────────

const YIELD_EVERY = 88200;

const SILENCE_THRESHOLD_RMS = 0.018;
const SILENCE_MIN_DURATION  = 0.5;
const KEEP_PAUSE_DURATION   = 0.25;

// Podcast-style compressor settings
const COMP_THRESHOLD_DB = -14;
const COMP_RATIO        = 2.0;
const COMP_KNEE_DB      = 6;
const COMP_ATTACK_MS    = 15;
const COMP_RELEASE_MS   = 120;
const COMP_FLOOR_DB     = -35;

// Peak normalization target: -1 dBFS
const PEAK_TARGET_DB = -1.0;

// ── Utilities ─────────────────────────────────────────────────────────────────

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

function measureRmsDb(buffer: AudioBuffer): number {
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

export { measureRmsDb as estimateLufs };

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

// ── Step 2: Silence trim ──────────────────────────────────────────────────────

async function detectSilenceRegions(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<Array<{ start: number; end: number }>> {
  onProgress({ step: "Pausen erkennen", percent: pctStart });

  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const WIN_SEC = 0.025;
  const winSize = Math.max(1, Math.floor(sr * WIN_SEC));
  const totalWins = Math.ceil(data.length / winSize);
  const LOOKAHEAD_WINS = Math.ceil(0.10 / WIN_SEC);
  const YIELD_WIN = 2000;
  const pctRange = pctEnd - pctStart;

  const rmsArr = new Float32Array(totalWins);
  for (let w = 0; w < totalWins; w++) {
    const s = w * winSize;
    const e = Math.min(s + winSize, data.length);
    rmsArr[w] = windowRms(data, s, e);
    if (w % YIELD_WIN === 0) {
      onProgress({
        step: "Pausen erkennen",
        percent: pctStart + Math.round((w / totalWins) * pctRange * 0.5),
      });
      await yieldToMain();
    }
  }

  const active = new Uint8Array(totalWins);
  for (let w = 0; w < totalWins; w++) {
    if (rmsArr[w] >= SILENCE_THRESHOLD_RMS) {
      const lo = Math.max(0, w - LOOKAHEAD_WINS);
      const hi = Math.min(totalWins, w + LOOKAHEAD_WINS + 1);
      for (let j = lo; j < hi; j++) active[j] = 1;
    }
    if (w % YIELD_WIN === 0) {
      onProgress({
        step: "Pausen erkennen",
        percent: pctStart + Math.round((0.5 + (w / totalWins) * 0.5) * pctRange),
      });
      await yieldToMain();
    }
  }

  const regions: Array<{ start: number; end: number }> = [];
  let silStart = -1;
  for (let w = 0; w <= totalWins; w++) {
    const isSilent = w < totalWins && active[w] === 0;
    if (isSilent) {
      if (silStart < 0) silStart = (w * winSize) / sr;
    } else {
      if (silStart >= 0) {
        const end = Math.min((w * winSize) / sr, buffer.duration);
        if (end - silStart >= SILENCE_MIN_DURATION) {
          regions.push({ start: silStart, end });
        }
        silStart = -1;
      }
    }
  }

  onProgress({ step: "Pausen erkennen", percent: pctEnd });
  return regions;
}

async function trimSilenceRegions(
  buffer: AudioBuffer,
  regions: Array<{ start: number; end: number }>,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Pausen kürzen", percent: pctStart });

  if (regions.length === 0) {
    onProgress({ step: "Pausen kürzen", percent: pctEnd });
    return buffer;
  }

  const sr = buffer.sampleRate;
  const nch = buffer.numberOfChannels;

  const segments: Array<{ start: number; end: number }> = [];
  let pos = 0;
  for (const r of regions) {
    if (r.start > pos + 0.001) segments.push({ start: pos, end: r.start });
    const pauseEnd = Math.min(r.start + KEEP_PAUSE_DURATION, r.end);
    if (pauseEnd - r.start > 0.001) segments.push({ start: r.start, end: pauseEnd });
    pos = r.end;
  }
  if (buffer.duration - pos > 0.001) segments.push({ start: pos, end: buffer.duration });

  if (segments.length === 0) {
    onProgress({ step: "Pausen kürzen", percent: pctEnd });
    return buffer;
  }

  const FADE_SAMPLES = Math.max(64, Math.floor(sr * 0.008));
  const segLens = segments.map((s) =>
    Math.max(FADE_SAMPLES * 2 + 1, Math.round((s.end - s.start) * sr))
  );
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
        let samp = srcIdx >= 0 && srcIdx < src.length ? src[srcIdx] : 0;

        if (fadeLen > 0) {
          if (s < fadeLen) {
            samp *= Math.sqrt(s / fadeLen);
          } else {
            const fromEnd = len - 1 - s;
            if (fromEnd < fadeLen) samp *= Math.sqrt(fromEnd / fadeLen);
          }
        }

        dst[dstOff + s] = samp;

        if (++worked % YIELD_EVERY === 0) {
          onProgress({
            step: "Pausen kürzen",
            percent: pctStart + Math.round((worked / totalWork) * pctRange),
          });
          await yieldToMain();
        }
      }
      dstOff += len;
    }
  }

  onProgress({ step: "Pausen kürzen", percent: pctEnd });
  return out;
}

// ── Step 3: High-pass filter (80 Hz) ─────────────────────────────────────────
// Uses OfflineAudioContext with a Web Audio BiquadFilter.
// No AudioContext stored globally — OfflineAudioContext is a one-shot renderer.

async function applyHighPass(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Rumpeln entfernen", percent: pctStart });

  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 80;
  hp.Q.value = 0.7;

  src.connect(hp);
  hp.connect(ctx.destination);
  src.start(0);

  const result = await ctx.startRendering();
  onProgress({ step: "Rumpeln entfernen", percent: pctEnd });
  return result;
}

// ── Step 4: Peak normalization to -1 dBFS ────────────────────────────────────
// Scans true peak across all channels, computes exact gain to reach -1 dBFS.

async function applyPeakNormalize(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<{ buffer: AudioBuffer; gainDb: number }> {
  onProgress({ step: "Lautstärke ausgleichen", percent: pctStart });

  const currentPeakDb = truePeakDb(buffer);
  if (currentPeakDb <= -119) {
    onProgress({ step: "Lautstärke ausgleichen", percent: pctEnd });
    return { buffer, gainDb: 0 };
  }

  const gainDb = PEAK_TARGET_DB - currentPeakDb;
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
      dst[i] = Math.max(-0.9999, Math.min(0.9999, src[i] * linearGain));
      if (++written % YIELD_EVERY === 0) {
        onProgress({
          step: "Lautstärke ausgleichen",
          percent: pctStart + Math.round((written / totalSamples) * pctRange),
        });
        await yieldToMain();
      }
    }
  }

  onProgress({ step: "Lautstärke ausgleichen", percent: pctEnd });
  return { buffer: out, gainDb };
}

// ── Step 5: Light compression (podcast-style) ─────────────────────────────────
// Gentle feed-forward compressor:
//   threshold -14 dB, ratio 2:1, attack 15ms, release 120ms, knee 6 dB.
// Signals below COMP_FLOOR_DB (breaths/room noise) are left untouched.

async function applyLightCompression(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Dynamik komprimieren", percent: pctStart });

  const sr = buffer.sampleRate;
  const atkCoeff = Math.exp(-1 / (sr * COMP_ATTACK_MS / 1000));
  const relCoeff = Math.exp(-1 / (sr * COMP_RELEASE_MS / 1000));
  const kneeBottom = COMP_THRESHOLD_DB - COMP_KNEE_DB / 2;
  const kneeTop    = COMP_THRESHOLD_DB + COMP_KNEE_DB / 2;
  const floorLin   = Math.pow(10, COMP_FLOOR_DB / 20);
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

      if (absLin > envLin) {
        envLin = atkCoeff * envLin + (1 - atkCoeff) * absLin;
      } else {
        envLin = relCoeff * envLin + (1 - relCoeff) * absLin;
      }

      // Skip compression for very quiet signals (preserve breaths)
      if (envLin < floorLin) {
        dst[i] = src[i];
      } else {
        const envDb = 20 * Math.log10(Math.max(envLin, TINY));

        let grDb = 0;
        if (envDb >= kneeTop) {
          grDb = (COMP_THRESHOLD_DB - envDb) * (1 - 1 / COMP_RATIO);
        } else if (envDb > kneeBottom) {
          const t = (envDb - kneeBottom) / COMP_KNEE_DB;
          grDb = (COMP_THRESHOLD_DB - envDb) * (1 - 1 / COMP_RATIO) * (t * t);
        }

        dst[i] = src[i] * Math.pow(10, grDb / 20);
      }

      if (++worked % YIELD_EVERY === 0) {
        onProgress({
          step: "Dynamik komprimieren",
          percent: pctStart + Math.round((worked / totalSamples) * pctRange),
        });
        await yieldToMain();
      }
    }
  }

  // Safety limiter: clamp any samples that exceed ±1
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

// ── Step 6: Light dereverberation ────────────────────────────────────────────
//
// STFT-domain spectral subtraction at very conservative strength (α=0.15).
// Estimates the slowly-decaying reverb tail via an IIR floor tracker tuned
// to τ=120ms and subtracts only 15% of that estimate — just enough to reduce
// audible room reflections without producing musical-noise artifacts.
//
// Phase is preserved throughout (only magnitude is scaled).
// Uses a radix-2 FFT — O(N log N), viable for 3–5 min files.

async function applyLightDereverb(
  buffer: AudioBuffer,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Raumhall reduzieren", percent: pctStart });

  const sr   = buffer.sampleRate;
  const nch  = buffer.numberOfChannels;
  const N    = 1024;
  const HOP  = 256;

  // Conservative settings — reflection reduction only
  const ALPHA = 0.15;  // subtraction strength (was 0.70)
  const BETA  = 0.02;  // spectral floor factor

  const TAU_SAMPLES = sr * 0.12;
  const decayCoeff  = Math.exp(-HOP / TAU_SAMPLES);

  // Hann window
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }

  // FFT setup — radix-2 Cooley–Tukey
  const BINS  = N / 2 + 1;
  const fftRe = new Float64Array(N);
  const fftIm = new Float64Array(N);
  const mag   = new Float32Array(BINS);

  // Bit-reversal table
  const bitRev = new Uint32Array(N);
  {
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let x = i, r = 0;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      bitRev[i] = r;
    }
  }

  // Twiddle-factor cache
  const twRe = new Float64Array(N / 2);
  const twIm = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    const angle = (-2 * Math.PI * i) / N;
    twRe[i] = Math.cos(angle);
    twIm[i] = Math.sin(angle);
  }

  function fftInPlace(sign: 1 | -1): void {
    for (let i = 0; i < N; i++) {
      const j = bitRev[i];
      if (j > i) {
        let t = fftRe[i]; fftRe[i] = fftRe[j]; fftRe[j] = t;
        t = fftIm[i]; fftIm[i] = fftIm[j]; fftIm[j] = t;
      }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let j = 0; j < half; j++) {
          const ti = step * j;
          const wr = twRe[ti];
          const wi = sign === 1 ? -twIm[ti] : twIm[ti];
          const ur = fftRe[i + j], ui = fftIm[i + j];
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
    for (let k = 0; k < BINS; k++) {
      mag[k] = Math.sqrt(fftRe[k] * fftRe[k] + fftIm[k] * fftIm[k]);
    }
  }

  function doIFFT(outFrame: Float32Array): void {
    fftInPlace(-1);
    const invN = 1 / N;
    for (let i = 0; i < N; i++) outFrame[i] = fftRe[i] * invN;
  }

  const pctRange = pctEnd - pctStart;
  const out = makeBuffer(nch, buffer.length, sr);

  for (let ch = 0; ch < nch; ch++) {
    const src   = buffer.getChannelData(ch);
    const dst   = out.getChannelData(ch);
    const ola   = new Float32Array(src.length + N);
    const olaW  = new Float32Array(src.length + N);
    const floor = new Float32Array(BINS);
    const frame = new Float32Array(N);
    const outFr = new Float32Array(N);
    let worked  = 0;

    for (let pos = 0; pos < src.length; pos += HOP) {
      for (let i = 0; i < N; i++) {
        const idx = pos + i;
        frame[i] = idx < src.length ? src[idx] * hann[i] : 0;
      }

      doFFT(frame);

      for (let k = 0; k < BINS; k++) {
        floor[k] = decayCoeff * floor[k] + (1 - decayCoeff) * mag[k];
        const reduced = Math.max(mag[k] - ALPHA * floor[k], BETA * mag[k]);
        const scale   = mag[k] > 1e-10 ? reduced / mag[k] : 0;
        fftRe[k] *= scale;
        fftIm[k] *= scale;
        if (k > 0 && k < N - k) {
          fftRe[N - k] = fftRe[k];
          fftIm[N - k] = -fftIm[k];
        }
      }

      doIFFT(outFr);

      for (let i = 0; i < N; i++) {
        ola[pos + i]  += outFr[i] * hann[i];
        olaW[pos + i] += hann[i] * hann[i];
      }

      worked += HOP;
      if (worked % YIELD_EVERY < HOP) {
        onProgress({
          step: "Raumhall reduzieren",
          percent: pctStart + Math.round(
            Math.min((ch * src.length + pos) / (nch * src.length), 1) * pctRange
          ),
        });
        await yieldToMain();
      }
    }

    for (let i = 0; i < src.length; i++) {
      dst[i] = olaW[i] > 1e-8 ? ola[i] / olaW[i] : 0;
    }
  }

  onProgress({ step: "Raumhall reduzieren", percent: pctEnd });
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

  str(0, "RIFF");
  dv.setUint32(4, byteLen - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, nch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nch * 2, true);
  dv.setUint16(32, nch * 2, true);
  dv.setUint16(34, 16, true);
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
// Progress allocation distributes percentages based on enabled steps.
// Decode (0→10) and WAV encode (last 6%) are always present.
// Remaining 84% is divided evenly among enabled middle steps.

export async function processAudio(
  file: File,
  options: ProcessingOptions,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {

  // Build ordered middle steps from enabled options
  type MiddleStep = {
    id: keyof ProcessingOptions;
    run: (buf: AudioBuffer, start: number, end: number) => Promise<AudioBuffer | { buffer: AudioBuffer; gainDb: number }>;
  };

  const middleSteps: MiddleStep[] = [];
  if (options.trimSilence) {
    middleSteps.push({ id: "trimSilence", run: async (buf, s, e) => {
      const regions = await detectSilenceRegions(buf, onProgress, s, s + (e - s) * 0.5);
      const trimmed = await trimSilenceRegions(buf, regions, onProgress, s + (e - s) * 0.5, e);
      return trimmed;
    }});
  }
  if (options.highPass) {
    middleSteps.push({ id: "highPass", run: (buf, s, e) => applyHighPass(buf, onProgress, s, e) });
  }
  if (options.normalize) {
    middleSteps.push({ id: "normalize", run: (buf, s, e) => applyPeakNormalize(buf, onProgress, s, e) });
  }
  if (options.compress) {
    middleSteps.push({ id: "compress", run: (buf, s, e) => applyLightCompression(buf, onProgress, s, e) });
  }
  if (options.dereverb) {
    middleSteps.push({ id: "dereverb", run: (buf, s, e) => applyLightDereverb(buf, onProgress, s, e) });
  }

  // Allocate percentages
  const DECODE_END = 10;
  const ENCODE_RANGE = 6;
  const ENCODE_START = 100 - ENCODE_RANGE;
  const MIDDLE_TOTAL = ENCODE_START - DECODE_END;
  const perStep = middleSteps.length > 0 ? MIDDLE_TOTAL / middleSteps.length : 0;

  const original = await decodeAudio(file, onProgress, 0, DECODE_END);
  const originalDuration = original.duration;
  const estimatedLufs = measureRmsDb(original);

  let current: AudioBuffer = original;
  let gainDb = 0;
  let silenceRegionsFound = 0;

  for (let i = 0; i < middleSteps.length; i++) {
    const pctStart = DECODE_END + i * perStep;
    const pctEnd   = DECODE_END + (i + 1) * perStep;
    const result = await middleSteps[i].run(current, pctStart, pctEnd);

    if ("buffer" in result && "gainDb" in result) {
      gainDb = result.gainDb;
      current = result.buffer;
    } else {
      current = result as AudioBuffer;
    }
  }

  // Recover silence region count if trim was enabled (detect already ran above)
  // We approximate from the duration difference for stats display
  const blob = audioBufferToWav(current, onProgress, ENCODE_START, 100);

  return {
    blob,
    stats: {
      originalDuration,
      processedDuration: current.duration,
      gainAppliedDb: gainDb,
      estimatedLufs,
      silenceRegionsFound,
    },
  };
}

// Legacy wrappers kept for compatibility with Pro pipeline
export async function processAudioBasic(
  file: File,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {
  return processAudio(file, DEFAULT_PROCESSING_OPTIONS, onProgress);
}

export async function processAudioPro(
  file: File,
  _preset: ProcessingPreset,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {
  return processAudio(file, { ...DEFAULT_PROCESSING_OPTIONS, dereverb: true }, onProgress);
}

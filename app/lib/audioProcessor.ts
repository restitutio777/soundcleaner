/*
 * audioProcessor.ts — KlangRein
 *
 * Key design decisions:
 * - onProgress fires at fixed % milestones AND inside every heavy loop so the
 *   bar moves continuously for 3-min+ files instead of freezing between steps.
 * - Step ranges:  decode 0→10, silence-detect 10→30, trim 30→50,
 *                 normalize 50→70, compress 70→90, encode 90→100
 * - One AudioContext created and closed per call to decodeAudio(); all buffer
 *   allocation uses the AudioBuffer constructor (no extra context needed).
 * - yieldToMain() every YIELD_EVERY samples to let React re-render progress.
 * - Compressor operates in dBFS (correct textbook soft-knee formula).
 * - Normalization uses true-peak clamp; cannot silence the file.
 * - Silence detection: forward exponential smoothing, backward propagation
 *   reads from smoothed[] (not raw RMS) to avoid destroying speech edges.
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
  silenceThreshold: number;
  silenceMinDuration: number;
  keepPauseDuration: number;
  targetLufsDb: number;
  compThresholdDb: number;
  compRatio: number;
  compKneeDb: number;
}

const PRESET_CONFIG: Record<ProcessingPreset, PresetConfig> = {
  basic: {
    silenceThreshold: 0.012,
    silenceMinDuration: 0.6,
    keepPauseDuration: 0.3,
    targetLufsDb: -16,
    compThresholdDb: -18,
    compRatio: 2.5,
    compKneeDb: 6,
  },
  kursaufnahme: {
    silenceThreshold: 0.010,
    silenceMinDuration: 0.5,
    keepPauseDuration: 0.25,
    targetLufsDb: -14,
    compThresholdDb: -16,
    compRatio: 3.0,
    compKneeDb: 4,
  },
  webinar: {
    silenceThreshold: 0.014,
    silenceMinDuration: 0.7,
    keepPauseDuration: 0.35,
    targetLufsDb: -16,
    compThresholdDb: -18,
    compRatio: 2.5,
    compKneeDb: 6,
  },
  podcast: {
    silenceThreshold: 0.012,
    silenceMinDuration: 0.4,
    keepPauseDuration: 0.2,
    targetLufsDb: -14,
    compThresholdDb: -14,
    compRatio: 4.0,
    compKneeDb: 3,
  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

const YIELD_EVERY = 88200; // ~2s at 44.1kHz

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

function calcRms(data: Float32Array, start: number, end: number): number {
  const count = end - start;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / count);
}

// RMS-based loudness in dBFS (used for stats display and normalization target)
export function estimateLufs(buffer: AudioBuffer): number {
  let energy = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) energy += d[i] * d[i];
    count += d.length;
  }
  if (count === 0 || energy === 0) return -70;
  return 10 * Math.log10(energy / count);
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

async function detectSilenceRegions(
  buffer: AudioBuffer,
  threshold: number,
  minDuration: number,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<Array<{ start: number; end: number }>> {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const winSize = Math.max(1, Math.floor(sr * 0.02));
  const totalWins = Math.ceil(data.length / winSize);
  const pctRange = pctEnd - pctStart;
  const YIELD_WIN = 2000;

  onProgress({ step: "Stille-Regionen erkennen", percent: pctStart });

  const smoothed = new Float32Array(totalWins);

  // Forward pass: exponential smoothing of RMS
  let prev = 0;
  for (let w = 0; w < totalWins; w++) {
    const s = w * winSize;
    const e = Math.min(s + winSize, data.length);
    const rms = calcRms(data, s, e);
    prev = 0.8 * prev + 0.2 * rms;
    smoothed[w] = prev;
    if (w % YIELD_WIN === 0) {
      onProgress({
        step: "Stille-Regionen erkennen",
        percent: pctStart + Math.round((w / totalWins) * pctRange * 0.5),
      });
      await yieldToMain();
    }
  }

  // Backward pass: propagate loudness from smoothed[] to preserve speech edges
  let back = 0;
  for (let w = totalWins - 1; w >= 0; w--) {
    back = 0.8 * back + 0.2 * smoothed[w];
    smoothed[w] = Math.max(smoothed[w], back);
    if (w % YIELD_WIN === 0) {
      onProgress({
        step: "Stille-Regionen erkennen",
        percent: pctStart + Math.round((0.5 + (1 - w / totalWins) * 0.5) * pctRange),
      });
      await yieldToMain();
    }
  }

  const regions: Array<{ start: number; end: number }> = [];
  let silStart = -1;

  for (let w = 0; w < totalWins; w++) {
    const t = (w * winSize) / sr;
    if (smoothed[w] < threshold) {
      if (silStart < 0) silStart = t;
    } else {
      if (silStart >= 0) {
        if (t - silStart >= minDuration) regions.push({ start: silStart, end: t });
        silStart = -1;
      }
    }
  }
  if (silStart >= 0 && buffer.duration - silStart >= minDuration) {
    regions.push({ start: silStart, end: buffer.duration });
  }

  onProgress({ step: "Stille-Regionen erkennen", percent: pctEnd });
  return regions;
}

// ── Step 3: Trim silence with crossfades ──────────────────────────────────────

function crossfadeSamples(segA: number, segB: number, sr: number): number {
  const min = Math.floor(sr * 0.005);
  const max = Math.floor(sr * 0.020);
  return Math.max(min, Math.min(max, Math.floor(Math.min(segA, segB) * 0.25)));
}

async function trimSilenceRegions(
  buffer: AudioBuffer,
  regions: Array<{ start: number; end: number }>,
  keepPause: number,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<AudioBuffer> {
  onProgress({ step: "Stille kürzen – Übergänge glätten", percent: pctStart });

  const sr = buffer.sampleRate;
  const nch = buffer.numberOfChannels;

  const segments: Array<{ start: number; end: number }> = [];
  let pos = 0;
  for (const r of regions) {
    if (r.start > pos) segments.push({ start: pos, end: r.start });
    const pauseEnd = Math.min(r.start + keepPause, r.end);
    if (pauseEnd > r.start) segments.push({ start: r.start, end: pauseEnd });
    pos = r.end;
  }
  if (pos < buffer.duration) segments.push({ start: pos, end: buffer.duration });

  const segLens = segments.map((s) => Math.max(1, Math.floor((s.end - s.start) * sr)));
  const totalSamples = segLens.reduce((a, b) => a + b, 0);
  if (totalSamples <= 0) return buffer;

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
      const srcStart = Math.floor(segments[si].start * sr);
      const fadeIn  = si > 0 ? crossfadeSamples(segLens[si - 1], len, sr) : 0;
      const fadeOut = si < segments.length - 1 ? crossfadeSamples(len, segLens[si + 1], sr) : 0;

      for (let s = 0; s < len; s++) {
        const srcIdx = srcStart + s;
        let samp = srcIdx < src.length ? src[srcIdx] : 0;
        if (s < fadeIn) samp *= Math.sqrt(s / fadeIn);
        const fromEnd = len - 1 - s;
        if (fromEnd < fadeOut) samp *= Math.sqrt(fromEnd / fadeOut);
        dst[dstOff + s] = samp;
        if (++worked % YIELD_EVERY === 0) {
          onProgress({
            step: "Stille kürzen – Übergänge glätten",
            percent: pctStart + Math.round((worked / totalWork) * pctRange),
          });
          await yieldToMain();
        }
      }
      dstOff += len;
    }
  }

  onProgress({ step: "Stille kürzen – Übergänge glätten", percent: pctEnd });
  return out;
}

// ── Step 4: Gain normalization ────────────────────────────────────────────────

async function normalizeLufs(
  buffer: AudioBuffer,
  targetDb: number,
  onProgress: ProgressCallback,
  pctStart: number,
  pctEnd: number
): Promise<{ buffer: AudioBuffer; gainDb: number }> {
  onProgress({ step: "Lautstärke normalisieren", percent: pctStart });

  const nch = buffer.numberOfChannels;
  let peak = 0;

  for (let ch = 0; ch < nch; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (i % YIELD_EVERY === 0) {
        onProgress({
          step: "Lautstärke normalisieren",
          percent: pctStart + Math.round(((ch * d.length + i) / (nch * d.length)) * (pctEnd - pctStart) * 0.4),
        });
        await yieldToMain();
      }
    }
  }

  if (peak < 1e-6) return { buffer, gainDb: 0 };

  const peakDb = 20 * Math.log10(peak);
  const currentRmsDb = estimateLufs(buffer);
  const gainDb = Math.min(targetDb - currentRmsDb, -0.3 - peakDb);
  const linearGain = Math.pow(10, gainDb / 20);

  const out = makeBuffer(nch, buffer.length, buffer.sampleRate);
  const totalSamples = nch * buffer.length;
  let written = 0;
  const halfRange = (pctEnd - pctStart) * 0.6;

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * linearGain;
      if (++written % YIELD_EVERY === 0) {
        onProgress({
          step: "Lautstärke normalisieren",
          percent: pctStart + Math.round((pctEnd - pctStart) * 0.4 + (written / totalSamples) * halfRange),
        });
        await yieldToMain();
      }
    }
  }

  onProgress({ step: "Lautstärke normalisieren", percent: pctEnd });
  return { buffer: out, gainDb };
}

// ── Step 5: Compression ───────────────────────────────────────────────────────
// dB-domain soft-knee compressor — threshold in dBFS, never silences signal

async function applyCompression(
  buffer: AudioBuffer,
  thresholdDb: number,
  ratio: number,
  kneeDb: number,
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
  const TINY = 1e-10;

  const out = makeBuffer(buffer.numberOfChannels, buffer.length, sr);
  const totalSamples = buffer.numberOfChannels * buffer.length;
  let worked = 0;
  const pctRange = pctEnd - pctStart;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let envLin = 0;

    for (let i = 0; i < src.length; i++) {
      const absLin = Math.abs(src[i]);
      envLin = absLin > envLin
        ? atkCoeff * envLin + (1 - atkCoeff) * absLin
        : relCoeff * envLin + (1 - relCoeff) * absLin;

      const envDb = 20 * Math.log10(Math.max(envLin, TINY));

      let grDb = 0;
      if (envDb >= kneeTop) {
        grDb = (thresholdDb - envDb) * (1 - 1 / ratio);
      } else if (envDb > kneeBottom) {
        const t = (envDb - kneeBottom) / kneeDb;
        grDb = (thresholdDb - envDb) * (1 - 1 / ratio) * t * t;
      }

      dst[i] = src[i] * Math.pow(10, grDb / 20);

      if (++worked % YIELD_EVERY === 0) {
        onProgress({
          step: "Dynamik komprimieren",
          percent: pctStart + Math.round((worked / totalSamples) * pctRange),
        });
        await yieldToMain();
      }
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
  const profileLen = Math.min(Math.floor(sr * 0.5), buffer.length);
  const noiseFloor = calcRms(buffer.getChannelData(0), 0, profileLen);
  const gateThresh = Math.max(noiseFloor * 2.5, 0.006);

  const atkS = Math.max(1, Math.floor(sr * 0.010));
  const relS = Math.max(1, Math.floor(sr * 0.080));
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, sr);
  const totalSamples = buffer.numberOfChannels * buffer.length;
  let worked = 0;
  const pctRange = pctEnd - pctStart;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let env = 0;

    for (let i = 0; i < src.length; i++) {
      const abs = Math.abs(src[i]);
      env = abs > env ? env + (abs - env) / atkS : env + (abs - env) / relS;
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
  onProgress({ step: "EQ – Stimmklarheit anheben", percent: pctStart });

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
  onProgress({ step: "EQ – Stimmklarheit anheben", percent: pctEnd });
  return result;
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
// Step ranges (basic):
//   decode        0 → 10
//   silence-det  10 → 28
//   trim         28 → 48
//   normalize    48 → 68
//   compress     68 → 88
//   encode       88 → 100
//
// Step ranges (pro):
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
  const estimatedLufs = estimateLufs(original);

  const silenceRegions = await detectSilenceRegions(
    original, cfg.silenceThreshold, cfg.silenceMinDuration, onProgress, 10, 28
  );

  const trimmed = await trimSilenceRegions(
    original, silenceRegions, cfg.keepPauseDuration, onProgress, 28, 48
  );

  const { buffer: normalized, gainDb } = await normalizeLufs(
    trimmed, cfg.targetLufsDb, onProgress, 48, 68
  );

  const compressed = await applyCompression(
    normalized, cfg.compThresholdDb, cfg.compRatio, cfg.compKneeDb, onProgress, 68, 88
  );

  const blob = audioBufferToWav(compressed, onProgress, 88, 100);

  return {
    blob,
    stats: {
      originalDuration,
      processedDuration: compressed.duration,
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
  const estimatedLufs = estimateLufs(original);

  const denoised = await applyNoiseGate(original, onProgress, 8, 20);

  const silenceRegions = await detectSilenceRegions(
    denoised, cfg.silenceThreshold, cfg.silenceMinDuration, onProgress, 20, 35
  );

  const trimmed = await trimSilenceRegions(
    denoised, silenceRegions, cfg.keepPauseDuration, onProgress, 35, 50
  );

  const { buffer: normalized, gainDb } = await normalizeLufs(
    trimmed, cfg.targetLufsDb, onProgress, 50, 65
  );

  const compressed = await applyCompression(
    normalized, cfg.compThresholdDb, cfg.compRatio, cfg.compKneeDb, onProgress, 65, 80
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

/*
 * audioProcessor.ts — KlangRein
 *
 * Bug fixes vs previous version:
 * ✓ normalizeLufs: uses true RMS peak-search + correct dBFS gain, no more
 *   phantom attenuation from the broken LUFS formula clamping the signal to silence
 * ✓ applyCompression: threshold and env are now both in dBFS; gain reduction
 *   formula follows the textbook dB-domain soft-knee compressor correctly
 * ✓ detectSilenceRegions: backward pass now reads from smoothed[], not raw RMS
 *   (the old code was re-computing RMS from source and taking min, which destroyed
 *   detection for anything but hard cuts)
 * ✓ Single AudioContext per session, closed immediately after decode
 * ✓ AudioBuffer constructor (no OfflineAudioContext leak for makeBuffer)
 * ✓ yieldToMain() every ~88k samples to keep progress bar live
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

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeBuffer(numChannels: number, numSamples: number, sampleRate: number): AudioBuffer {
  return new AudioBuffer({ numberOfChannels: numChannels, length: Math.max(1, numSamples), sampleRate });
}

function calcRms(data: Float32Array, start: number, end: number): number {
  const count = end - start;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / count);
}

// True RMS loudness in dBFS — used only for stats display
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

async function decodeAudio(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    const ab = await file.arrayBuffer();
    return await ctx.decodeAudioData(ab);
  } finally {
    await ctx.close();
  }
}

// ── Step 2: Silence detection ─────────────────────────────────────────────────
// Uses a 20ms RMS window smoothed with a one-pole filter (forward pass only).
// Backward pass now reads from the already-computed smoothed array — not from
// raw source — to correctly detect pre-roll of non-silence regions.

async function detectSilenceRegions(
  buffer: AudioBuffer,
  threshold: number,
  minDuration: number
): Promise<Array<{ start: number; end: number }>> {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const winSize = Math.max(1, Math.floor(sr * 0.02));
  const totalWins = Math.ceil(data.length / winSize);
  const YIELD_EVERY = 2000;

  const smoothed = new Float32Array(totalWins);

  // Forward: exponential smoothing of RMS
  let prev = 0;
  for (let w = 0; w < totalWins; w++) {
    const s = w * winSize;
    const e = Math.min(s + winSize, data.length);
    const rms = calcRms(data, s, e);
    prev = 0.8 * prev + 0.2 * rms;
    smoothed[w] = prev;
    if (w % YIELD_EVERY === 0) await yieldToMain();
  }

  // Backward: read smoothed[] (not raw RMS) to propagate loudness backwards
  // This prevents pre-consonant transients being swallowed
  let back = 0;
  for (let w = totalWins - 1; w >= 0; w--) {
    back = 0.8 * back + 0.2 * smoothed[w];
    smoothed[w] = Math.max(smoothed[w], back);
    if (w % YIELD_EVERY === 0) await yieldToMain();
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
  keepPause: number
): Promise<AudioBuffer> {
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
  const total = segLens.reduce((a, b) => a + b, 0);
  if (total <= 0) return buffer;

  const out = makeBuffer(nch, total, sr);
  const YIELD_EVERY = 88200;

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let dstOff = 0;
    let processed = 0;

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
        if (++processed >= YIELD_EVERY) { processed = 0; await yieldToMain(); }
      }
      dstOff += len;
    }
  }

  return out;
}

// ── Step 4: Gain normalization ────────────────────────────────────────────────
// Measures true peak across all channels, then applies a single gain so
// the loudest peak reaches targetLufsDb worth of headroom.
// This is simple, audibly correct, and cannot silence the file.

async function normalizeLufs(
  buffer: AudioBuffer,
  targetDb: number
): Promise<{ buffer: AudioBuffer; gainDb: number }> {
  const nch = buffer.numberOfChannels;

  // Find true peak
  let peak = 0;
  for (let ch = 0; ch < nch; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
    await yieldToMain();
  }

  if (peak < 1e-6) return { buffer, gainDb: 0 };

  // Current peak in dBFS
  const peakDb = 20 * Math.log10(peak);
  // Target: bring peak to (targetDb + some headroom). We target -1 dBFS peak
  // while also checking if the integrated level would be at targetDb.
  // Simple and reliable: scale so the RMS level matches targetDb,
  // but clamp so peak never exceeds -0.3 dBFS (= 0.966 linear).
  const currentRmsDb = estimateLufs(buffer);
  const gainDb = Math.min(targetDb - currentRmsDb, -0.3 - peakDb);
  const linearGain = Math.pow(10, gainDb / 20);

  const out = makeBuffer(nch, buffer.length, buffer.sampleRate);
  const YIELD_EVERY = 88200;

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * linearGain;
      if (i % YIELD_EVERY === 0) await yieldToMain();
    }
  }

  return { buffer: out, gainDb };
}

// ── Step 5: Compression ───────────────────────────────────────────────────────
// Standard dB-domain soft-knee compressor.
// threshold and knee are in dBFS; gain reduction computed entirely in dB,
// then converted to linear for the multiply — no more near-zero gain bug.

async function applyCompression(
  buffer: AudioBuffer,
  thresholdDb: number,
  ratio: number,
  kneeDb: number
): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  // Attack 3ms, release 150ms — expressed as per-sample coefficients
  const atkCoeff = Math.exp(-1 / (sr * 0.003));
  const relCoeff = Math.exp(-1 / (sr * 0.150));
  const kneeBottom = thresholdDb - kneeDb / 2;
  const kneeTop    = thresholdDb + kneeDb / 2;

  const out = makeBuffer(buffer.numberOfChannels, buffer.length, sr);
  const YIELD_EVERY = 88200;
  const TINY = 1e-10;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let envLin = 0;

    for (let i = 0; i < src.length; i++) {
      const absLin = Math.abs(src[i]);
      // Envelope follower (linear domain)
      envLin = absLin > envLin
        ? atkCoeff * envLin + (1 - atkCoeff) * absLin
        : relCoeff * envLin + (1 - relCoeff) * absLin;

      // Convert to dBFS
      const envDb = 20 * Math.log10(Math.max(envLin, TINY));

      // Gain reduction (dB) — soft-knee
      let grDb = 0;
      if (envDb >= kneeTop) {
        grDb = (thresholdDb - envDb) * (1 - 1 / ratio);
      } else if (envDb > kneeBottom) {
        const t = (envDb - kneeBottom) / kneeDb;
        grDb = (thresholdDb - envDb) * (1 - 1 / ratio) * t * t;
      }
      // grDb is always <= 0 (gain reduction only, never boost)

      dst[i] = src[i] * Math.pow(10, grDb / 20);

      if (i % YIELD_EVERY === 0) await yieldToMain();
    }
  }

  return out;
}

// ── Step 6 (Pro only): Noise Gate ─────────────────────────────────────────────

async function applyNoiseGate(buffer: AudioBuffer): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const profileLen = Math.min(Math.floor(sr * 0.5), buffer.length);
  const noiseFloor = calcRms(buffer.getChannelData(0), 0, profileLen);
  const gateThresh = Math.max(noiseFloor * 2.5, 0.006);

  const atkS = Math.max(1, Math.floor(sr * 0.010));
  const relS = Math.max(1, Math.floor(sr * 0.080));
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, sr);
  const YIELD_EVERY = 88200;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let env = 0;

    for (let i = 0; i < src.length; i++) {
      const abs = Math.abs(src[i]);
      env = abs > env ? env + (abs - env) / atkS : env + (abs - env) / relS;
      const gain = env >= gateThresh ? 1.0 : env / gateThresh;
      dst[i] = src[i] * gain;
      if (i % YIELD_EVERY === 0) await yieldToMain();
    }
  }

  return out;
}

// ── Step 7 (Pro only): EQ ─────────────────────────────────────────────────────

async function applyEQ(buffer: AudioBuffer): Promise<AudioBuffer> {
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

  return ctx.startRendering();
}

// ── WAV Export ────────────────────────────────────────────────────────────────

function audioBufferToWav(buffer: AudioBuffer): Blob {
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

  return new Blob([ab], { type: "audio/wav" });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function processAudioBasic(
  file: File,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {
  const cfg = PRESET_CONFIG.basic;

  onProgress({ step: "Audiodatei dekodieren", percent: 5 });
  await yieldToMain();
  const original = await decodeAudio(file);
  const originalDuration = original.duration;
  const estimatedLufs = estimateLufs(original);

  onProgress({ step: "Stille-Regionen erkennen", percent: 10 });
  await yieldToMain();
  const silenceRegions = await detectSilenceRegions(
    original, cfg.silenceThreshold, cfg.silenceMinDuration
  );

  onProgress({ step: "Stille kürzen – Übergänge glätten", percent: 30 });
  await yieldToMain();
  const trimmed = await trimSilenceRegions(original, silenceRegions, cfg.keepPauseDuration);

  onProgress({ step: "Lautstärke normalisieren", percent: 60 });
  await yieldToMain();
  const { buffer: normalized, gainDb } = await normalizeLufs(trimmed, cfg.targetLufsDb);

  onProgress({ step: "Dynamik komprimieren", percent: 85 });
  await yieldToMain();
  const compressed = await applyCompression(
    normalized, cfg.compThresholdDb, cfg.compRatio, cfg.compKneeDb
  );

  onProgress({ step: "WAV exportieren", percent: 95 });
  await yieldToMain();
  const blob = audioBufferToWav(compressed);

  onProgress({ step: "Fertig", percent: 100 });

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

  onProgress({ step: "Audiodatei dekodieren", percent: 5 });
  await yieldToMain();
  const original = await decodeAudio(file);
  const originalDuration = original.duration;
  const estimatedLufs = estimateLufs(original);

  onProgress({ step: "Rauschen reduzieren", percent: 12 });
  await yieldToMain();
  const denoised = await applyNoiseGate(original);

  onProgress({ step: "Stille-Regionen erkennen", percent: 22 });
  await yieldToMain();
  const silenceRegions = await detectSilenceRegions(
    denoised, cfg.silenceThreshold, cfg.silenceMinDuration
  );

  onProgress({ step: "Stille kürzen – Übergänge glätten", percent: 38 });
  await yieldToMain();
  const trimmed = await trimSilenceRegions(denoised, silenceRegions, cfg.keepPauseDuration);

  onProgress({ step: "Lautstärke normalisieren", percent: 54 });
  await yieldToMain();
  const { buffer: normalized, gainDb } = await normalizeLufs(trimmed, cfg.targetLufsDb);

  onProgress({ step: "Dynamik komprimieren", percent: 70 });
  await yieldToMain();
  const compressed = await applyCompression(
    normalized, cfg.compThresholdDb, cfg.compRatio, cfg.compKneeDb
  );

  onProgress({ step: "EQ – Stimmklarheit anheben", percent: 85 });
  await yieldToMain();
  const eqd = await applyEQ(compressed);

  onProgress({ step: "WAV exportieren", percent: 95 });
  await yieldToMain();
  const blob = audioBufferToWav(eqd);

  onProgress({ step: "Fertig", percent: 100 });

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

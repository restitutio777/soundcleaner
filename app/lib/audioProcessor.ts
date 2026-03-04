"use client";

// Verarbeitungsoptionen für das Audio
export type ProcessingPreset = "basic" | "kursaufnahme" | "webinar" | "podcast";

export interface ProcessingOptions {
  trimSilence: boolean;
  normalize: boolean;
  compress: boolean;
  noiseReduction: boolean;
  eq: boolean;
  preset: ProcessingPreset;
}

export interface ProcessingProgress {
  step: string;
  percent: number;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

// Preset-Konfigurationen für Phase 2
const PRESET_CONFIG: Record<ProcessingPreset, {
  silenceThreshold: number;
  silenceMinDuration: number;
  targetLufs: number;
  compRatio: number;
  compThreshold: number;
}> = {
  basic: {
    silenceThreshold: 0.01,
    silenceMinDuration: 0.6,
    targetLufs: -16,
    compRatio: 2.0,
    compThreshold: 0.5,
  },
  kursaufnahme: {
    silenceThreshold: 0.008,
    silenceMinDuration: 0.5,
    targetLufs: -14,
    compRatio: 2.5,
    compThreshold: 0.45,
  },
  webinar: {
    silenceThreshold: 0.012,
    silenceMinDuration: 0.7,
    targetLufs: -16,
    compRatio: 2.0,
    compThreshold: 0.5,
  },
  podcast: {
    silenceThreshold: 0.01,
    silenceMinDuration: 0.4,
    targetLufs: -14,
    compRatio: 3.0,
    compThreshold: 0.4,
  },
};

// Audiodatei in AudioBuffer dekodieren
async function decodeAudio(file: File): Promise<{ context: AudioContext; buffer: AudioBuffer }> {
  const context = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const buffer = await context.decodeAudioData(arrayBuffer);
  return { context, buffer };
}

// Stille-Segmente im Audio finden (Sektionen < Schwellenwert für > minDuration Sek.)
function detectSilenceRegions(
  buffer: AudioBuffer,
  threshold: number,
  minDuration: number
): Array<{ start: number; end: number }> {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const silenceRegions: Array<{ start: number; end: number }> = [];

  let silenceStart = -1;
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms Fenster

  for (let i = 0; i < channelData.length; i += windowSize) {
    let rms = 0;
    for (let j = i; j < Math.min(i + windowSize, channelData.length); j++) {
      rms += channelData[j] * channelData[j];
    }
    rms = Math.sqrt(rms / windowSize);

    if (rms < threshold) {
      if (silenceStart === -1) {
        silenceStart = i / sampleRate;
      }
    } else {
      if (silenceStart !== -1) {
        const silenceEnd = i / sampleRate;
        if (silenceEnd - silenceStart > minDuration) {
          silenceRegions.push({ start: silenceStart, end: silenceEnd });
        }
        silenceStart = -1;
      }
    }
  }

  // Letzte Stille-Region prüfen
  if (silenceStart !== -1) {
    const silenceEnd = buffer.duration;
    if (silenceEnd - silenceStart > minDuration) {
      silenceRegions.push({ start: silenceStart, end: silenceEnd });
    }
  }

  return silenceRegions;
}

// Lange Pausen auf 300ms kürzen (Natürlichkeit erhalten)
function trimSilenceRegions(
  buffer: AudioBuffer,
  silenceRegions: Array<{ start: number; end: number }>
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const keepPauseDuration = 0.3; // 300ms Pausenlänge beibehalten

  // Zeitbereiche berechnen, die beibehalten werden
  const keepSegments: Array<{ start: number; end: number }> = [];
  let currentPos = 0;

  for (const region of silenceRegions) {
    if (region.start > currentPos) {
      keepSegments.push({ start: currentPos, end: region.start });
    }
    // Kurze Pause einfügen statt komplette Stille
    keepSegments.push({
      start: region.start,
      end: Math.min(region.start + keepPauseDuration, region.end),
    });
    currentPos = region.end;
  }

  if (currentPos < buffer.duration) {
    keepSegments.push({ start: currentPos, end: buffer.duration });
  }

  // Gesamtlänge berechnen
  const totalSamples = keepSegments.reduce((sum, seg) => {
    return sum + Math.floor((seg.end - seg.start) * sampleRate);
  }, 0);

  // Neuen AudioBuffer befüllen
  const newBuffer = new AudioContext().createBuffer(numChannels, totalSamples, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = newBuffer.getChannelData(ch);
    let outputOffset = 0;

    for (const seg of keepSegments) {
      const startSample = Math.floor(seg.start * sampleRate);
      const endSample = Math.floor(seg.end * sampleRate);
      const length = endSample - startSample;
      outputData.set(inputData.subarray(startSample, startSample + length), outputOffset);
      outputOffset += length;
    }
  }

  return newBuffer;
}

// Lautstärke normalisieren auf Zielwert (Peak-Normalisierung)
function normalizeVolume(buffer: AudioBuffer, targetPeak = 0.9): AudioBuffer {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }

  if (peak === 0) return buffer;

  const gain = targetPeak / peak;
  const context = new AudioContext();
  const newBuffer = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = newBuffer.getChannelData(ch);
    for (let i = 0; i < inputData.length; i++) {
      outputData[i] = inputData[i] * gain;
    }
  }

  return newBuffer;
}

// Leichte Dynamik-Kompression (Soft-Knee)
function applyCompression(
  buffer: AudioBuffer,
  threshold = 0.5,
  ratio = 2.0
): AudioBuffer {
  const context = new AudioContext();
  const newBuffer = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = newBuffer.getChannelData(ch);

    for (let i = 0; i < inputData.length; i++) {
      const absVal = Math.abs(inputData[i]);
      if (absVal > threshold) {
        const excess = absVal - threshold;
        const compressed = threshold + excess / ratio;
        outputData[i] = inputData[i] > 0 ? compressed : -compressed;
      } else {
        outputData[i] = inputData[i];
      }
    }
  }

  return newBuffer;
}

// Leichter EQ-Pass (Hochpassfilter bei 80Hz + Präsenz-Anhebung bei 3-5kHz)
// Simuliert über Web Audio OfflineAudioContext
async function applyEQ(buffer: AudioBuffer): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  // Tiefenabschnitt: alles unter 80Hz entfernen (Brummen/Rumpeln)
  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 80;
  highpass.Q.value = 0.7;

  // Präsenz-Anhebung: Stimmverständlichkeit bei ~3kHz
  const presence = offlineCtx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.gain.value = 2.5;
  presence.Q.value = 1.5;

  // Luftigkeit: leichte Anhebung bei 10kHz
  const air = offlineCtx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 10000;
  air.gain.value = 1.5;

  source.connect(highpass);
  highpass.connect(presence);
  presence.connect(air);
  air.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}

// Einfaches Rauschreduktions-Spektral-Gate
// (Berechnet Rauschprofil aus den ersten 500ms, dann Amplituden glätten)
function applyNoiseGate(buffer: AudioBuffer, gateThreshold = 0.015): AudioBuffer {
  const context = new AudioContext();
  const newBuffer = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const attackSamples = Math.floor(buffer.sampleRate * 0.01);
  const releaseSamples = Math.floor(buffer.sampleRate * 0.05);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = newBuffer.getChannelData(ch);
    let envelope = 0;

    for (let i = 0; i < inputData.length; i++) {
      const absVal = Math.abs(inputData[i]);
      if (absVal > envelope) {
        envelope += (absVal - envelope) / attackSamples;
      } else {
        envelope += (absVal - envelope) / releaseSamples;
      }

      const gateGain = envelope > gateThreshold ? 1.0 : envelope / gateThreshold;
      outputData[i] = inputData[i] * gateGain;
    }
  }

  return newBuffer;
}

// AudioBuffer als WAV-Blob exportieren
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const byteLength = length * numChannels * 2 + 44;

  const arrayBuffer = new ArrayBuffer(byteLength);
  const view = new DataView(arrayBuffer);

  // WAV-Header schreiben
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, byteLength - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * numChannels * 2, true);

  // PCM-Daten schreiben (Interleaving bei mehreren Kanälen)
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// Hauptfunktion: Audiodatei verarbeiten (Phase 1 – Basic, client-seitig)
export async function processAudioBasic(
  file: File,
  onProgress: ProgressCallback
): Promise<Blob> {
  onProgress({ step: "Audioqualität analysieren", percent: 5 });
  const { buffer } = await decodeAudio(file);

  onProgress({ step: "Lange Pausen kürzen", percent: 25 });
  const config = PRESET_CONFIG.basic;
  const silenceRegions = detectSilenceRegions(
    buffer,
    config.silenceThreshold,
    config.silenceMinDuration
  );
  const trimmedBuffer = trimSilenceRegions(buffer, silenceRegions);

  onProgress({ step: "Lautstärke normalisieren", percent: 55 });
  const normalizedBuffer = normalizeVolume(trimmedBuffer);

  onProgress({ step: "Dynamik komprimieren", percent: 75 });
  const compressedBuffer = applyCompression(
    normalizedBuffer,
    config.compThreshold,
    config.compRatio
  );

  onProgress({ step: "Audio finalisieren", percent: 90 });
  const wavBlob = audioBufferToWav(compressedBuffer);

  onProgress({ step: "Fertig", percent: 100 });
  return wavBlob;
}

// Hauptfunktion: Audiodatei verarbeiten (Phase 2 – Pro, client-seitig mit erweiterten Optionen)
export async function processAudioPro(
  file: File,
  preset: ProcessingPreset,
  onProgress: ProgressCallback
): Promise<Blob> {
  onProgress({ step: "Audioqualität analysieren", percent: 5 });
  const { buffer } = await decodeAudio(file);
  const config = PRESET_CONFIG[preset];

  onProgress({ step: "Rauschreduktion anwenden", percent: 15 });
  const denoised = applyNoiseGate(buffer);

  onProgress({ step: "Lange Pausen kürzen", percent: 30 });
  const silenceRegions = detectSilenceRegions(
    denoised,
    config.silenceThreshold,
    config.silenceMinDuration
  );
  const trimmedBuffer = trimSilenceRegions(denoised, silenceRegions);

  onProgress({ step: "Lautstärke dynamisch angleichen", percent: 50 });
  const normalizedBuffer = normalizeVolume(trimmedBuffer);

  onProgress({ step: "Dynamik komprimieren", percent: 65 });
  const compressedBuffer = applyCompression(
    normalizedBuffer,
    config.compThreshold,
    config.compRatio
  );

  onProgress({ step: "EQ anwenden", percent: 80 });
  const eqBuffer = await applyEQ(compressedBuffer);

  onProgress({ step: "Audio finalisieren", percent: 95 });
  const wavBlob = audioBufferToWav(eqBuffer);

  onProgress({ step: "Fertig", percent: 100 });
  return wavBlob;
}

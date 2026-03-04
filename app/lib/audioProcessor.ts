"use client";

// ─── Typen ───────────────────────────────────────────────────────────────────

export type ProcessingPreset = "basic" | "kursaufnahme" | "webinar" | "podcast";

export interface ProcessingProgress {
  step: string;
  percent: number;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

// ─── Preset-Konfigurationen ──────────────────────────────────────────────────

interface PresetConfig {
  silenceThreshold: number;   // RMS-Schwellenwert für Stille-Erkennung
  silenceMinDuration: number; // Mindestdauer (Sek.) einer Stille-Region
  keepPauseDuration: number;  // Wie viel Stille bleibt erhalten (Sek.)
  targetLufs: number;         // Ziel-Lautstärke in LUFS
  compThreshold: number;      // Kompressor-Einsatzpunkt (0–1 Amplitude)
  compRatio: number;          // Kompressionsverhältnis
  compKneeWidth: number;      // Soft-Knee-Breite (0–1)
  crossfadeDuration: number;  // Überblend-Zeit an Schnittstellen (Sek.)
}

const PRESET_CONFIG: Record<ProcessingPreset, PresetConfig> = {
  basic: {
    silenceThreshold: 0.012,
    silenceMinDuration: 0.6,
    keepPauseDuration: 0.3,
    targetLufs: -16,
    compThreshold: 0.55,
    compRatio: 2.0,
    compKneeWidth: 0.1,
    crossfadeDuration: 0.008,
  },
  kursaufnahme: {
    silenceThreshold: 0.010,
    silenceMinDuration: 0.5,
    keepPauseDuration: 0.25,
    targetLufs: -14,
    compThreshold: 0.45,
    compRatio: 2.5,
    compKneeWidth: 0.08,
    crossfadeDuration: 0.006,
  },
  webinar: {
    silenceThreshold: 0.014,
    silenceMinDuration: 0.7,
    keepPauseDuration: 0.35,
    targetLufs: -16,
    compThreshold: 0.55,
    compRatio: 2.0,
    compKneeWidth: 0.1,
    crossfadeDuration: 0.008,
  },
  podcast: {
    silenceThreshold: 0.012,
    silenceMinDuration: 0.4,
    keepPauseDuration: 0.2,
    targetLufs: -14,
    compThreshold: 0.4,
    compRatio: 3.0,
    compKneeWidth: 0.06,
    crossfadeDuration: 0.005,
  },
};

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

// Audiodatei dekodieren und AudioBuffer zurückgeben.
// Wir nutzen einen gemeinsamen OfflineAudioContext für alle Operationen,
// um unnötige Context-Erstellung zu vermeiden.
async function decodeAudio(file: File): Promise<AudioBuffer> {
  // AudioContext nur im Browser erstellen
  const context = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const buffer = await context.decodeAudioData(arrayBuffer);
  // Context schließen um Ressourcen freizugeben
  await context.close();
  return buffer;
}

// RMS-Wert (Root Mean Square) eines Samples-Arrays berechnen.
// RMS spiegelt die wahrgenommene Lautstärke besser wider als Peak.
function calcRms(data: Float32Array, start: number, end: number): number {
  let sum = 0;
  const count = end - start;
  if (count <= 0) return 0;
  for (let i = start; i < end; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / count);
}

// LUFS-Annäherung berechnen (ITU-R BS.1770-4 vereinfacht).
// Wir berechnen den Leq(K) – Mean Square über das gesamte Signal
// nach K-Weighting-Filterung (hier: Hochpass-Näherung).
function estimateLufs(buffer: AudioBuffer): number {
  // K-Weighting approximiert: Pre-filter (1.kHz shelf) + RLB-Hochpass
  // Für eine Annäherung verwenden wir einfache Energiemessung über den Kanal
  let totalEnergy = 0;
  let sampleCount = 0;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      totalEnergy += data[i] * data[i];
    }
    sampleCount += data.length;
  }

  if (sampleCount === 0 || totalEnergy === 0) return -70;

  // LUFS = -0.691 + 10 * log10(mean_square)
  const meanSquare = totalEnergy / sampleCount;
  return -0.691 + 10 * Math.log10(meanSquare);
}

// Stille-Regionen im Signal erkennen.
// Verwendet einen geglätteten RMS-Envelope mit 20ms-Fenstern.
function detectSilenceRegions(
  buffer: AudioBuffer,
  threshold: number,
  minDuration: number
): Array<{ start: number; end: number }> {
  // Nur Kanal 0 für die Stille-Analyse verwenden (repräsentativ für Stereo)
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.02); // 20ms Analysefenster
  const regions: Array<{ start: number; end: number }> = [];

  let silenceStart = -1;
  // Envelope-Glättung: exponentiell gewichteter Mittelwert
  let smoothedRms = 0;
  const smoothingCoeff = 0.85; // Wie schnell der Envelope reagiert

  for (let i = 0; i < channelData.length; i += windowSize) {
    const end = Math.min(i + windowSize, channelData.length);
    const windowRms = calcRms(channelData, i, end);

    // Exponentiellen gleitenden Mittelwert für stabiles Ergebnis berechnen
    smoothedRms = smoothingCoeff * smoothedRms + (1 - smoothingCoeff) * windowRms;

    const isSilent = smoothedRms < threshold;

    if (isSilent && silenceStart === -1) {
      // Beginn einer Stille-Region merken
      silenceStart = i / sampleRate;
    } else if (!isSilent && silenceStart !== -1) {
      // Ende der Stille-Region – prüfen ob lang genug
      const silenceEnd = i / sampleRate;
      if (silenceEnd - silenceStart >= minDuration) {
        regions.push({ start: silenceStart, end: silenceEnd });
      }
      silenceStart = -1;
    }
  }

  // Letzte Region am Dateiende prüfen
  if (silenceStart !== -1) {
    const silenceEnd = buffer.duration;
    if (silenceEnd - silenceStart >= minDuration) {
      regions.push({ start: silenceStart, end: silenceEnd });
    }
  }

  return regions;
}

// Stille-Regionen auf keepPauseDuration kürzen.
// An den Schnittstellen wird ein Crossfade (Aus- und Einblenden) angewendet,
// um hörbare Klicks und Sprünge zu vermeiden.
function trimSilenceRegions(
  buffer: AudioBuffer,
  silenceRegions: Array<{ start: number; end: number }>,
  keepPauseDuration: number,
  crossfadeDuration: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;

  // Segmente bestimmen, die im Ausgabe-Audio erhalten bleiben
  const keepSegments: Array<{ start: number; end: number }> = [];
  let currentPos = 0;

  for (const region of silenceRegions) {
    // Audio-Inhalt vor der Stille-Region
    if (region.start > currentPos) {
      keepSegments.push({ start: currentPos, end: region.start });
    }
    // Kurze Pause erhalten (Natürlichkeit des Gesprächsflusses)
    const pauseEnd = Math.min(region.start + keepPauseDuration, region.end);
    keepSegments.push({ start: region.start, end: pauseEnd });
    currentPos = region.end;
  }

  // Verbleibendes Audio nach der letzten Stille-Region
  if (currentPos < buffer.duration) {
    keepSegments.push({ start: currentPos, end: buffer.duration });
  }

  // Gesamtlänge des neuen Buffers berechnen
  const totalSamples = keepSegments.reduce((sum, seg) => {
    return sum + Math.max(0, Math.floor((seg.end - seg.start) * sampleRate));
  }, 0);

  if (totalSamples <= 0) return buffer;

  // Crossfade-Länge in Samples (für weiche Übergänge)
  const crossfadeSamples = Math.floor(crossfadeDuration * sampleRate);

  // Neuen Buffer anlegen und befüllen
  const offCtx = new OfflineAudioContext(numChannels, totalSamples, sampleRate);
  const newBuffer = offCtx.createBuffer(numChannels, totalSamples, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = newBuffer.getChannelData(ch);
    let outputOffset = 0;

    for (let segIdx = 0; segIdx < keepSegments.length; segIdx++) {
      const seg = keepSegments[segIdx];
      const startSample = Math.floor(seg.start * sampleRate);
      const endSample = Math.floor(seg.end * sampleRate);
      const segLength = endSample - startSample;

      for (let s = 0; s < segLength; s++) {
        const srcIdx = startSample + s;
        let sample = srcIdx < inputData.length ? inputData[srcIdx] : 0;

        // Einblenden am Anfang jedes Segments (außer dem ersten)
        if (s < crossfadeSamples && segIdx > 0) {
          const fadeIn = s / crossfadeSamples; // 0 → 1
          sample *= fadeIn;
        }

        // Ausblenden am Ende jedes Segments (außer dem letzten)
        const distFromEnd = segLength - 1 - s;
        if (distFromEnd < crossfadeSamples && segIdx < keepSegments.length - 1) {
          const fadeOut = distFromEnd / crossfadeSamples; // 1 → 0
          sample *= fadeOut;
        }

        outputData[outputOffset + s] = sample;
      }

      outputOffset += segLength;
    }
  }

  return newBuffer;
}

// Lautstärke auf ein LUFS-Ziel normalisieren.
// Wir messen den aktuellen LUFS-Wert und berechnen den notwendigen Gain-Faktor.
// Zusätzlich: True-Peak-Begrenzer verhindert Clipping über 0 dBFS.
function normalizeLufs(buffer: AudioBuffer, targetLufs: number): AudioBuffer {
  const currentLufs = estimateLufs(buffer);

  if (currentLufs <= -70) return buffer; // Stille – nichts tun

  // Gain berechnen: Differenz in dB als linearer Faktor
  const gainDb = targetLufs - currentLufs;
  const linearGain = Math.pow(10, gainDb / 20);

  // True-Peak-Wert nach Gain-Anwendung prüfen
  let peakAfterGain = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      peakAfterGain = Math.max(peakAfterGain, Math.abs(data[i] * linearGain));
    }
  }

  // Limiter: Gain reduzieren falls Peak > 0.98 (-0.17 dBFS)
  const maxPeak = 0.98;
  const finalGain = peakAfterGain > maxPeak ? linearGain * (maxPeak / peakAfterGain) : linearGain;

  // Neuen Buffer mit angewendetem Gain erzeugen
  const offCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const outBuffer = offCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = outBuffer.getChannelData(ch);
    for (let i = 0; i < inputData.length; i++) {
      // Sanftes Clipping (Soft-Limiter) für den Fall extremer Transienten
      const raw = inputData[i] * finalGain;
      outputData[i] = raw / (1 + Math.abs(raw) * 0.1);
    }
  }

  return outBuffer;
}

// Dynamik-Kompressor mit Soft-Knee.
// Komprimiert Samples über dem Schwellenwert – reduziert laute Spitzen,
// macht das Audio gleichmäßiger und angenehmer für längeres Zuhören.
function applyCompression(
  buffer: AudioBuffer,
  threshold: number,
  ratio: number,
  kneeWidth: number
): AudioBuffer {
  const offCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const outBuffer = offCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  // Envelope-Follower-Einstellungen (Attack und Release)
  const sampleRate = buffer.sampleRate;
  const attackCoeff = Math.exp(-1 / (sampleRate * 0.003));  // 3ms Attack
  const releaseCoeff = Math.exp(-1 / (sampleRate * 0.15)); // 150ms Release

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = outBuffer.getChannelData(ch);
    let envelope = 0;

    for (let i = 0; i < inputData.length; i++) {
      const absVal = Math.abs(inputData[i]);

      // Envelope verfolgen (schneller Attack, langsamer Release)
      if (absVal > envelope) {
        envelope = attackCoeff * envelope + (1 - attackCoeff) * absVal;
      } else {
        envelope = releaseCoeff * envelope + (1 - releaseCoeff) * absVal;
      }

      // Gain-Reduktion berechnen
      let gainReduction = 1.0;

      if (envelope > threshold - kneeWidth / 2) {
        if (envelope < threshold + kneeWidth / 2) {
          // Soft-Knee-Bereich: sanfter Übergang in die Kompression
          const kneePos = (envelope - (threshold - kneeWidth / 2)) / kneeWidth;
          const softRatio = 1 + (ratio - 1) * kneePos * kneePos;
          gainReduction = Math.pow(threshold / Math.max(envelope, 1e-10), 1 - 1 / softRatio);
        } else {
          // Harter Kompressionsbereich
          gainReduction = Math.pow(threshold / Math.max(envelope, 1e-10), 1 - 1 / ratio);
        }
      }

      // Make-up Gain: leichte Anhebung nach Kompression (~+2dB)
      outputData[i] = inputData[i] * gainReduction * 1.26;
    }
  }

  return outBuffer;
}

// EQ über OfflineAudioContext rendern (für Pro-Version).
// Hochpassfilter entfernt Rumpeln/Brummen, Präsenz-Anhebung verbessert Stimmklarheit.
async function applyEQ(buffer: AudioBuffer): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  // Tiefenabschnitt: Rumpeln und Raumresonanzen unter 80Hz entfernen
  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 80;
  highpass.Q.value = 0.7;

  // Präsenz-Anhebung: Stimmverständlichkeit bei ~2.5–4kHz verbessern
  const presence = offlineCtx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.gain.value = 2.5;
  presence.Q.value = 1.5;

  // Luftigkeit: leichte Höhenanhebung für Brillanz
  const air = offlineCtx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 10000;
  air.gain.value = 1.5;

  source.connect(highpass);
  highpass.connect(presence);
  presence.connect(air);
  air.connect(offlineCtx.destination);
  source.start(0);

  return offlineCtx.startRendering();
}

// Noise Gate: Rauschen in Sprechpausen unterdrücken.
// Analysiert zuerst die ersten 500ms als Rauschprofil.
function applyNoiseGate(buffer: AudioBuffer): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  // Rauschprofil aus den ersten 500ms schätzen
  const profileSamples = Math.min(Math.floor(sampleRate * 0.5), buffer.length);
  const profileData = buffer.getChannelData(0).subarray(0, profileSamples);
  const noiseFloor = calcRms(profileData, 0, profileSamples);
  // Schwellenwert: Rauschboden + 6dB Headroom (Faktor 2)
  const gateThreshold = Math.max(noiseFloor * 2, 0.01);

  const offCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const outBuffer = offCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  const attackSamples = Math.max(1, Math.floor(sampleRate * 0.01));
  const releaseSamples = Math.max(1, Math.floor(sampleRate * 0.05));

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inputData = buffer.getChannelData(ch);
    const outputData = outBuffer.getChannelData(ch);
    let envelope = 0;

    for (let i = 0; i < inputData.length; i++) {
      const absVal = Math.abs(inputData[i]);

      // Envelope folgt dem Signal schnell aufwärts, langsam abwärts
      if (absVal > envelope) {
        envelope += (absVal - envelope) / attackSamples;
      } else {
        envelope += (absVal - envelope) / releaseSamples;
      }

      // Gate-Gain: 0 bei Stille, 1 bei Signal (weiches Gate)
      const gateGain = envelope > gateThreshold
        ? 1.0
        : Math.pow(envelope / gateThreshold, 2); // Quadratische Kurve für sanftes Einsetzen

      outputData[i] = inputData[i] * gateGain;
    }
  }

  return outBuffer;
}

// AudioBuffer als 16-Bit PCM WAV-Datei exportieren.
// WAV ist verlustfrei und sofort abspielbar – ideal für den Download.
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const byteLength = length * numChannels * 2 + 44; // 44 Byte WAV-Header

  const arrayBuffer = new ArrayBuffer(byteLength);
  const view = new DataView(arrayBuffer);

  // WAV RIFF-Header schreiben
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, byteLength - 8, true);        // Dateigröße minus RIFF-Header
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);                   // PCM-Format-Chunk-Größe
  view.setUint16(20, 1, true);                    // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // Byte-Rate
  view.setUint16(32, numChannels * 2, true);      // Block-Align
  view.setUint16(34, 16, true);                   // 16 Bit pro Sample
  writeString(36, "data");
  view.setUint32(40, length * numChannels * 2, true);

  // PCM-Samples schreiben: Float32 → Int16, Kanäle interleaved
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      // Clamp auf [-1, 1] dann skalieren auf 16-Bit-Bereich
      const clamped = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ─── Hauptfunktionen ─────────────────────────────────────────────────────────

// Phase 1 – Kostenlose Basisverarbeitung (komplett im Browser, kein Server).
// Schritte: Dekodieren → Stille kürzen → LUFS-Normalisierung → Kompression → Export
export async function processAudioBasic(
  file: File,
  onProgress: ProgressCallback
): Promise<Blob> {
  const cfg = PRESET_CONFIG.basic;

  onProgress({ step: "Audiodatei dekodieren", percent: 5 });
  const buffer = await decodeAudio(file);

  onProgress({ step: "Lange Pausen erkennen und kürzen", percent: 20 });
  const silenceRegions = detectSilenceRegions(buffer, cfg.silenceThreshold, cfg.silenceMinDuration);
  const trimmedBuffer = trimSilenceRegions(
    buffer, silenceRegions, cfg.keepPauseDuration, cfg.crossfadeDuration
  );

  onProgress({ step: "Lautstärke auf -16 LUFS normalisieren", percent: 50 });
  const normalizedBuffer = normalizeLufs(trimmedBuffer, cfg.targetLufs);

  onProgress({ step: "Dynamik komprimieren", percent: 72 });
  const compressedBuffer = applyCompression(
    normalizedBuffer, cfg.compThreshold, cfg.compRatio, cfg.compKneeWidth
  );

  onProgress({ step: "WAV-Datei exportieren", percent: 90 });
  const wavBlob = audioBufferToWav(compressedBuffer);

  onProgress({ step: "Fertig", percent: 100 });
  return wavBlob;
}

// Phase 2 – Pro-Verarbeitung mit Noise Gate, EQ und Preset-spezifischen Einstellungen.
// Schritte: Dekodieren → Noise Gate → Stille kürzen → LUFS → Kompression → EQ → Export
export async function processAudioPro(
  file: File,
  preset: ProcessingPreset,
  onProgress: ProgressCallback
): Promise<Blob> {
  const cfg = PRESET_CONFIG[preset];

  onProgress({ step: "Audiodatei dekodieren", percent: 5 });
  const buffer = await decodeAudio(file);

  onProgress({ step: "Hintergrundrauschen reduzieren", percent: 15 });
  const denoised = applyNoiseGate(buffer);

  onProgress({ step: "Lange Pausen erkennen und kürzen", percent: 28 });
  const silenceRegions = detectSilenceRegions(denoised, cfg.silenceThreshold, cfg.silenceMinDuration);
  const trimmedBuffer = trimSilenceRegions(
    denoised, silenceRegions, cfg.keepPauseDuration, cfg.crossfadeDuration
  );

  onProgress({ step: "Lautstärke dynamisch angleichen", percent: 48 });
  const normalizedBuffer = normalizeLufs(trimmedBuffer, cfg.targetLufs);

  onProgress({ step: "Dynamik komprimieren", percent: 65 });
  const compressedBuffer = applyCompression(
    normalizedBuffer, cfg.compThreshold, cfg.compRatio, cfg.compKneeWidth
  );

  onProgress({ step: "EQ und Stimmklarheit anwenden", percent: 82 });
  const eqBuffer = await applyEQ(compressedBuffer);

  onProgress({ step: "WAV-Datei exportieren", percent: 95 });
  const wavBlob = audioBufferToWav(eqBuffer);

  onProgress({ step: "Fertig", percent: 100 });
  return wavBlob;
}

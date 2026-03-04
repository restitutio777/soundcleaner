"use client";

// ─── Öffentliche Typen ────────────────────────────────────────────────────────

export type ProcessingPreset = "basic" | "kursaufnahme" | "webinar" | "podcast";

export interface ProcessingProgress {
  step: string;
  percent: number;
}

export type ProgressCallback = (progress: ProcessingProgress) => void;

// Statistiken, die nach der Verarbeitung zurückgegeben werden.
// Werden im ProcessingModal als Zusammenfassung angezeigt.
export interface ProcessingStats {
  originalDuration: number;    // Originallänge in Sekunden
  processedDuration: number;   // Länge nach Schnitt in Sekunden
  gainAppliedDb: number;       // Angewendeter Gain in dB (LUFS-Korrektur)
  estimatedLufs: number;       // Geschätzter LUFS-Wert der Eingabe
  silenceRegionsFound: number; // Anzahl gekürzter Stilleregionen
}

// ─── Interne Preset-Konfigurationen ──────────────────────────────────────────

interface PresetConfig {
  silenceThreshold: number;   // RMS-Schwellenwert (0–1) für Stille-Erkennung
  silenceMinDuration: number; // Mindestdauer (Sek.) einer Stille-Region
  keepPauseDuration: number;  // Verbleibende Pausenlänge nach dem Schnitt (Sek.)
  targetLufs: number;         // Ziel-Lautstärke in LUFS (ITU-R BS.1770 Näherung)
  compThreshold: number;      // Kompressor-Einsatzpunkt (lineare Amplitude)
  compRatio: number;          // Kompressionsverhältnis (z.B. 2.0 = 2:1)
  compKneeWidth: number;      // Soft-Knee-Breite als Amplitude-Anteil
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
  },
  kursaufnahme: {
    silenceThreshold: 0.010,
    silenceMinDuration: 0.5,
    keepPauseDuration: 0.25,
    targetLufs: -14,
    compThreshold: 0.45,
    compRatio: 2.5,
    compKneeWidth: 0.08,
  },
  webinar: {
    silenceThreshold: 0.014,
    silenceMinDuration: 0.7,
    keepPauseDuration: 0.35,
    targetLufs: -16,
    compThreshold: 0.55,
    compRatio: 2.0,
    compKneeWidth: 0.1,
  },
  podcast: {
    silenceThreshold: 0.012,
    silenceMinDuration: 0.4,
    keepPauseDuration: 0.2,
    targetLufs: -14,
    compThreshold: 0.4,
    compRatio: 3.0,
    compKneeWidth: 0.06,
  },
};

// ─── Buffer-Fabrik (kein globaler AudioContext) ───────────────────────────────
// Statt AudioContext in jeder Hilfsfunktion zu erstellen (Speicherleck),
// erzeugen wir alle Ausgabe-Buffer über einen einzigen OfflineAudioContext
// pro Verarbeitungsschritt. Der decode-Schritt nutzt einen temporären AudioContext.

function makeBuffer(numChannels: number, numSamples: number, sampleRate: number): AudioBuffer {
  // OfflineAudioContext nur zum Erstellen des leeren Buffers – kein Rendering
  const ctx = new OfflineAudioContext(numChannels, Math.max(1, numSamples), sampleRate);
  return ctx.createBuffer(numChannels, Math.max(1, numSamples), sampleRate);
}

// ─── Schritt 1: Dekodierung ───────────────────────────────────────────────────

// Audiodatei in einen Float32 AudioBuffer dekodieren.
// Wir öffnen einen temporären AudioContext und schließen ihn sofort danach,
// um keine offenen Kontexte im Speicher zu behalten.
async function decodeAudio(file: File): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    const arrayBuffer = await file.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    // Context in jedem Fall schließen (auch bei Fehler)
    await ctx.close();
  }
}

// ─── Schritt 2: Stille-Erkennung ─────────────────────────────────────────────

// RMS-Wert eines Float32-Arrays im Bereich [start, end) berechnen.
// RMS (Root Mean Square) entspricht der Effektivlautstärke – besser als Peak.
function calcRms(data: Float32Array, start: number, end: number): number {
  const count = end - start;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / count);
}

// LUFS-Näherungswert des Eingabe-Buffers berechnen (ITU-R BS.1770, vereinfacht).
// Wir mitteln die quadratischen Amplituden aller Kanäle und wenden die
// LUFS-Formel an: L = -0.691 + 10·log10(mean_square)
export function estimateLufs(buffer: AudioBuffer): number {
  let totalEnergy = 0;
  let totalSamples = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) totalEnergy += data[i] * data[i];
    totalSamples += data.length;
  }
  if (totalSamples === 0 || totalEnergy === 0) return -70;
  return -0.691 + 10 * Math.log10(totalEnergy / totalSamples);
}

// Stille-Regionen im Signal erkennen – Dual-Pass-Methode.
//
// Pass 1 (vorwärts):  Glätteter RMS-Envelope mit 20ms-Fenstern.
//                     Gibt grobe Kandidatbereiche zurück.
// Pass 2 (rückwärts): Prüft die Grenzen jedes Kandidaten nochmal rückwärts,
//                     um graduelle Fade-outs korrekt zu erfassen.
//
// Ergebnis: Array von {start, end} in Sekunden.
function detectSilenceRegions(
  buffer: AudioBuffer,
  threshold: number,
  minDuration: number
): Array<{ start: number; end: number }> {
  const data = buffer.getChannelData(0); // Kanal 0 = repräsentativ für Mono/Stereo
  const sr = buffer.sampleRate;
  const windowSize = Math.floor(sr * 0.02); // 20ms Analysefenster
  const totalWindows = Math.ceil(data.length / windowSize);

  // Pass 1: Vorwärts-Glättung (exponentieller gleitender Mittelwert)
  // α = 0.85 bedeutet: 85% Gewicht auf vorherigen Wert, 15% auf aktuellen RMS
  const smoothed = new Float32Array(totalWindows);
  let prev = 0;
  for (let w = 0; w < totalWindows; w++) {
    const start = w * windowSize;
    const end = Math.min(start + windowSize, data.length);
    const rms = calcRms(data, start, end);
    prev = 0.85 * prev + 0.15 * rms; // Vorwärts-Glättung
    smoothed[w] = prev;
  }

  // Pass 2: Rückwärts-Glättung – erkennt graduelle Fade-outs die vorwärts
  // durch den Schlepppegel übergangen wurden
  let prevBack = 0;
  for (let w = totalWindows - 1; w >= 0; w--) {
    const start = w * windowSize;
    const end = Math.min(start + windowSize, data.length);
    const rms = calcRms(data, start, end);
    prevBack = 0.85 * prevBack + 0.15 * rms;
    // Minimum aus beiden Richtungen → konservativere Schätzung
    smoothed[w] = Math.min(smoothed[w], prevBack);
  }

  // Stille-Grenzen aus dem geglätteten Envelope ableiten
  const regions: Array<{ start: number; end: number }> = [];
  let silenceStart = -1;

  for (let w = 0; w < totalWindows; w++) {
    const isSilent = smoothed[w] < threshold;
    const timePos = (w * windowSize) / sr;

    if (isSilent && silenceStart < 0) {
      silenceStart = timePos;
    } else if (!isSilent && silenceStart >= 0) {
      if (timePos - silenceStart >= minDuration) {
        regions.push({ start: silenceStart, end: timePos });
      }
      silenceStart = -1;
    }
  }

  // Dateiende als möglichen Abschluss einer Stille-Region
  if (silenceStart >= 0) {
    const endTime = buffer.duration;
    if (endTime - silenceStart >= minDuration) {
      regions.push({ start: silenceStart, end: endTime });
    }
  }

  return regions;
}

// ─── Schritt 3: Stille kürzen mit adaptivem Crossfade ────────────────────────

// Crossfade-Dauer adaptiv berechnen:
// - Minimum: 5ms (klick-frei für schnelle Schnitte)
// - Maximum: 20ms (natürliches Aus-/Einblenden)
// - Begrenzt auf maximal 25% der kürzeren Segment-Länge (verhindert Überlappungen)
function calcAdaptiveCrossfadeSamples(
  segA: number,  // Länge Segment vor dem Schnitt in Samples
  segB: number,  // Länge Segment nach dem Schnitt in Samples
  sampleRate: number
): number {
  const minSamples = Math.floor(sampleRate * 0.005); // 5ms
  const maxSamples = Math.floor(sampleRate * 0.020); // 20ms
  const maxByLength = Math.floor(Math.min(segA, segB) * 0.25);
  return Math.max(minSamples, Math.min(maxSamples, maxByLength));
}

// Stille-Regionen auf keepPauseDuration kürzen und Ergebnis als neuen Buffer zurückgeben.
// Adaptiver Crossfade an jedem Schnittübergang verhindert hörbare Sprünge/Klicks.
function trimSilenceRegions(
  buffer: AudioBuffer,
  regions: Array<{ start: number; end: number }>,
  keepPauseDuration: number
): AudioBuffer {
  const sr = buffer.sampleRate;
  const nch = buffer.numberOfChannels;

  // Segmente zusammenstellen die erhalten bleiben
  const segments: Array<{ start: number; end: number }> = [];
  let pos = 0;

  for (const r of regions) {
    if (r.start > pos) segments.push({ start: pos, end: r.start });
    // Kurze Pause erhalten (klingt natürlicher als harter Schnitt auf Null)
    const pauseEnd = Math.min(r.start + keepPauseDuration, r.end);
    if (pauseEnd > r.start) segments.push({ start: r.start, end: pauseEnd });
    pos = r.end;
  }
  if (pos < buffer.duration) segments.push({ start: pos, end: buffer.duration });

  // Segment-Längen in Samples berechnen (mit Mindestgröße 1)
  const segSamples = segments.map((s) =>
    Math.max(1, Math.floor((s.end - s.start) * sr))
  );
  const totalSamples = segSamples.reduce((a, b) => a + b, 0);
  if (totalSamples <= 0) return buffer;

  const out = makeBuffer(nch, totalSamples, sr);

  for (let ch = 0; ch < nch; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let dstOff = 0;

    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      const len = segSamples[si];
      const srcStart = Math.floor(seg.start * sr);

      // Adaptiven Crossfade für diesen Übergang berechnen
      const prevLen = si > 0 ? segSamples[si - 1] : 0;
      const nextLen = si < segments.length - 1 ? segSamples[si + 1] : 0;
      const fadeInSamples = si > 0
        ? calcAdaptiveCrossfadeSamples(prevLen, len, sr)
        : 0;
      const fadeOutSamples = si < segments.length - 1
        ? calcAdaptiveCrossfadeSamples(len, nextLen, sr)
        : 0;

      for (let s = 0; s < len; s++) {
        const srcIdx = srcStart + s;
        let sample = srcIdx < src.length ? src[srcIdx] : 0;

        // Einblenden am Segmentanfang (Equal-Power-Kurve: √t)
        if (s < fadeInSamples) {
          sample *= Math.sqrt(s / fadeInSamples);
        }

        // Ausblenden am Segmentende (Equal-Power-Kurve: √(1-t))
        const distFromEnd = len - 1 - s;
        if (distFromEnd < fadeOutSamples) {
          sample *= Math.sqrt(distFromEnd / fadeOutSamples);
        }

        dst[dstOff + s] = sample;
      }
      dstOff += len;
    }
  }

  return out;
}

// ─── Schritt 4: LUFS-Normalisierung ──────────────────────────────────────────

// Lautstärke auf targetLufs normalisieren und angewendeten Gain zurückgeben.
// True-Peak-Limiter bei -0.2 dBFS (= 0.977) verhindert digitales Clipping.
// Soft-Saturation verhindert harte Übersteuerung bei extremen Transienten.
function normalizeLufs(
  buffer: AudioBuffer,
  targetLufs: number
): { buffer: AudioBuffer; gainDb: number } {
  const currentLufs = estimateLufs(buffer);

  // Stille-Buffer unverändert zurückgeben
  if (currentLufs <= -70) return { buffer, gainDb: 0 };

  // Gain-Faktor aus LUFS-Differenz berechnen
  const gainDb = targetLufs - currentLufs;
  const linearGain = Math.pow(10, gainDb / 20);

  // True-Peak prüfen: würde der Gain den Peak über das Limit heben?
  let maxPeakIn = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]) > maxPeakIn) maxPeakIn = Math.abs(d[i]);
    }
  }
  const truePeakLimit = 0.977; // -0.2 dBFS
  const peakAfterGain = maxPeakIn * linearGain;
  // Falls Peak-Limit überschritten: Gain proportional reduzieren
  const finalGain = peakAfterGain > truePeakLimit
    ? linearGain * (truePeakLimit / peakAfterGain)
    : linearGain;
  const actualGainDb = 20 * Math.log10(finalGain);

  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      // Soft-Saturation: verhindert harte Clipping-Artefakte
      // Formel: x / (1 + |x| * k) mit k=0.05 → sehr sanftes Clipping über 0.95
      const raw = src[i] * finalGain;
      dst[i] = raw / (1 + Math.abs(raw) * 0.05);
    }
  }

  return { buffer: out, gainDb: actualGainDb };
}

// ─── Schritt 5: Dynamik-Kompression ──────────────────────────────────────────

// Soft-Knee-Kompressor mit Envelope-Follower.
// - Attack 3ms: folgt Transienten schnell (verhindert Pumpen)
// - Release 150ms: lässt den Pegel nach Peaks langsam abfallen (natürliches Klingen)
// - Kein Make-up-Gain: LUFS-Normalisierung hat das bereits erledigt
// - Verhältnis 2:1 → leichte, transparente Kompression für Sprache
function applyCompression(
  buffer: AudioBuffer,
  threshold: number,
  ratio: number,
  kneeWidth: number
): AudioBuffer {
  const sr = buffer.sampleRate;
  // Koeffizienten für One-Pole Tiefpass (Envelope-Follower)
  const attackCoeff  = Math.exp(-1 / (sr * 0.003));  // τ = 3ms
  const releaseCoeff = Math.exp(-1 / (sr * 0.150));  // τ = 150ms

  const out = makeBuffer(buffer.numberOfChannels, buffer.length, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let env = 0;

    for (let i = 0; i < src.length; i++) {
      const abs = Math.abs(src[i]);

      // Envelope folgt dem Signal: schnell aufwärts, langsam abwärts
      env = abs > env
        ? attackCoeff  * env + (1 - attackCoeff)  * abs
        : releaseCoeff * env + (1 - releaseCoeff) * abs;

      // Gain-Reduktion abhängig von der Position relativ zur Schwelle
      let gr = 1.0;
      const kneeBottom = threshold - kneeWidth / 2;
      const kneeTop    = threshold + kneeWidth / 2;

      if (env >= kneeBottom) {
        if (env < kneeTop) {
          // Soft-Knee: quadratische Interpolation zwischen 1:1 und ratio:1
          const t = (env - kneeBottom) / kneeWidth; // 0 → 1
          const effectiveRatio = 1 + (ratio - 1) * t * t;
          gr = Math.pow(Math.max(threshold, 1e-10) / Math.max(env, 1e-10), 1 - 1 / effectiveRatio);
        } else {
          // Über der Schwelle: volle Kompression
          gr = Math.pow(Math.max(threshold, 1e-10) / Math.max(env, 1e-10), 1 - 1 / ratio);
        }
      }

      // Kein Make-up-Gain – LUFS-Normalisierung hat das übernommen
      dst[i] = src[i] * gr;
    }
  }

  return out;
}

// ─── Schritt 6 (nur Pro): Rauschreduktion via Noise Gate ─────────────────────

// Analysiert die ersten 500ms als Rauschprofil.
// Gate-Gain: quadratische Kurve für weiches Einsetzen (kein hartes Schalten).
function applyNoiseGate(buffer: AudioBuffer): AudioBuffer {
  const sr = buffer.sampleRate;
  const profileLen = Math.min(Math.floor(sr * 0.5), buffer.length);
  const noiseFloor = calcRms(buffer.getChannelData(0), 0, profileLen);
  // Schwellenwert: Rauschboden + 6 dB Headroom (×2)
  const gateThreshold = Math.max(noiseFloor * 2, 0.008);

  const attackS  = Math.max(1, Math.floor(sr * 0.010));
  const releaseS = Math.max(1, Math.floor(sr * 0.050));
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    let env = 0;

    for (let i = 0; i < src.length; i++) {
      const abs = Math.abs(src[i]);
      env = abs > env
        ? env + (abs - env) / attackS
        : env + (abs - env) / releaseS;

      // Quadratische Gate-Kurve: sanft statt hart
      const gain = env >= gateThreshold ? 1.0 : Math.pow(env / gateThreshold, 2);
      dst[i] = src[i] * gain;
    }
  }

  return out;
}

// ─── Schritt 7 (nur Pro): EQ über OfflineAudioContext ───────────────────────

// Hochpass 80Hz entfernt Rumpeln, Präsenz-Band 3kHz verbessert Stimmklarheit,
// Air-Shelf 10kHz verleiht dem Klang Brillanz.
async function applyEQ(buffer: AudioBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  // Tiefenabschnitt: Brummen/Rumpeln unter 80Hz entfernen
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 80;
  hp.Q.value = 0.7;

  // Präsenz: Sprachverständlichkeit bei 3kHz anheben
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.gain.value = 2.5;
  presence.Q.value = 1.5;

  // Luft: Brillanz und Offenheit bei 10kHz
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

// ─── WAV-Export ──────────────────────────────────────────────────────────────

// AudioBuffer als 16-Bit PCM WAV-Blob exportieren.
// WAV-Format ist verlustfrei und wird von allen Browsern und Betriebssystemen
// ohne zusätzliche Codec-Installation abgespielt.
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const nch = buffer.numberOfChannels;
  const sr  = buffer.sampleRate;
  const len = buffer.length;
  const byteLen = len * nch * 2 + 44;

  const ab  = new ArrayBuffer(byteLen);
  const dv  = new DataView(ab);

  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  };

  // RIFF/WAVE-Header (44 Bytes)
  str(0, "RIFF");
  dv.setUint32(4,  byteLen - 8,      true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16,               true); // PCM-Chunk-Größe
  dv.setUint16(20, 1,                true); // Format = PCM
  dv.setUint16(22, nch,              true);
  dv.setUint32(24, sr,               true);
  dv.setUint32(28, sr * nch * 2,     true); // Byte-Rate
  dv.setUint16(32, nch * 2,          true); // Block-Align
  dv.setUint16(34, 16,               true); // Bits pro Sample
  str(36, "data");
  dv.setUint32(40, len * nch * 2,    true);

  // PCM-Samples: Float32 → Int16, Kanäle interleaved
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < nch; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      // Asymmetrische Skalierung für korrekte -32768 / +32767 Darstellung
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}

// ─── Öffentliche Verarbeitungsfunktionen ─────────────────────────────────────
//
// Beide Funktionen folgen demselben Muster:
//   processAudio*(file, options, onProgress) → { blob, stats }
//
// Das macht es einfach, in Zukunft die Free-Version durch einen Pro-API-Aufruf
// (z.B. Auphonic) zu ersetzen, ohne die aufrufende Seite (page.tsx) anzupassen.

// Phase 1 – Kostenlose Basisverarbeitung.
// Läuft vollständig im Browser: kein Upload, kein Server.
// Pipeline: Dekodieren → Stille kürzen → LUFS-Normalisierung → Kompression → WAV-Export
export async function processAudioBasic(
  file: File,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {
  const cfg = PRESET_CONFIG.basic;

  onProgress({ step: "Audiodatei dekodieren", percent: 5 });
  const original = await decodeAudio(file);
  const originalDuration = original.duration;

  onProgress({ step: "Stille-Regionen erkennen", percent: 18 });
  const silenceRegions = detectSilenceRegions(original, cfg.silenceThreshold, cfg.silenceMinDuration);

  onProgress({ step: "Stille gekürzt – Übergänge geglättet", percent: 32 });
  const trimmed = trimSilenceRegions(original, silenceRegions, cfg.keepPauseDuration);

  onProgress({ step: "Lautstärke auf -16 LUFS normalisiert", percent: 52 });
  const { buffer: normalized, gainDb } = normalizeLufs(trimmed, cfg.targetLufs);
  const estimatedLufs = estimateLufs(original);

  onProgress({ step: "Kompression angewendet", percent: 74 });
  const compressed = applyCompression(normalized, cfg.compThreshold, cfg.compRatio, cfg.compKneeWidth);

  onProgress({ step: "WAV-Datei wird exportiert", percent: 91 });
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

// Phase 2 – Pro-Verarbeitung mit Noise Gate und EQ.
// Gleiche Aufruf-Signatur wie processAudioBasic – austauschbar ohne UI-Änderung.
// Pipeline: Dekodieren → Noise Gate → Stille kürzen → LUFS → Kompression → EQ → WAV-Export
export async function processAudioPro(
  file: File,
  preset: ProcessingPreset,
  onProgress: ProgressCallback
): Promise<{ blob: Blob; stats: ProcessingStats }> {
  const cfg = PRESET_CONFIG[preset];

  onProgress({ step: "Audiodatei dekodieren", percent: 5 });
  const original = await decodeAudio(file);
  const originalDuration = original.duration;

  onProgress({ step: "Hintergrundrauschen reduziert", percent: 14 });
  const denoised = applyNoiseGate(original);

  onProgress({ step: "Stille-Regionen erkennen", percent: 24 });
  const silenceRegions = detectSilenceRegions(denoised, cfg.silenceThreshold, cfg.silenceMinDuration);

  onProgress({ step: "Stille gekürzt – Übergänge geglättet", percent: 36 });
  const trimmed = trimSilenceRegions(denoised, silenceRegions, cfg.keepPauseDuration);

  onProgress({ step: "Lautstärke dynamisch angeglichen", percent: 52 });
  const { buffer: normalized, gainDb } = normalizeLufs(trimmed, cfg.targetLufs);
  const estimatedLufs = estimateLufs(original);

  onProgress({ step: "Kompression angewendet", percent: 67 });
  const compressed = applyCompression(normalized, cfg.compThreshold, cfg.compRatio, cfg.compKneeWidth);

  onProgress({ step: "EQ und Stimmklarheit angewendet", percent: 83 });
  const eqd = await applyEQ(compressed);

  onProgress({ step: "WAV-Datei wird exportiert", percent: 95 });
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

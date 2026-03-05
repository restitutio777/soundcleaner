/**
 * KlangRein — Hauptseite
 * Verbindet Phase 1 (kostenlos, browser-seitig) und Phase 2 (Pro, mit Credits)
 */

"use client";

import { useState, useCallback } from "react";
import { flushSync } from "react-dom";
import {
  Upload,
  Sparkles,
  Wind,
  Volume,
  Check,
  Crown,
  Info,
} from "lucide-react";
import AudioPlayer from "./components/AudioPlayer";
import ProcessingModal from "./components/ProcessingModal";
import Toast from "./components/Toast";
import AuthModal from "./components/AuthModal";
import CreditsPanel from "./components/CreditsPanel";
import PresetSelector from "./components/PresetSelector";
import { useAuth } from "./context/AuthContext";
import { useCredits } from "./hooks/useCredits";
import { processAudioBasic, processAudioPro, type ProcessingPreset, type ProcessingStats } from "./lib/audioProcessor";
import { FREE_MAX_DURATION_SECONDS, PRO_MAX_DURATION_SECONDS } from "./lib/supabaseClient";

export default function Home() {
  const { user } = useAuth();
  const { credits, formatCredits, hasEnoughCredits, deductCredits, logJob } = useCredits();

  // Datei-State
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Verarbeitungs-State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [processingPercent, setProcessingPercent] = useState(0);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [processingStats, setProcessingStats] = useState<ProcessingStats | null>(null);

  // UI-State
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"login" | "register">("login");
  const [selectedPreset, setSelectedPreset] = useState<ProcessingPreset>("kursaufnahme");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; visible: boolean }>({
    message: "",
    type: "success",
    visible: false,
  });

  // Pro-Modus ist aktiv wenn: Nutzer angemeldet + Credits vorhanden
  const isPro = !!user && !!credits;

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
  }, []);

  // Datei validieren
  const validateFile = (file: File): string | null => {
    if (!file.type.startsWith("audio/")) {
      return "Nur Audio-Dateien werden unterstützt (MP3, WAV, M4A, FLAC).";
    }
    return null;
  };

  // Dateidauer auslesen
  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio(URL.createObjectURL(file));
      audio.addEventListener("loadedmetadata", () => {
        resolve(audio.duration);
      });
      audio.addEventListener("error", () => resolve(0));
    });
  };

  const handleFileSelected = async (file: File) => {
    const error = validateFile(file);
    if (error) {
      showToast(error, "error");
      return;
    }

    // Maximale Dateigröße prüfen
    const duration = await getAudioDuration(file);

    if (!isPro && duration > FREE_MAX_DURATION_SECONDS) {
      showToast(
        `Kostenlose Version: max. ${FREE_MAX_DURATION_SECONDS / 60} Minuten. Melde dich an für die Pro-Version.`,
        "error"
      );
      return;
    }

    if (isPro && duration > PRO_MAX_DURATION_SECONDS) {
      showToast(`Maximale Länge: ${PRO_MAX_DURATION_SECONDS / 60} Minuten.`, "error");
      return;
    }

    setOriginalFile(file);
    setProcessedBlob(null);
    setProcessingError(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const audioFile = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("audio/"));
    if (audioFile) handleFileSelected(audioFile);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
  };

  // Hauptverarbeitungsfunktion
  const handleProcess = async () => {
    if (!originalFile) return;

    setProcessingError(null);
    setIsProcessing(true);
    setProcessingPercent(0);
    setProcessingStep("Wird vorbereitet");
    setCompletedSteps([]);
    setProcessingStats(null);

    let lastStep = "";
    let lastRenderedPercent = -1;

    try {
      const duration = await getAudioDuration(originalFile);

      // Credits prüfen für Pro-Nutzer
      if (isPro) {
        if (!hasEnoughCredits(Math.ceil(duration))) {
          setIsProcessing(false);
          showToast(
            `Nicht genug Guthaben. Du benötigst ${formatCredits(Math.ceil(duration))}.`,
            "error"
          );
          return;
        }
      }

      // Fortschritts-Callback: flushSync forces React to render immediately.
      // Throttled to fire only when step label changes OR percent moves by ≥1
      // to avoid hundreds of synchronous React re-renders inside tight loops.
      const onProgress = ({ step, percent }: { step: string; percent: number }) => {
        const roundedPct = Math.round(percent);
        const stepChanged = lastStep !== step;
        if (!stepChanged && roundedPct === lastRenderedPercent) return;
        flushSync(() => {
          if (stepChanged && lastStep) {
            setCompletedSteps((prev) => [...prev, lastStep]);
          }
          lastStep = step;
          lastRenderedPercent = roundedPct;
          setProcessingStep(step);
          setProcessingPercent(roundedPct);
        });
      };

      let resultBlob: Blob;

      if (isPro) {
        // Phase 2: Pro-Verarbeitung mit erweitertem Preset
        const { blob, stats } = await processAudioPro(originalFile, selectedPreset, onProgress);
        resultBlob = blob;
        setProcessingStats(stats);
        // Credits nach erfolgreicher Verarbeitung abziehen
        await deductCredits(Math.ceil(duration));
        await logJob(originalFile.name, duration, selectedPreset);
      } else {
        // Phase 1: Basic Free-Verarbeitung
        const { blob, stats } = await processAudioBasic(originalFile, onProgress);
        resultBlob = blob;
        setProcessingStats(stats);
      }

      // Letzten Schritt auch als abgeschlossen markieren
      if (lastStep) {
        setCompletedSteps((prev) => [...prev, lastStep]);
      }

      setProcessedBlob(resultBlob);
      // Kurze Pause damit der Nutzer den "Fertig"-Status im Modal sieht
      await new Promise((r) => setTimeout(r, 900));
      setIsProcessing(false);
      showToast("Audio erfolgreich bereinigt!", "success");
    } catch (err) {
      console.error("Verarbeitungsfehler:", err);
      // Modal für kurze Zeit mit Fehlermeldung anzeigen, dann schließen
      setProcessingError("Audio konnte nicht verarbeitet werden.");
      setTimeout(() => {
        setIsProcessing(false);
        setProcessingError(null);
        showToast("Audio konnte nicht verarbeitet werden.", "error");
      }, 2200);
    }
  };

  // Verarbeitetes Audio herunterladen
  const handleDownload = () => {
    if (!processedBlob || !originalFile) return;
    const baseName = originalFile.name.replace(/\.[^/.]+$/, "");
    const url = URL.createObjectURL(processedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bereinigt_${baseName}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Audio heruntergeladen!", "success");
  };

  const resetAll = () => {
    setOriginalFile(null);
    setProcessedBlob(null);
    setProcessingError(null);
    setProcessingPercent(0);
    setProcessingStep("");
    setCompletedSteps([]);
    setProcessingStats(null);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        zIndex: 1,
        padding: "64px 24px 96px",
      }}
    >
      <div
        className="flex flex-col"
        style={{ maxWidth: "780px", width: "100%", margin: "0 auto", gap: "48px" }}
      >
        {/* Kopfzeile mit Brand und Account */}
        <div className="flex items-center justify-between animate-fade-in">
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "28px",
              color: "var(--color-ice)",
              letterSpacing: "0.04em",
            }}
          >
            KlangRein
          </span>

          {/* Credits-Panel / Login-Button */}
          <CreditsPanel
            onLoginClick={() => {
              setAuthModalMode("login");
              setAuthModalOpen(true);
            }}
            onBuyCreditsClick={() => {
              showToast("Stripe-Integration folgt in Kürze.", "success");
            }}
          />
        </div>

        {/* Hero-Bereich (nur ohne hochgeladene Datei) */}
        {!originalFile && (
          <div className="flex flex-col animate-slide-up" style={{ gap: "20px" }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(40px, 6vw, 64px)",
                fontWeight: 400,
                color: "var(--color-foreground)",
                margin: 0,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
              }}
            >
              Dein Audio.
              <br />
              <span style={{ color: "var(--color-accent)" }}>Kristallklar.</span>
            </h1>
            <p
              style={{
                fontSize: "17px",
                color: "var(--color-foreground-muted)",
                margin: 0,
                lineHeight: 1.7,
                maxWidth: "480px",
              }}
            >
              Upload deine Aufnahme, wir schneiden Pausen und optimieren die Lautstärke.
              Fertige Datei herunterladen.
            </p>

            {/* Phase-Erklärung */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                marginTop: "8px",
              }}
            >
              {/* Free Badge */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "3px",
                  fontSize: "13px",
                  color: "var(--color-foreground-subtle)",
                }}
              >
                <Wind size={14} color="var(--color-accent)" />
                <span>Kostenlos bis 3 Min.</span>
              </div>

              {/* Pro Badge */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  background: "var(--color-accent-muted)",
                  border: "1px solid var(--color-border-accent)",
                  borderRadius: "3px",
                  fontSize: "13px",
                  color: "var(--color-accent)",
                }}
              >
                <Crown size={14} />
                <span>Pro bis 60 Min. + Presets</span>
              </div>
            </div>
          </div>
        )}

        {/* Upload-Zone (nur ohne hochgeladene Datei) */}
        {!originalFile ? (
          <label
            className={`upload-zone ${isDragging ? "drag-over" : ""} animate-slide-up`}
            style={{
              width: "100%",
              padding: "64px 32px",
              cursor: "pointer",
              display: "block",
              animationDelay: "0.08s",
              animationFillMode: "both",
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileInput}
              style={{ display: "none" }}
            />
            <div className="flex flex-col items-center" style={{ gap: "20px" }}>
              <div className="icon-box icon-box-accent" style={{ width: "64px", height: "64px" }}>
                <Upload size={28} />
              </div>
              <div className="flex flex-col items-center" style={{ gap: "8px" }}>
                <p style={{ fontSize: "17px", fontWeight: 600, color: "var(--color-foreground)", margin: 0 }}>
                  Audio-Datei hierher ziehen
                </p>
                <p style={{ fontSize: "14px", color: "var(--color-foreground-subtle)", margin: 0 }}>
                  oder klicken zum Durchsuchen — MP3, WAV, M4A, FLAC
                </p>
                <p style={{ fontSize: "12px", color: "var(--color-foreground-subtle)", margin: 0 }}>
                  {isPro ? "Pro: bis zu 60 Minuten" : "Kostenlos: bis zu 3 Minuten"}
                </p>
              </div>
            </div>
          </label>
        ) : (
          /* Original-Audio-Player */
          <div className="flex flex-col animate-scale-in" style={{ width: "100%", gap: "24px" }}>
            <AudioPlayer
              file={originalFile}
              label={originalFile.name}
            />
          </div>
        )}

        {/* Verarbeitungsoptionen (nach Upload, vor Verarbeitung) */}
        {originalFile && !processedBlob && (
          <div className="flex flex-col animate-slide-up" style={{ width: "100%", gap: "24px" }}>

            {/* Pro-Preset-Auswahl (nur für angemeldete Nutzer) */}
            {isPro ? (
              <PresetSelector
                selected={selectedPreset}
                onChange={setSelectedPreset}
              />
            ) : (
              /* Free-Info-Banner */
              <div
                style={{
                  padding: "14px 18px",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "3px",
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                }}
              >
                <Info size={16} color="var(--color-foreground-subtle)" style={{ marginTop: "1px", flexShrink: 0 }} />
                <div className="flex flex-col" style={{ gap: "6px" }}>
                  <p style={{ margin: 0, fontSize: "14px", color: "var(--color-foreground)", fontWeight: 600 }}>
                    Kostenlose Version
                  </p>
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--color-foreground-subtle)", lineHeight: 1.6 }}>
                    Upload deine Aufnahme, wir schneiden Pausen und optimieren die Lautstärke.
                    Fertige Datei herunterladen. Für erweiterte Funktionen (bis 60 Min., Rauschreduktion, Presets)
                    bitte{" "}
                    <button
                      className="btn btn-ghost"
                      style={{ padding: 0, fontSize: "13px", color: "var(--color-accent)", textDecoration: "underline" }}
                      onClick={() => {
                        setAuthModalMode("register");
                        setAuthModalOpen(true);
                      }}
                    >
                      anmelden
                    </button>
                    .
                  </p>
                </div>
              </div>
            )}

            {/* Aktive Verbesserungen (nur Free) */}
            {!isPro && (
              <div className="flex" style={{ gap: "10px", flexWrap: "wrap" }}>
                {[
                  { icon: <Wind size={16} />, label: "Pausen kürzen" },
                  { icon: <Volume size={16} />, label: "Lautstärke normalisieren" },
                  { icon: <Sparkles size={16} />, label: "Leichte Kompression" },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center"
                    style={{
                      gap: "8px",
                      padding: "8px 14px",
                      background: "var(--color-accent-muted)",
                      border: "1px solid var(--color-border-accent)",
                      borderRadius: "3px",
                      fontSize: "13px",
                      color: "var(--color-accent)",
                    }}
                  >
                    {item.icon}
                    {item.label}
                    <Check size={13} />
                  </div>
                ))}
              </div>
            )}

            {/* Credits-Warnung wenn zu wenig */}
            {isPro && credits && !hasEnoughCredits(60) && (
              <div
                style={{
                  padding: "12px 16px",
                  background: "var(--color-warning-bg)",
                  border: "1px solid rgba(251, 191, 36, 0.2)",
                  borderRadius: "3px",
                  fontSize: "13px",
                  color: "var(--color-warning)",
                }}
              >
                Guthaben niedrig: {formatCredits(credits.credits_seconds)} verbleibend.
              </div>
            )}

            {/* Verarbeiten-Button */}
            <div className="flex flex-col items-start" style={{ gap: "12px" }}>
              <button
                className="btn btn-primary flex items-center"
                style={{ padding: "14px 32px", fontSize: "13px", gap: "10px" }}
                onClick={handleProcess}
                disabled={isProcessing}
              >
                {isPro ? <Crown size={16} /> : <Sparkles size={16} />}
                {isPro
                  ? `Pro: Audio bereinigen (${selectedPreset})`
                  : "Audio bereinigen (kostenlos)"}
              </button>

              <button
                className="btn btn-ghost"
                style={{ padding: "8px 0", fontSize: "13px" }}
                onClick={resetAll}
              >
                Andere Datei hochladen
              </button>
            </div>
          </div>
        )}

        {/* Ergebnis: Verarbeitetes Audio */}
        {processedBlob && (
          <div className="flex flex-col animate-scale-in" style={{ width: "100%", gap: "24px" }}>
            {/* Erfolgs-Banner */}
            <div
              className="flex items-center"
              style={{
                gap: "10px",
                padding: "10px 16px",
                background: "var(--color-success-bg)",
                border: "1px solid rgba(74, 222, 128, 0.2)",
                borderRadius: "3px",
              }}
            >
              <Check size={16} color="var(--color-success)" />
              <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-success)" }}>
                Audio erfolgreich bereinigt
                {isPro && ` · Preset: ${selectedPreset}`}
              </span>
            </div>

            {/* Verarbeitetes Audio Player */}
            <AudioPlayer
              file={processedBlob}
              label={`bereinigt_${originalFile?.name.replace(/\.[^/.]+$/, "")}.wav`}
              isProcessed
              onDownload={handleDownload}
            />

            <button
              className="btn btn-ghost"
              style={{ padding: "8px 0", fontSize: "13px", alignSelf: "flex-start" }}
              onClick={resetAll}
            >
              Weitere Datei bereinigen
            </button>
          </div>
        )}
      </div>

      {/* Verarbeitungs-Modal (Echtzeit-Fortschritt) */}
      <ProcessingModal
        isOpen={isProcessing}
        currentStep={processingStep}
        percent={processingPercent}
        completedSteps={completedSteps}
        stats={processingStats}
        error={processingError}
      />

      {/* Auth-Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultMode={authModalMode}
      />

      {/* Toast-Benachrichtigung */}
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </div>
  );
}

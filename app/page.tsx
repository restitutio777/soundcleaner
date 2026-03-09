"use client";

import { useState, useCallback } from "react";
import { flushSync } from "react-dom";
import {
  Upload,
  Sparkles,
  Wind,
  Volume2,
  Check,
  Crown,
  Info,
  Waves,
  Zap,
  Radio,
  ArrowRight,
} from "lucide-react";
import AudioPlayer from "./components/AudioPlayer";
import ProcessingModal from "./components/ProcessingModal";
import Toast from "./components/Toast";
import AuthModal from "./components/AuthModal";
import CreditsPanel from "./components/CreditsPanel";
import PresetSelector from "./components/PresetSelector";
import UsageCounter from "./components/UsageCounter";
import { useAuth } from "./context/AuthContext";
import { useCredits } from "./hooks/useCredits";
import {
  processAudio,
  processAudioPro,
  type ProcessingPreset,
  type ProcessingOptions,
  type ProcessingStats,
  DEFAULT_PROCESSING_OPTIONS,
} from "./lib/audioProcessor";
import { supabase, FREE_MAX_DURATION_SECONDS, PRO_MAX_DURATION_SECONDS } from "./lib/supabaseClient";

function LogoMark() {
  return (
    <div
      style={{
        width: "38px",
        height: "38px",
        borderRadius: "10px",
        background: "linear-gradient(135deg, rgba(191, 111, 132, 0.2) 0%, rgba(191, 111, 132, 0.08) 100%)",
        border: "1px solid rgba(191, 111, 132, 0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 12h2l2-6 3 12 3-8 2 4h2" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="12" r="2" fill="var(--color-accent)" opacity="0.6" />
      </svg>
    </div>
  );
}

const TOGGLE_OPTIONS: Array<{
  key: keyof ProcessingOptions;
  icon: typeof Wind;
  label: string;
  desc: string;
}> = [
  { key: "trimSilence", icon: Wind, label: "Pausen kürzen", desc: "Stille automatisch kürzen" },
  { key: "highPass", icon: Radio, label: "Rumpeln entfernen", desc: "80 Hz High-Pass Filter" },
  { key: "normalize", icon: Volume2, label: "Lautstärke ausgleichen", desc: "Peak normalize auf -1 dBFS" },
  { key: "compress", icon: Zap, label: "Leichte Sprachkompression", desc: "Natürliche Dynamik erhalten" },
  { key: "dereverb", icon: Waves, label: "Raumhall reduzieren", desc: "Reflexionen leicht reduzieren" },
];

export default function Home() {
  const { user } = useAuth();
  const { credits, formatCredits, hasEnoughCredits, deductCredits, logJob } = useCredits();

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [processingPercent, setProcessingPercent] = useState(0);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [processingStats, setProcessingStats] = useState<ProcessingStats | null>(null);

  const [processingOptions, setProcessingOptions] = useState<ProcessingOptions>(DEFAULT_PROCESSING_OPTIONS);

  const toggleOption = (key: keyof ProcessingOptions) => {
    setProcessingOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"login" | "register">("login");
  const [selectedPreset, setSelectedPreset] = useState<ProcessingPreset>("kursaufnahme");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error"; visible: boolean }>({
    message: "",
    type: "success",
    visible: false,
  });

  const isPro = !!user && !!credits;

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
  }, []);

  const validateFile = (file: File): string | null => {
    if (!file.type.startsWith("audio/")) {
      return "Nur Audio-Dateien werden unterstützt (MP3, WAV, M4A, FLAC).";
    }
    return null;
  };

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
        const { blob, stats } = await processAudioPro(originalFile, selectedPreset, onProgress);
        resultBlob = blob;
        setProcessingStats(stats);
        await deductCredits(Math.ceil(duration));
        await logJob(originalFile.name, duration, selectedPreset);
      } else {
        const { blob, stats } = await processAudio(originalFile, processingOptions, onProgress);
        resultBlob = blob;
        setProcessingStats(stats);
      }

      if (lastStep) {
        setCompletedSteps((prev) => [...prev, lastStep]);
      }

      setProcessedBlob(resultBlob);
      await new Promise((r) => setTimeout(r, 900));
      setIsProcessing(false);
      showToast("Audio erfolgreich bereinigt!", "success");
    } catch (err) {
      console.error("Verarbeitungsfehler:", err);
      setProcessingError("Audio konnte nicht verarbeitet werden.");
      setTimeout(() => {
        setIsProcessing(false);
        setProcessingError(null);
        showToast("Audio konnte nicht verarbeitet werden.", "error");
      }, 2200);
    }
  };

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
        padding: "0 24px 96px",
      }}
    >
      <div
        className="flex flex-col"
        style={{ maxWidth: "720px", width: "100%", margin: "0 auto" }}
      >
        {/* ── Header ── */}
        <header
          className="flex items-center justify-between animate-fade-in"
          style={{
            padding: "20px 0",
            position: "sticky",
            top: 0,
            zIndex: 30,
            background: "linear-gradient(180deg, var(--color-base) 70%, transparent 100%)",
          }}
        >
          <div className="flex items-center" style={{ gap: "11px" }}>
            <LogoMark />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "22px",
                color: "var(--color-ice)",
                letterSpacing: "0.01em",
              }}
            >
              KlangRein
            </span>
          </div>

          <CreditsPanel
            onLoginClick={() => {
              setAuthModalMode("login");
              setAuthModalOpen(true);
            }}
            onBuyCreditsClick={(packageId: string) => {
              if (user) {
                supabase.from("purchase_interest").insert({ user_id: user.id, package_id: packageId });
              }
            }}
          />
        </header>

        <div className="flex flex-col" style={{ gap: "48px", paddingTop: "24px" }}>
          {/* ── Hero ── */}
          {!originalFile && (
            <div className="flex flex-col" style={{ gap: "28px" }}>
              <div className="flex flex-col" style={{ gap: "16px" }}>
                <h1
                  className="animate-slide-up"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "clamp(40px, 6vw, 60px)",
                    fontWeight: 400,
                    color: "var(--color-foreground)",
                    margin: 0,
                    lineHeight: 1.1,
                    letterSpacing: "-0.02em",
                  }}
                >
                  MP3 lauter machen.
                  <br />
                  <span style={{ color: "var(--color-accent)" }}>In Sekunden.</span>
                </h1>
                <p
                  className="animate-slide-up"
                  style={{
                    fontSize: "16px",
                    color: "var(--color-foreground-muted)",
                    margin: 0,
                    lineHeight: 1.7,
                    maxWidth: "460px",
                    animationDelay: "0.06s",
                  }}
                >
                  Lautstärke erhöhen, Rauschen entfernen, Pausen kürzen –
                  direkt im Browser. Kostenlos, ohne Anmeldung.
                </p>
              </div>

              <div
                className="flex animate-slide-up"
                style={{ gap: "10px", flexWrap: "wrap", animationDelay: "0.12s" }}
              >
                <span className="badge badge-default">
                  <Sparkles size={14} color="var(--color-accent)" />
                  Kostenlos bis 3 Min.
                </span>
                <span className="badge badge-accent">
                  <Crown size={14} />
                  Pro bis 60 Min. + Presets
                </span>
              </div>
            </div>
          )}

          {/* ── Upload Zone ── */}
          {!originalFile ? (
            <label
              className={`upload-zone ${isDragging ? "drag-over" : ""} animate-slide-up`}
              style={{
                width: "100%",
                padding: "64px 32px",
                cursor: "pointer",
                display: "block",
                animationDelay: "0.18s",
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
              <div
                className="flex flex-col items-center"
                style={{ gap: "20px", position: "relative", zIndex: 1 }}
              >
                <div
                  className="animate-float"
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "18px",
                    background: "linear-gradient(135deg, rgba(191, 111, 132, 0.18) 0%, rgba(191, 111, 132, 0.06) 100%)",
                    border: "1px solid rgba(191, 111, 132, 0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Upload size={26} color="var(--color-accent)" />
                </div>
                <div className="flex flex-col items-center" style={{ gap: "8px" }}>
                  <p style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    color: "var(--color-foreground)",
                    margin: 0,
                    letterSpacing: "-0.01em",
                  }}>
                    Audio-Datei hierher ziehen
                  </p>
                  <p style={{ fontSize: "14px", color: "var(--color-foreground-subtle)", margin: 0, lineHeight: 1.5 }}>
                    oder klicken zum Durchsuchen — MP3, WAV, M4A, FLAC
                  </p>
                  <p style={{
                    fontSize: "12px",
                    color: "var(--color-foreground-subtle)",
                    margin: 0,
                    marginTop: "6px",
                    opacity: 0.7,
                  }}>
                    {isPro ? "Pro: bis zu 60 Minuten" : "Kostenlos: bis zu 3 Minuten"}
                  </p>
                </div>
              </div>
            </label>
          ) : (
            <div className="flex flex-col animate-scale-in" style={{ width: "100%", gap: "24px" }}>
              <AudioPlayer file={originalFile} label={originalFile.name} />
            </div>
          )}

          {/* ── Processing Options ── */}
          {originalFile && !processedBlob && (
            <div className="flex flex-col animate-slide-up" style={{ width: "100%", gap: "24px" }}>
              {isPro ? (
                <PresetSelector selected={selectedPreset} onChange={setSelectedPreset} />
              ) : (
                <div
                  style={{
                    padding: "16px 20px",
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "12px",
                    display: "flex",
                    gap: "14px",
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      width: "34px",
                      height: "34px",
                      borderRadius: "9px",
                      background: "var(--color-accent-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Info size={16} color="var(--color-accent)" />
                  </div>
                  <div className="flex flex-col" style={{ gap: "4px" }}>
                    <p style={{ margin: 0, fontSize: "14px", color: "var(--color-foreground)", fontWeight: 600 }}>
                      Kostenlose Version
                    </p>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--color-foreground-subtle)", lineHeight: 1.6 }}>
                      Pausen und Lautstärke werden automatisch optimiert.
                      Für erweiterte Funktionen{" "}
                      <button
                        className="btn btn-ghost"
                        style={{
                          padding: 0,
                          fontSize: "13px",
                          color: "var(--color-accent)",
                          textDecoration: "underline",
                          textTransform: "none",
                          letterSpacing: 0,
                          display: "inline",
                        }}
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

              {!isPro && (
                <div className="flex flex-col" style={{ gap: "6px" }}>
                  <p style={{
                    margin: "0 0 6px",
                    fontSize: "11px",
                    color: "var(--color-foreground-subtle)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}>
                    Verarbeitungsschritte
                  </p>
                  {TOGGLE_OPTIONS.map(({ key, icon: Icon, label, desc }) => {
                    const active = processingOptions[key];
                    return (
                      <button
                        key={key}
                        onClick={() => toggleOption(key)}
                        className={`toggle-row ${active ? "active" : ""}`}
                      >
                        <div
                          style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "9px",
                            background: active ? "var(--color-accent-muted)" : "var(--color-indigo-muted)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            transition: "all 0.25s ease",
                          }}
                        >
                          <Icon size={16} color={active ? "var(--color-accent)" : "var(--color-foreground-subtle)"} />
                        </div>
                        <div className="flex flex-col" style={{ gap: "1px", flex: 1 }}>
                          <span style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            color: active ? "var(--color-foreground)" : "var(--color-foreground-muted)",
                            transition: "color 0.2s",
                          }}>
                            {label}
                          </span>
                          <span style={{ fontSize: "12px", color: "var(--color-foreground-subtle)" }}>
                            {desc}
                          </span>
                        </div>
                        <div className={`toggle-track ${active ? "on" : ""}`}>
                          <div className="toggle-thumb" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {isPro && credits && !hasEnoughCredits(60) && (
                <div
                  style={{
                    padding: "12px 16px",
                    background: "var(--color-warning-bg)",
                    border: "1px solid rgba(251, 191, 36, 0.2)",
                    borderRadius: "10px",
                    fontSize: "13px",
                    color: "var(--color-warning)",
                  }}
                >
                  Guthaben niedrig: {formatCredits(credits.credits_seconds)} verbleibend.
                </div>
              )}

              <div className="flex items-center" style={{ gap: "12px" }}>
                <button
                  className="btn btn-primary flex items-center"
                  style={{ padding: "14px 28px", fontSize: "13px", gap: "10px" }}
                  onClick={handleProcess}
                  disabled={isProcessing}
                >
                  {isPro ? <Crown size={16} /> : <Sparkles size={16} />}
                  {isPro
                    ? `Pro: Audio bereinigen (${selectedPreset})`
                    : "Audio bereinigen"}
                  <ArrowRight size={15} />
                </button>

                <button
                  className="btn btn-ghost"
                  style={{ padding: "12px 18px", fontSize: "13px" }}
                  onClick={resetAll}
                >
                  Andere Datei
                </button>
              </div>
            </div>
          )}

          {/* ── Result ── */}
          {processedBlob && (
            <div className="flex flex-col animate-scale-in" style={{ width: "100%", gap: "24px" }}>
              <div
                className="flex items-center"
                style={{
                  gap: "12px",
                  padding: "14px 18px",
                  background: "var(--color-success-bg)",
                  border: "1px solid rgba(74, 222, 128, 0.15)",
                  borderRadius: "12px",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    background: "rgba(74, 222, 128, 0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Check size={14} color="var(--color-success)" />
                </div>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-success)" }}>
                  Audio erfolgreich bereinigt
                  {isPro && ` · Preset: ${selectedPreset}`}
                </span>
              </div>

              <AudioPlayer
                file={processedBlob}
                label={`bereinigt_${originalFile?.name.replace(/\.[^/.]+$/, "")}.wav`}
                isProcessed
                onDownload={handleDownload}
              />

              <button
                className="btn btn-ghost"
                style={{ padding: "12px 0", fontSize: "13px", alignSelf: "flex-start" }}
                onClick={resetAll}
              >
                Weitere Datei bereinigen
              </button>
            </div>
          )}
        </div>
      </div>

      <ProcessingModal
        isOpen={isProcessing}
        currentStep={processingStep}
        percent={processingPercent}
        completedSteps={completedSteps}
        stats={processingStats}
        error={processingError}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultMode={authModalMode}
      />

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <UsageCounter />
    </div>
  );
}

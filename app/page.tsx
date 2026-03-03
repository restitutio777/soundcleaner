/**
 * KlangRein — KI-gesteuerte Audio-Verbesserung
 * Editorial dark theme with dusty rose / indigo palette
 */

"use client";

import { useState } from "react";
import {
  Upload,
  Sparkles,
  Wind,
  MessageSquare,
  Volume,
  Check,
  AudioLines,
} from "lucide-react";
import AudioPlayer from "./components/AudioPlayer";
import ProcessingModal from "./components/ProcessingModal";
import Toast from "./components/Toast";

interface CleaningOption {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
}

export default function Home() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [processedFile, setProcessedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
    visible: boolean;
  }>({
    message: "",
    type: "success",
    visible: false,
  });

  const [options, setOptions] = useState<CleaningOption[]>([
    {
      id: "noise",
      label: "Hintergrundgeräusche",
      description: "Entfernt Umgebungsgeräusche, Brummen & Rauschen",
      icon: <Wind size={22} />,
      enabled: true,
    },
    {
      id: "fillers",
      label: "Füllwörter",
      description: "Entfernt 'äh', 'ähm', 'also' und Zögern",
      icon: <MessageSquare size={22} />,
      enabled: true,
    },
    {
      id: "enhance",
      label: "Stimmverbesserung",
      description: "Verbessert Klarheit & Stimmpräsenz",
      icon: <Volume size={22} />,
      enabled: true,
    },
  ]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const audioFile = files.find((file) => file.type.startsWith("audio/"));
    if (audioFile) {
      setOriginalFile(audioFile);
      setProcessedFile(null);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOriginalFile(file);
      setProcessedFile(null);
    }
  };

  const toggleOption = (id: string) => {
    setOptions((prev) =>
      prev.map((opt) =>
        opt.id === id ? { ...opt, enabled: !opt.enabled } : opt
      )
    );
  };

  const handleProcess = () => {
    const enabledCount = options.filter((opt) => opt.enabled).length;
    if (enabledCount === 0) {
      showToast("Bitte wähle mindestens eine Verbesserung aus", "error");
      return;
    }
    setIsProcessing(true);
  };

  const handleProcessingComplete = () => {
    setIsProcessing(false);
    if (originalFile) {
      setProcessedFile(originalFile);
      showToast("Audio erfolgreich bereinigt!", "success");
    }
  };

  const handleDownload = () => {
    if (processedFile) {
      const url = URL.createObjectURL(processedFile);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bereinigt_${processedFile.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Audio heruntergeladen!", "success");
    }
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type, visible: true });
  };

  const hideToast = () => {
    setToast((prev) => ({ ...prev, visible: false }));
  };

  const enabledCount = options.filter((opt) => opt.enabled).length;

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
        style={{
          maxWidth: "780px",
          width: "100%",
          margin: "0 auto",
          gap: "48px",
        }}
      >
        {/* Brand */}
        <div className="flex items-center animate-fade-in" style={{ gap: "14px" }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: "40px",
              height: "40px",
              background: "var(--color-accent)",
              borderRadius: "3px",
            }}
          >
            <AudioLines size={22} color="#fff" />
          </div>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "24px",
              color: "var(--color-ice)",
              letterSpacing: "-0.01em",
            }}
          >
            KlangRein
          </span>
        </div>

        {/* Hero */}
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
              KI-gesteuerte Audio-Verbesserung. Entferne Rauschen,
              Füllwörter und steigere die Klarheit deiner Aufnahmen.
            </p>
          </div>
        )}

        {/* Upload Zone */}
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
              <div
                className="icon-box icon-box-accent"
                style={{ width: "64px", height: "64px" }}
              >
                <Upload size={28} />
              </div>
              <div className="flex flex-col items-center" style={{ gap: "8px" }}>
                <p
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    color: "var(--color-foreground)",
                    margin: 0,
                  }}
                >
                  Audio-Datei hierher ziehen
                </p>
                <p
                  style={{
                    fontSize: "14px",
                    color: "var(--color-foreground-subtle)",
                    margin: 0,
                  }}
                >
                  oder klicken zum Durchsuchen — MP3, WAV, M4A, FLAC
                </p>
              </div>
            </div>
          </label>
        ) : (
          <div className="flex flex-col animate-scale-in" style={{ width: "100%", gap: "24px" }}>
            <AudioPlayer file={originalFile} />
          </div>
        )}

        {/* Cleaning Options */}
        {originalFile && !processedFile && (
          <>
            <div className="flex flex-col animate-slide-up" style={{ width: "100%", gap: "20px" }}>
              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "22px",
                  fontWeight: 400,
                  color: "var(--color-foreground)",
                  margin: 0,
                }}
              >
                Verbesserungen auswählen
              </h3>
              <div
                className="flex"
                style={{
                  gap: "12px",
                  width: "100%",
                  flexWrap: "wrap",
                }}
              >
                {options.map((option) => (
                  <button
                    key={option.id}
                    className={`option-card ${option.enabled ? "active" : ""}`}
                    style={{
                      flex: "1 1 220px",
                      maxWidth: "260px",
                      textAlign: "left",
                    }}
                    onClick={() => toggleOption(option.id)}
                  >
                    <div className="flex flex-col" style={{ gap: "12px" }}>
                      <div className="flex items-center justify-between">
                        <div
                          className={`icon-box ${option.enabled ? "icon-box-accent" : "icon-box-muted"}`}
                          style={{ width: "44px", height: "44px" }}
                        >
                          {option.icon}
                        </div>
                        {option.enabled && (
                          <div
                            style={{
                              width: "20px",
                              height: "20px",
                              background: "var(--color-accent)",
                              borderRadius: "2px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Check size={12} color="#fff" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col" style={{ gap: "4px" }}>
                        <h4
                          style={{
                            fontSize: "14px",
                            fontWeight: 600,
                            color: option.enabled
                              ? "var(--color-foreground)"
                              : "var(--color-foreground-subtle)",
                            margin: 0,
                          }}
                        >
                          {option.label}
                        </h4>
                        <p
                          style={{
                            fontSize: "13px",
                            color: "var(--color-foreground-subtle)",
                            margin: 0,
                            lineHeight: 1.5,
                          }}
                        >
                          {option.description}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-start" style={{ gap: "16px" }}>
              <button
                className="btn btn-primary flex items-center"
                style={{
                  padding: "14px 32px",
                  fontSize: "13px",
                  gap: "10px",
                }}
                onClick={handleProcess}
                disabled={isProcessing || enabledCount === 0}
              >
                <Sparkles size={16} />
                Audio bereinigen ({enabledCount}{" "}
                {enabledCount === 1 ? "Verbesserung" : "Verbesserungen"})
              </button>

              <button
                className="btn btn-ghost"
                style={{ padding: "8px 0", fontSize: "13px" }}
                onClick={() => {
                  setOriginalFile(null);
                  setProcessedFile(null);
                }}
              >
                Andere Datei hochladen
              </button>
            </div>
          </>
        )}

        {/* Processed Audio */}
        {processedFile && (
          <div className="flex flex-col animate-scale-in" style={{ width: "100%", gap: "24px" }}>
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
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--color-success)",
                }}
              >
                Audio erfolgreich bereinigt
              </span>
            </div>

            <AudioPlayer
              file={processedFile}
              isProcessed
              onDownload={handleDownload}
            />

            <button
              className="btn btn-ghost"
              style={{ padding: "8px 0", fontSize: "13px", alignSelf: "flex-start" }}
              onClick={() => {
                setOriginalFile(null);
                setProcessedFile(null);
              }}
            >
              Weitere Datei bereinigen
            </button>
          </div>
        )}
      </div>

      <ProcessingModal isOpen={isProcessing} onComplete={handleProcessingComplete} />
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={hideToast}
      />
    </div>
  );
}

/**
 * KlangRein - KI-gesteuerte Audio-Verbesserung
 * Theme: Premium dark with violet/purple glassmorphism
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
      icon: <Wind size={24} />,
      enabled: true,
    },
    {
      id: "fillers",
      label: "Füllwörter",
      description: "Entfernt 'äh', 'ähm', 'also' und Zögern",
      icon: <MessageSquare size={24} />,
      enabled: true,
    },
    {
      id: "enhance",
      label: "Stimmverbesserung",
      description: "Verbessert Klarheit & Stimmpräsenz",
      icon: <Volume size={24} />,
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
      showToast(
        "Bitte wähle mindestens eine Verbesserung aus",
        "error"
      );
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
      }}
    >
      {/* Animated Background */}
      <div className="bg-mesh" />
      <div className="particles">
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
        <div className="particle" />
      </div>

      {/* Main Content */}
      <div
        className="flex flex-col items-center"
        style={{
          position: "relative",
          zIndex: 1,
          padding: "48px 24px 80px",
          minHeight: "100vh",
        }}
      >
        {/* Logo / Brand */}
        <div
          className="flex items-center animate-fade-in"
          style={{ gap: "14px", marginBottom: "56px" }}
        >
          <div
            className="flex items-center justify-center animate-glow"
            style={{
              width: "44px",
              height: "44px",
              background: "linear-gradient(135deg, #8b5cf6, #c084fc)",
              borderRadius: "14px",
            }}
          >
            <AudioLines size={24} color="#fff" />
          </div>
          <h1
            className="gradient-text"
            style={{
              fontSize: "30px",
              fontWeight: 800,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            KlangRein
          </h1>
        </div>

        <div
          className="flex flex-col items-center"
          style={{
            maxWidth: "860px",
            width: "100%",
            gap: "36px",
          }}
        >
          {/* Hero Text */}
          {!originalFile && (
            <div
              className="flex flex-col items-center animate-slide-up"
              style={{ gap: "18px", marginBottom: "28px" }}
            >
              <h2
                style={{
                  fontSize: "clamp(36px, 5vw, 56px)",
                  fontWeight: 800,
                  color: "#f4f4f5",
                  margin: 0,
                  textAlign: "center",
                  lineHeight: "1.15",
                  letterSpacing: "-0.03em",
                }}
              >
                Dein Audio.
                <br />
                <span className="gradient-text">Kristallklar.</span>
              </h2>
              <p
                style={{
                  fontSize: "18px",
                  color: "#a1a1aa",
                  margin: 0,
                  textAlign: "center",
                  maxWidth: "520px",
                  lineHeight: "1.6",
                }}
              >
                KI-gesteuerte Audio-Verbesserung. Entferne Rauschen, Füllwörter
                und steigere die Klarheit deiner Aufnahmen.
              </p>
            </div>
          )}

          {/* Upload Zone or Audio Player */}
          {!originalFile ? (
            <label
              className={`upload-zone ${isDragging ? "drag-over" : ""} animate-slide-up`}
              style={{
                width: "100%",
                padding: "72px 32px",
                cursor: "pointer",
                display: "block",
                animationDelay: "0.1s",
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
              <div
                className="flex flex-col items-center"
                style={{ gap: "24px", position: "relative", zIndex: 1 }}
              >
                <div
                  className="flex items-center justify-center animate-float"
                  style={{
                    width: "88px",
                    height: "88px",
                    background:
                      "linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(192, 132, 252, 0.1))",
                    borderRadius: "22px",
                    border: "1px solid rgba(139, 92, 246, 0.2)",
                  }}
                >
                  <Upload size={40} color="#a78bfa" />
                </div>
                <div
                  className="flex flex-col items-center"
                  style={{ gap: "10px" }}
                >
                  <p
                    style={{
                      fontSize: "20px",
                      fontWeight: 700,
                      color: "#f4f4f5",
                      margin: 0,
                    }}
                  >
                    Audio-Datei hierher ziehen
                  </p>
                  <p
                    style={{
                      fontSize: "15px",
                      color: "#71717a",
                      margin: 0,
                    }}
                  >
                    oder klicken zum Durchsuchen — MP3, WAV, M4A, FLAC
                  </p>
                </div>
              </div>
            </label>
          ) : (
            <div
              className="flex flex-col animate-scale-in"
              style={{ width: "100%", gap: "24px" }}
            >
              <AudioPlayer file={originalFile} />
            </div>
          )}

          {/* Cleaning Options */}
          {originalFile && !processedFile && (
            <>
              <div
                className="flex flex-col animate-slide-up"
                style={{ width: "100%", gap: "20px" }}
              >
                <h3
                  style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#f4f4f5",
                    margin: 0,
                    textAlign: "center",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Audio-Verbesserungen auswählen
                </h3>
                <div
                  className="flex"
                  style={{
                    gap: "16px",
                    width: "100%",
                    justifyContent: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {options.map((option) => (
                    <button
                      key={option.id}
                      className={`option-card ${option.enabled ? "active" : ""}`}
                      style={{
                        flex: "1 1 230px",
                        maxWidth: "270px",
                        textAlign: "center",
                        border: option.enabled
                          ? undefined
                          : "2px solid rgba(63, 63, 80, 0.3)",
                      }}
                      onClick={() => toggleOption(option.id)}
                    >
                      <div
                        className="flex flex-col items-center"
                        style={{ gap: "14px", position: "relative", zIndex: 1 }}
                      >
                        <div
                          className={`icon-box ${option.enabled ? "icon-box-accent" : "icon-box-muted"}`}
                          style={{
                            width: "56px",
                            height: "56px",
                            position: "relative",
                          }}
                        >
                          {option.icon}
                          {option.enabled && (
                            <div
                              style={{
                                position: "absolute",
                                top: "-6px",
                                right: "-6px",
                                width: "22px",
                                height: "22px",
                                background:
                                  "linear-gradient(135deg, #8b5cf6, #c084fc)",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 2px 8px rgba(139, 92, 246, 0.4)",
                              }}
                            >
                              <Check size={12} color="#fff" />
                            </div>
                          )}
                        </div>
                        <div
                          className="flex flex-col items-center"
                          style={{ gap: "6px" }}
                        >
                          <h4
                            style={{
                              fontSize: "15px",
                              fontWeight: 700,
                              color: option.enabled ? "#f4f4f5" : "#71717a",
                              margin: 0,
                            }}
                          >
                            {option.label}
                          </h4>
                          <p
                            style={{
                              fontSize: "13px",
                              color: "#71717a",
                              margin: 0,
                              textAlign: "center",
                              lineHeight: "1.5",
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

              <button
                className="btn btn-primary flex items-center justify-center"
                style={{
                  width: "100%",
                  maxWidth: "420px",
                  padding: "18px 36px",
                  fontSize: "16px",
                  fontWeight: 700,
                  gap: "12px",
                  borderRadius: "16px",
                }}
                onClick={handleProcess}
                disabled={isProcessing || enabledCount === 0}
              >
                <Sparkles size={20} />
                Audio bereinigen ({enabledCount}{" "}
                {enabledCount === 1 ? "Verbesserung" : "Verbesserungen"})
              </button>

              <button
                className="btn btn-ghost"
                style={{ padding: "10px 20px", fontSize: "14px" }}
                onClick={() => {
                  setOriginalFile(null);
                  setProcessedFile(null);
                }}
              >
                Andere Datei hochladen
              </button>
            </>
          )}

          {/* Processed Audio */}
          {processedFile && (
            <div
              className="flex flex-col items-center animate-scale-in"
              style={{ width: "100%", gap: "28px" }}
            >
              <div
                className="flex items-center"
                style={{
                  gap: "12px",
                  padding: "14px 28px",
                  background: "rgba(52, 211, 153, 0.08)",
                  border: "1px solid rgba(52, 211, 153, 0.25)",
                  borderRadius: "14px",
                  backdropFilter: "blur(8px)",
                }}
              >
                <Check size={20} color="#34d399" />
                <span
                  style={{
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#34d399",
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
                style={{ padding: "10px 20px", fontSize: "14px" }}
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

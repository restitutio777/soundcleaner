"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle } from "lucide-react";

interface ProcessingModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

interface ProcessingStep {
  label: string;
  status: "pending" | "processing" | "complete";
}

export default function ProcessingModal({
  isOpen,
  onComplete,
}: ProcessingModalProps) {
  const [progress, setProgress] = useState(0);
  const [steps, setSteps] = useState<ProcessingStep[]>([
    { label: "Audioqualität analysieren", status: "pending" },
    { label: "Hintergrundgeräusche entfernen", status: "pending" },
    { label: "Füllwörter erkennen", status: "pending" },
    { label: "Stimmklarheit verbessern", status: "pending" },
    { label: "Audio finalisieren", status: "pending" },
  ]);

  useEffect(() => {
    if (!isOpen) {
      setProgress(0);
      setSteps((prev) =>
        prev.map((step) => ({ ...step, status: "pending" }))
      );
      return;
    }

    let currentProgress = 0;
    let currentStep = 0;

    const interval = setInterval(() => {
      currentProgress += 2;
      setProgress(currentProgress);

      const stepProgress = Math.floor(
        (currentProgress / 100) * steps.length
      );
      if (stepProgress > currentStep) {
        setSteps((prev) =>
          prev.map((step, i) => {
            if (i < stepProgress) return { ...step, status: "complete" };
            if (i === stepProgress) return { ...step, status: "processing" };
            return step;
          })
        );
        currentStep = stepProgress;
      }

      if (currentProgress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          onComplete();
        }, 500);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isOpen, onComplete, steps.length]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop animate-scale-in">
      <div
        className="modal"
        style={{
          width: "500px",
          padding: "40px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center" style={{ gap: "28px" }}>
          {/* Animated Icon */}
          <div
            className="flex items-center justify-center"
            style={{
              width: "88px",
              height: "88px",
              background:
                progress >= 100
                  ? "rgba(52, 211, 153, 0.12)"
                  : "rgba(139, 92, 246, 0.12)",
              borderRadius: "50%",
              border: `2px solid ${progress >= 100 ? "rgba(52, 211, 153, 0.3)" : "rgba(139, 92, 246, 0.25)"}`,
              transition: "all 0.5s",
            }}
          >
            {progress >= 100 ? (
              <CheckCircle size={42} color="#34d399" />
            ) : (
              <Loader2
                size={42}
                color="#a78bfa"
                className="animate-spin"
              />
            )}
          </div>

          {/* Title */}
          <div
            className="flex flex-col items-center"
            style={{ gap: "8px" }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "24px",
                fontWeight: 800,
                color: "#f4f4f5",
                letterSpacing: "-0.02em",
              }}
            >
              {progress >= 100
                ? "Verarbeitung abgeschlossen!"
                : "Audio wird verarbeitet"}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "14px",
                color: "#71717a",
                textAlign: "center",
              }}
            >
              {progress >= 100
                ? "Dein Audio wurde erfolgreich bereinigt"
                : "Das kann einen Moment dauern..."}
            </p>
          </div>

          {/* Progress Bar */}
          <div style={{ width: "100%" }}>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div
              className="flex items-center justify-between"
              style={{ marginTop: "10px" }}
            >
              <span style={{ fontSize: "13px", color: "#71717a" }}>
                Fortschritt
              </span>
              <span
                className="gradient-text"
                style={{ fontSize: "13px", fontWeight: 700 }}
              >
                {progress}%
              </span>
            </div>
          </div>

          {/* Steps */}
          <div
            className="flex flex-col"
            style={{
              width: "100%",
              gap: "10px",
              padding: "16px 20px",
              background: "rgba(15, 15, 20, 0.4)",
              borderRadius: "14px",
              border: "1px solid rgba(63, 63, 80, 0.3)",
            }}
          >
            {steps.map((step, index) => (
              <div
                key={index}
                className="flex items-center"
                style={{ gap: "12px" }}
              >
                <div
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                      step.status === "complete"
                        ? "linear-gradient(135deg, #8b5cf6, #c084fc)"
                        : step.status === "processing"
                          ? "rgba(139, 92, 246, 0.2)"
                          : "rgba(63, 63, 80, 0.3)",
                    border:
                      step.status === "processing"
                        ? "2px solid #8b5cf6"
                        : "none",
                    transition: "all 0.3s",
                    flexShrink: 0,
                  }}
                >
                  {step.status === "complete" && (
                    <CheckCircle size={13} color="#fff" />
                  )}
                  {step.status === "processing" && (
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: "#a78bfa",
                      }}
                      className="animate-pulse"
                    />
                  )}
                </div>
                <span
                  style={{
                    fontSize: "14px",
                    color:
                      step.status === "pending" ? "#52525b" : "#e4e4e7",
                    fontWeight:
                      step.status === "processing" ? 600 : 400,
                    transition: "all 0.3s",
                  }}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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
        style={{ width: "460px", padding: "36px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col" style={{ gap: "28px" }}>
          {/* Icon */}
          <div
            className="flex items-center justify-center"
            style={{
              width: "56px",
              height: "56px",
              background:
                progress >= 100
                  ? "var(--color-success-bg)"
                  : "var(--color-accent-muted)",
              borderRadius: "3px",
              transition: "background-color 0.3s",
            }}
          >
            {progress >= 100 ? (
              <CheckCircle size={28} color="var(--color-success)" />
            ) : (
              <Loader2
                size={28}
                color="var(--color-accent)"
                className="animate-spin"
              />
            )}
          </div>

          {/* Title */}
          <div className="flex flex-col" style={{ gap: "6px" }}>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "22px",
                fontWeight: 400,
                color: "var(--color-foreground)",
              }}
            >
              {progress >= 100
                ? "Verarbeitung abgeschlossen"
                : "Audio wird verarbeitet"}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "14px",
                color: "var(--color-foreground-subtle)",
              }}
            >
              {progress >= 100
                ? "Dein Audio wurde erfolgreich bereinigt."
                : "Das kann einen Moment dauern\u2026"}
            </p>
          </div>

          {/* Progress */}
          <div style={{ width: "100%" }}>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div
              className="flex items-center justify-between"
              style={{ marginTop: "8px" }}
            >
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--color-foreground-subtle)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Fortschritt
              </span>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "var(--color-accent)",
                }}
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
              gap: "8px",
              padding: "14px 16px",
              background: "var(--color-surface)",
              borderRadius: "3px",
              border: "1px solid var(--color-border)",
            }}
          >
            {steps.map((step, index) => (
              <div
                key={index}
                className="flex items-center"
                style={{ gap: "10px" }}
              >
                <div
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "2px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    background:
                      step.status === "complete"
                        ? "var(--color-accent)"
                        : step.status === "processing"
                          ? "var(--color-accent-muted)"
                          : "var(--color-indigo-muted)",
                    border:
                      step.status === "processing"
                        ? "1px solid var(--color-accent)"
                        : "1px solid transparent",
                    transition: "all 0.2s",
                  }}
                >
                  {step.status === "complete" && (
                    <CheckCircle size={11} color="#fff" />
                  )}
                  {step.status === "processing" && (
                    <div
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "1px",
                        background: "var(--color-accent)",
                      }}
                      className="animate-pulse"
                    />
                  )}
                </div>
                <span
                  style={{
                    fontSize: "13px",
                    color:
                      step.status === "pending"
                        ? "var(--color-foreground-subtle)"
                        : "var(--color-foreground)",
                    fontWeight: step.status === "processing" ? 600 : 400,
                    transition: "color 0.2s",
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

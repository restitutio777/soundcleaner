"use client";

import { Loader as Loader2, CircleCheck as CheckCircle, CircleAlert as AlertCircle } from "lucide-react";

interface ProcessingModalProps {
  isOpen: boolean;
  currentStep: string;
  percent: number;
  error?: string | null;
}

// Schritte sind jetzt außerhalb gerendert – Modal zeigt nur Echtzeit-Fortschritt
export default function ProcessingModal({
  isOpen,
  currentStep,
  percent,
  error,
}: ProcessingModalProps) {
  if (!isOpen) return null;

  const isDone = percent >= 100;
  const hasError = !!error;

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
              background: hasError
                ? "var(--color-danger-bg)"
                : isDone
                  ? "var(--color-success-bg)"
                  : "var(--color-accent-muted)",
              borderRadius: "3px",
              transition: "background-color 0.3s",
            }}
          >
            {hasError ? (
              <AlertCircle size={28} color="var(--color-danger)" />
            ) : isDone ? (
              <CheckCircle size={28} color="var(--color-success)" />
            ) : (
              <Loader2
                size={28}
                color="var(--color-accent)"
                className="animate-spin"
              />
            )}
          </div>

          {/* Titel */}
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
              {hasError
                ? "Fehler bei der Verarbeitung"
                : isDone
                  ? "Verarbeitung abgeschlossen"
                  : "Audio wird verarbeitet"}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "14px",
                color: hasError ? "var(--color-danger)" : "var(--color-foreground-subtle)",
              }}
            >
              {hasError
                ? error
                : isDone
                  ? "Dein Audio wurde erfolgreich bereinigt."
                  : currentStep + "\u2026"}
            </p>
          </div>

          {/* Fortschrittsbalken */}
          {!hasError && (
            <div style={{ width: "100%" }}>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${percent}%`,
                    background: isDone ? "var(--color-success)" : "var(--color-accent)",
                    transition: "width 0.2s ease",
                  }}
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
                    color: isDone ? "var(--color-success)" : "var(--color-accent)",
                  }}
                >
                  {Math.round(percent)}%
                </span>
              </div>
            </div>
          )}

          {/* Aktueller Schritt als Anzeige */}
          {!hasError && !isDone && (
            <div
              style={{
                padding: "12px 16px",
                background: "var(--color-surface)",
                borderRadius: "3px",
                border: "1px solid var(--color-border)",
                fontSize: "13px",
                color: "var(--color-foreground)",
                fontWeight: 600,
              }}
            >
              {currentStep}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

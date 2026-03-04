"use client";

import { useEffect, useRef } from "react";
import { Loader as Loader2, CircleCheck as CheckCircle, CircleAlert as AlertCircle } from "lucide-react";

interface ProcessingModalProps {
  isOpen: boolean;
  currentStep: string;
  percent: number;
  error?: string | null;
}

export default function ProcessingModal({
  isOpen,
  currentStep,
  percent,
  error,
}: ProcessingModalProps) {
  // Erledigte Schritte als Liste anzeigen – zeigt dem Nutzer was bereits passiert ist
  const completedStepsRef = useRef<string[]>([]);
  const lastStepRef = useRef<string>("");

  useEffect(() => {
    if (!isOpen) {
      // Modal schließt: Liste zurücksetzen
      completedStepsRef.current = [];
      lastStepRef.current = "";
      return;
    }

    // Neuen Schritt zur erledigten Liste hinzufügen wenn er sich ändert
    if (
      currentStep &&
      currentStep !== lastStepRef.current &&
      currentStep !== "Fertig" &&
      lastStepRef.current !== ""
    ) {
      completedStepsRef.current = [...completedStepsRef.current, lastStepRef.current];
    }
    lastStepRef.current = currentStep;
  }, [isOpen, currentStep]);

  if (!isOpen) return null;

  const isDone = percent >= 100;
  const hasError = !!error;
  const completedSteps = completedStepsRef.current;

  return (
    <div className="modal-backdrop animate-scale-in">
      <div
        className="modal"
        style={{ width: "480px", padding: "36px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col" style={{ gap: "24px" }}>

          {/* Status-Icon */}
          <div
            className="flex items-center justify-center"
            style={{
              width: "52px",
              height: "52px",
              background: hasError
                ? "var(--color-danger-bg)"
                : isDone
                  ? "var(--color-success-bg)"
                  : "var(--color-accent-muted)",
              borderRadius: "3px",
              transition: "background-color 0.3s",
              flexShrink: 0,
            }}
          >
            {hasError ? (
              <AlertCircle size={26} color="var(--color-danger)" />
            ) : isDone ? (
              <CheckCircle size={26} color="var(--color-success)" />
            ) : (
              <Loader2 size={26} color="var(--color-accent)" className="animate-spin" />
            )}
          </div>

          {/* Titel und Untertitel */}
          <div className="flex flex-col" style={{ gap: "5px" }}>
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
                ? "Verarbeitung fehlgeschlagen"
                : isDone
                  ? "Audio bereinigt"
                  : "Audio wird verarbeitet\u2026"}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "13px",
                color: hasError
                  ? "var(--color-danger)"
                  : "var(--color-foreground-subtle)",
                lineHeight: 1.5,
              }}
            >
              {hasError
                ? error
                : isDone
                  ? "Alle Schritte abgeschlossen. Die bereinigte Datei ist bereit zum Abhören und Herunterladen."
                  : "Bitte warten – die Datei wird direkt im Browser verarbeitet, kein Upload nötig."}
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
                    transition: "width 0.25s ease",
                  }}
                />
              </div>
              <div
                className="flex items-center justify-between"
                style={{ marginTop: "7px" }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--color-foreground-subtle)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  Fortschritt
                </span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: isDone ? "var(--color-success)" : "var(--color-accent)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round(percent)}%
                </span>
              </div>
            </div>
          )}

          {/* Schritt-Protokoll: erledigte Schritte + aktiver Schritt */}
          {!hasError && (
            <div
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "3px",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: "7px",
                maxHeight: "190px",
                overflowY: "auto",
              }}
            >
              {/* Abgeschlossene Schritte */}
              {completedSteps.map((step, i) => (
                <div key={i} className="flex items-center" style={{ gap: "9px" }}>
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "2px",
                      background: "var(--color-accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <CheckCircle size={10} color="#fff" />
                  </div>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--color-foreground-subtle)",
                    }}
                  >
                    {step}
                  </span>
                </div>
              ))}

              {/* Aktiver Schritt (pulsiert) */}
              {!isDone && currentStep && (
                <div className="flex items-center" style={{ gap: "9px" }}>
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "2px",
                      background: "var(--color-accent-muted)",
                      border: "1px solid var(--color-accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                    className="animate-pulse"
                  >
                    <div
                      style={{
                        width: "5px",
                        height: "5px",
                        borderRadius: "1px",
                        background: "var(--color-accent)",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--color-foreground)",
                    }}
                  >
                    {currentStep}
                  </span>
                </div>
              )}

              {/* Fertig-Zeile */}
              {isDone && (
                <div className="flex items-center" style={{ gap: "9px" }}>
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "2px",
                      background: "var(--color-success)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <CheckCircle size={10} color="#fff" />
                  </div>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--color-success)",
                    }}
                  >
                    Alle Schritte abgeschlossen
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Hinweis: Verarbeitung läuft im Browser */}
          {!hasError && !isDone && (
            <p
              style={{
                margin: 0,
                fontSize: "11px",
                color: "var(--color-foreground-subtle)",
                lineHeight: 1.5,
                opacity: 0.7,
              }}
            >
              Die Verarbeitung erfolgt vollständig in deinem Browser – deine Aufnahme wird nicht hochgeladen.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

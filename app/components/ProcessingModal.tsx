"use client";

import { useEffect, useState, useRef } from "react";
import { Loader as Loader2, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Clock, TrendingUp, Scissors } from "lucide-react";
import type { ProcessingStats } from "../lib/audioProcessor";

interface ProcessingModalProps {
  isOpen: boolean;
  currentStep: string;
  percent: number;
  completedSteps: string[];     // Von page.tsx gepflegt – kein interner Ref nötig
  stats?: ProcessingStats | null;
  error?: string | null;
}

// Sekunden in "0:00" formatieren
function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ProcessingModal({
  isOpen,
  currentStep,
  percent,
  completedSteps,
  stats,
  error,
}: ProcessingModalProps) {
  const isDone = percent >= 100;
  const hasError = !!error;

  // Countdown für automatisches Schließen nach Fehler (2,5 Sekunden)
  const [errorCountdown, setErrorCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (hasError && isOpen) {
      // Countdown von 2,5s → 0 in 50ms-Schritten
      setErrorCountdown(100);
      timerRef.current = setInterval(() => {
        setErrorCountdown((v) => {
          if (v <= 2) {
            clearInterval(timerRef.current!);
            return 0;
          }
          return v - 2; // 100 Schritte × 2 = 200 × 12.5ms ≈ 2.5s
        });
      }, 25);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasError, isOpen]);

  if (!isOpen) return null;

  // Zeitersparnis berechnen für Statistik-Anzeige
  const timeSaved = stats
    ? Math.max(0, stats.originalDuration - stats.processedDuration)
    : 0;

  return (
    <div className="modal-backdrop animate-scale-in">
      <div
        className="modal"
        style={{ width: "500px", padding: "36px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col" style={{ gap: "22px" }}>

          {/* ── Status-Icon ── */}
          <div
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "3px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: hasError
                ? "var(--color-danger-bg)"
                : isDone
                  ? "var(--color-success-bg)"
                  : "var(--color-accent-muted)",
              transition: "background-color 0.35s ease",
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

          {/* ── Titel ── */}
          <div className="flex flex-col" style={{ gap: "4px" }}>
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "22px",
                fontWeight: 400,
                color: "var(--color-foreground)",
                lineHeight: 1.2,
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
                color: hasError ? "var(--color-danger)" : "var(--color-foreground-subtle)",
                lineHeight: 1.55,
              }}
            >
              {hasError
                ? error
                : isDone
                  ? "Alle Schritte abgeschlossen. Die bereinigte Datei ist bereit zum Abhören und Herunterladen."
                  : "Bitte warten\u200B – die Datei wird direkt im Browser verarbeitet, kein Upload nötig."}
            </p>
          </div>

          {/* ── Fehler-Countdown-Balken ── */}
          {hasError && (
            <div style={{ width: "100%" }}>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${errorCountdown}%`,
                    background: "var(--color-danger)",
                    transition: "width 0.025s linear",
                  }}
                />
              </div>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "11px",
                  color: "var(--color-foreground-subtle)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Fenster schließt automatisch…
              </p>
            </div>
          )}

          {/* ── Fortschrittsbalken (während Verarbeitung) ── */}
          {!hasError && (
            <div style={{ width: "100%" }}>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{
                    width: `${percent}%`,
                    background: isDone ? "var(--color-success)" : "var(--color-accent)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div
                className="flex items-center justify-between"
                style={{ marginTop: "6px" }}
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

          {/* ── Schritt-Protokoll ── */}
          {!hasError && (
            <StepLog
              completedSteps={completedSteps}
              currentStep={currentStep}
              isDone={isDone}
            />
          )}

          {/* ── Statistik-Zusammenfassung (nur wenn fertig) ── */}
          {isDone && stats && (
            <ProcessingStatsSummary stats={stats} timeSaved={timeSaved} />
          )}

          {/* ── Datenschutz-Hinweis (nur während Verarbeitung) ── */}
          {!hasError && !isDone && (
            <p
              style={{
                margin: 0,
                fontSize: "11px",
                color: "var(--color-foreground-subtle)",
                opacity: 0.65,
                lineHeight: 1.5,
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

// ─── Schritt-Protokoll-Unterkomponente ───────────────────────────────────────

interface StepLogProps {
  completedSteps: string[];
  currentStep: string;
  isDone: boolean;
}

function StepLog({ completedSteps, currentStep, isDone }: StepLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Automatisch zum Ende scrollen wenn neue Schritte hinzukommen
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [completedSteps.length, isDone]);

  return (
    <div
      ref={scrollRef}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "3px",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        maxHeight: "176px",
        overflowY: "auto",
        scrollBehavior: "smooth",
      }}
    >
      {/* Abgeschlossene Schritte mit Häkchen */}
      {completedSteps.map((step, i) => (
        <div key={i} className="flex items-center" style={{ gap: "9px", flexShrink: 0 }}>
          <div
            style={{
              width: "15px",
              height: "15px",
              borderRadius: "2px",
              background: "var(--color-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <CheckCircle size={9} color="#fff" />
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-foreground-subtle)" }}>
            {step}
          </span>
        </div>
      ))}

      {/* Aktiver Schritt mit pulsierender Markierung */}
      {!isDone && currentStep && (
        <div className="flex items-center" style={{ gap: "9px", flexShrink: 0 }}>
          <div
            className="animate-pulse"
            style={{
              width: "15px",
              height: "15px",
              borderRadius: "2px",
              background: "var(--color-accent-muted)",
              border: "1.5px solid var(--color-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
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
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-foreground)" }}>
            {currentStep}
          </span>
        </div>
      )}

      {/* Abschluss-Zeile */}
      {isDone && (
        <div className="flex items-center" style={{ gap: "9px", flexShrink: 0 }}>
          <div
            style={{
              width: "15px",
              height: "15px",
              borderRadius: "2px",
              background: "var(--color-success)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <CheckCircle size={9} color="#fff" />
          </div>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-success)" }}>
            Alle Schritte abgeschlossen
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Statistik-Zusammenfassung Unterkomponente ────────────────────────────────

interface ProcessingStatsSummaryProps {
  stats: ProcessingStats;
  timeSaved: number;
}

function ProcessingStatsSummary({ stats, timeSaved }: ProcessingStatsSummaryProps) {
  const gainSign = stats.gainAppliedDb >= 0 ? "+" : "";
  const lufsRounded = Math.round(stats.estimatedLufs);

  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "3px",
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "12px",
      }}
    >
      {/* Originallänge → Verarbeitete Länge */}
      <StatCard
        icon={<Clock size={13} color="var(--color-accent)" />}
        label="Dauer"
        value={`${formatDuration(stats.originalDuration)} → ${formatDuration(stats.processedDuration)}`}
        sub={timeSaved >= 1 ? `${formatDuration(timeSaved)} eingespart` : "keine Pausen gefunden"}
      />

      {/* Gain-Korrektur */}
      <StatCard
        icon={<TrendingUp size={13} color="var(--color-accent)" />}
        label="Gain"
        value={`${gainSign}${stats.gainAppliedDb.toFixed(1)} dB`}
        sub={`von ${lufsRounded} LUFS → -16 LUFS`}
      />

      {/* Anzahl gekürzter Pausen */}
      <StatCard
        icon={<Scissors size={13} color="var(--color-accent)" />}
        label="Pausen"
        value={`${stats.silenceRegionsFound}`}
        sub={stats.silenceRegionsFound === 1 ? "Region gekürzt" : "Regionen gekürzt"}
      />
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}

function StatCard({ icon, label, value, sub }: StatCardProps) {
  return (
    <div className="flex flex-col" style={{ gap: "5px" }}>
      <div className="flex items-center" style={{ gap: "5px" }}>
        {icon}
        <span
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--color-foreground-subtle)",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "var(--color-foreground)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: "11px", color: "var(--color-foreground-subtle)", lineHeight: 1.3 }}>
        {sub}
      </span>
    </div>
  );
}

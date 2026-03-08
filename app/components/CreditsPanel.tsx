"use client";

import { useState } from "react";
import { Coins, ChevronDown, ChevronUp, LogOut, User, ArrowLeft, Check } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCredits } from "../hooks/useCredits";
import { CREDIT_PACKAGES } from "../lib/supabaseClient";

type ConfirmState = { packageId: string; label: string; display: string } | null;

interface CreditsPanelProps {
  onLoginClick: () => void;
  onBuyCreditsClick: (packageId: string) => void;
}

export default function CreditsPanel({ onLoginClick, onBuyCreditsClick }: CreditsPanelProps) {
  const { user, signOut } = useAuth();
  const { credits, formatCredits } = useCredits();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [submitted, setSubmitted] = useState(false);

  // Prozentualer Anteil des Guthabens (max 10 Stunden als Referenz)
  const creditPercent = credits
    ? Math.min(100, (credits.credits_seconds / 36000) * 100)
    : 0;

  const isLow = credits ? credits.credits_seconds < 300 : false;

  if (!user) {
    return (
      <button
        className="btn btn-secondary flex items-center"
        style={{ padding: "8px 16px", gap: "8px", fontSize: "12px" }}
        onClick={onLoginClick}
      >
        <User size={14} />
        Anmelden
      </button>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="flex items-center"
        style={{
          background: "var(--color-elevated)",
          border: `1px solid ${isLow ? "rgba(248, 113, 113, 0.4)" : "var(--color-border)"}`,
          borderRadius: "10px",
          padding: "8px 14px",
          gap: "10px",
          cursor: "pointer",
          transition: "border-color 0.2s",
        }}
        onClick={() => {
          setMenuOpen((v) => {
            if (v) { setConfirm(null); setSubmitted(false); }
            return !v;
          });
        }}
      >
        {/* Guthaben-Anzeige */}
        <div className="flex items-center" style={{ gap: "8px" }}>
          <Coins size={15} color={isLow ? "var(--color-danger)" : "var(--color-accent)"} />
          <div className="flex flex-col items-start" style={{ gap: "2px" }}>
            <span
              style={{
                fontSize: "11px",
                color: "var(--color-foreground-subtle)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              Guthaben
            </span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: isLow ? "var(--color-danger)" : "var(--color-foreground)",
                lineHeight: 1,
              }}
            >
              {credits ? formatCredits(credits.credits_seconds) : "—"}
            </span>
          </div>
        </div>

        {/* Mini-Fortschrittsbalken */}
        <div
          style={{
            width: "48px",
            height: "4px",
            background: "rgba(76, 78, 115, 0.3)",
            borderRadius: "2px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${creditPercent}%`,
              background: isLow ? "var(--color-danger)" : "var(--color-accent)",
              borderRadius: "2px",
              transition: "width 0.3s",
            }}
          />
        </div>

        {menuOpen ? <ChevronUp size={14} color="var(--color-foreground-subtle)" /> : <ChevronDown size={14} color="var(--color-foreground-subtle)" />}
      </button>

      {/* Dropdown-Menü */}
      {menuOpen && (
        <div
          className="animate-slide-down"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "var(--color-elevated)",
            border: "1px solid var(--color-border)",
            borderRadius: "12px",
            width: "260px",
            zIndex: 40,
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Nutzerprofil */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <p style={{ margin: 0, fontSize: "13px", color: "var(--color-foreground)", fontWeight: 600 }}>
              {user.email}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--color-foreground-subtle)" }}>
              {credits?.is_pro ? "Pro-Konto" : "Free-Konto"}
            </p>
          </div>

          {/* Guthaben-Info */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            {submitted ? (
              <div className="flex flex-col items-center" style={{ gap: "10px", padding: "8px 0" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    background: "rgba(74, 222, 128, 0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Check size={18} color="var(--color-success)" />
                </div>
                <p style={{ margin: 0, fontSize: "13px", color: "var(--color-foreground)", fontWeight: 600, textAlign: "center" }}>
                  Danke!
                </p>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--color-foreground-subtle)", lineHeight: 1.6, textAlign: "center" }}>
                  Die Bezahlung wird in den naechsten Tagen freigeschaltet. Wir benachrichtigen dich per E-Mail.
                </p>
              </div>
            ) : confirm ? (
              <div className="flex flex-col" style={{ gap: "10px" }}>
                <button
                  className="btn btn-ghost flex items-center"
                  style={{ padding: "2px 0", gap: "4px", fontSize: "12px", justifyContent: "flex-start", textTransform: "none", letterSpacing: 0 }}
                  onClick={() => setConfirm(null)}
                >
                  <ArrowLeft size={13} />
                  Zurueck
                </button>
                <p style={{ margin: 0, fontSize: "13px", color: "var(--color-foreground)", lineHeight: 1.6 }}>
                  <strong>{confirm.label}</strong> fuer <strong>{confirm.display}</strong> kaufen?
                </p>
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", padding: "10px 16px", fontSize: "13px" }}
                  onClick={() => {
                    onBuyCreditsClick(confirm.packageId);
                    setSubmitted(true);
                  }}
                >
                  Ja, ich will kaufen
                </button>
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--color-foreground-subtle)", lineHeight: 1.6 }}>
                  Kaufe Credits, um laengere oder professionelle Aufnahmen zu verarbeiten.
                  Dein Guthaben wird pro Minute verarbeitetem Audio abgezogen.
                </p>
                <div className="flex flex-col" style={{ gap: "6px" }}>
                  {CREDIT_PACKAGES.map((pkg) => (
                    <button
                      key={pkg.id}
                      className="btn btn-secondary flex items-center justify-between"
                      style={{ padding: "8px 12px", width: "100%", fontSize: "12px" }}
                      onClick={() => setConfirm({ packageId: pkg.id, label: pkg.label, display: pkg.display })}
                    >
                      <span>{pkg.label}</span>
                      <span style={{ fontWeight: 700, color: "var(--color-accent)" }}>{pkg.display}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Abmelden */}
          <button
            className="btn btn-ghost flex items-center"
            style={{ width: "100%", padding: "12px 16px", gap: "8px", justifyContent: "flex-start", fontSize: "13px" }}
            onClick={() => {
              setMenuOpen(false);
              signOut();
            }}
          >
            <LogOut size={14} />
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}

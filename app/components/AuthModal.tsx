"use client";

import { useState } from "react";
import { X, Mail, Lock, Loader as Loader2, AudioLines } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: "login" | "register";
}

export default function AuthModal({ isOpen, onClose, defaultMode = "login" }: AuthModalProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">(defaultMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    if (mode === "login") {
      const { error } = await signIn(email, password);
      if (error) {
        setError("Anmeldung fehlgeschlagen. E-Mail oder Passwort falsch.");
      } else {
        onClose();
      }
    } else {
      const { error } = await signUp(email, password);
      if (error) {
        setError(error);
      } else {
        setSuccessMsg("Konto erstellt! Du kannst dich jetzt anmelden.");
        setMode("login");
      }
    }

    setLoading(false);
  };

  return (
    <div
      className="modal-backdrop animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal animate-scale-in"
        style={{ width: "420px", padding: "36px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: "28px" }}>
          <div className="flex flex-col" style={{ gap: "6px" }}>
            <div className="flex items-center" style={{ gap: "10px" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  background: "var(--color-accent-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AudioLines size={16} color="var(--color-accent)" />
              </div>
              <h2
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display)",
                  fontSize: "24px",
                  fontWeight: 400,
                  color: "var(--color-foreground)",
                }}
              >
                {mode === "login" ? "Anmelden" : "Konto erstellen"}
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--color-foreground-subtle)" }}>
              {mode === "login"
                ? "Willkommen zurück bei KlangRein"
                : "10 Minuten Startguthaben kostenlos"}
            </p>
          </div>
          <button
            className="btn btn-ghost"
            style={{ width: "36px", height: "36px", padding: 0, borderRadius: "10px", alignSelf: "flex-start" }}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {successMsg && (
          <div
            style={{
              padding: "12px 14px",
              marginBottom: "20px",
              background: "var(--color-success-bg)",
              border: "1px solid rgba(74, 222, 128, 0.2)",
              borderRadius: "10px",
              fontSize: "14px",
              color: "var(--color-success)",
            }}
          >
            {successMsg}
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "12px 14px",
              marginBottom: "20px",
              background: "var(--color-danger-bg)",
              border: "1px solid rgba(248, 113, 113, 0.2)",
              borderRadius: "10px",
              fontSize: "14px",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: "16px" }}>
          <div className="flex flex-col" style={{ gap: "6px" }}>
            <label
              style={{ fontSize: "12px", color: "var(--color-foreground-subtle)", textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              E-Mail
            </label>
            <div className="input-group">
              <Mail size={16} color="var(--color-foreground-subtle)" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="deine@email.de"
              />
            </div>
          </div>

          <div className="flex flex-col" style={{ gap: "6px" }}>
            <label
              style={{ fontSize: "12px", color: "var(--color-foreground-subtle)", textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              Passwort
            </label>
            <div className="input-group">
              <Lock size={16} color="var(--color-foreground-subtle)" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder={mode === "register" ? "Mindestens 6 Zeichen" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary flex items-center"
            style={{ padding: "14px", gap: "8px", width: "100%", justifyContent: "center", marginTop: "4px" }}
            disabled={loading}
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {mode === "login" ? "Anmelden" : "Konto erstellen"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <span style={{ fontSize: "14px", color: "var(--color-foreground-subtle)" }}>
            {mode === "login" ? "Noch kein Konto?" : "Bereits registriert?"}
          </span>{" "}
          <button
            className="btn btn-ghost"
            style={{
              padding: 0,
              fontSize: "14px",
              color: "var(--color-accent)",
              textDecoration: "underline",
              textTransform: "none",
              letterSpacing: 0,
            }}
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
              setSuccessMsg(null);
            }}
          >
            {mode === "login" ? "Jetzt registrieren" : "Zum Login"}
          </button>
        </div>
      </div>
    </div>
  );
}

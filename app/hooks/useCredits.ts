"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, type UserCredits } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export function useCredits() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<UserCredits | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCredits = useCallback(async () => {
    if (!user) {
      setCredits(null);
      return;
    }

    setLoading(true);
    const { data } = await supabase
      .from("user_credits")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    setCredits(data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  // Credits in Minuten und Sekunden formatieren
  const formatCredits = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    if (secs === 0) return `${mins} Min.`;
    return `${mins} Min. ${secs}s`;
  };

  // Prüfen ob genug Credits vorhanden sind
  const hasEnoughCredits = (durationSeconds: number): boolean => {
    if (!credits) return false;
    return credits.credits_seconds >= durationSeconds;
  };

  // Credits nach Verarbeitung abziehen
  const deductCredits = async (seconds: number): Promise<boolean> => {
    if (!user || !credits) return false;

    const { data, error } = await supabase.rpc("deduct_credits", {
      p_user_id: user.id,
      p_seconds: seconds,
    });

    if (error || data < 0) return false;

    // Lokalen State aktualisieren
    setCredits((prev) => prev ? { ...prev, credits_seconds: data } : null);
    return true;
  };

  // Job protokollieren
  const logJob = async (filename: string, durationSeconds: number, preset: string) => {
    if (!user) return;
    await supabase.from("processing_jobs").insert({
      user_id: user.id,
      filename,
      duration_seconds: Math.floor(durationSeconds),
      preset,
      status: "completed",
    });
  };

  return {
    credits,
    loading,
    formatCredits,
    hasEnoughCredits,
    deductCredits,
    logJob,
    refreshCredits: fetchCredits,
  };
}

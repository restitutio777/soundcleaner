"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function UsageCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    supabase.rpc("get_total_jobs_count").then(({ data }) => {
      if (typeof data === "number" && data > 0) setCount(data);
    });
  }, []);

  if (count === null) return null;

  return (
    <p
      style={{
        textAlign: "center",
        fontSize: "13px",
        color: "var(--color-foreground-subtle)",
        margin: 0,
        padding: "48px 0 0",
        letterSpacing: "0.01em",
      }}
    >
      {count.toLocaleString("de-DE")} Dateien bereinigt
    </p>
  );
}

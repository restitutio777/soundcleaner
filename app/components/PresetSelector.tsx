"use client";

import { BookOpen, Monitor, Mic } from "lucide-react";
import type { ProcessingPreset } from "../lib/audioProcessor";

interface Preset {
  id: ProcessingPreset;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const PRESETS: Preset[] = [
  {
    id: "kursaufnahme",
    label: "Kursaufnahme",
    description: "Optimiert für Online-Kurse: klare Stimme, kurze Pausen, hohe Verständlichkeit",
    icon: <BookOpen size={20} />,
  },
  {
    id: "webinar",
    label: "Webinar",
    description: "Für Live-Webinare: ausgewogene Dynamik, natürlicher Klang, breiter Empfangsbereich",
    icon: <Monitor size={20} />,
  },
  {
    id: "podcast",
    label: "Podcast",
    description: "Broadcast-Qualität: starke Kompression, Präsenz-Boost, professioneller Klang",
    icon: <Mic size={20} />,
  },
];

interface PresetSelectorProps {
  selected: ProcessingPreset;
  onChange: (preset: ProcessingPreset) => void;
}

export default function PresetSelector({ selected, onChange }: PresetSelectorProps) {
  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      <div className="flex flex-col" style={{ gap: "4px" }}>
        <h4
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "20px",
            fontWeight: 400,
            color: "var(--color-foreground)",
          }}
        >
          Preset auswählen
        </h4>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-foreground-subtle)", lineHeight: 1.6 }}>
          Pro-Version: Deine Aufnahme wird automatisch professionell geschnitten, Lautstärke angepasst
          und Rauschen reduziert. Wähle ein Preset passend für Webinar, Kurs oder Podcast.
        </p>
      </div>

      <div className="flex" style={{ gap: "10px", flexWrap: "wrap" }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`option-card ${selected === preset.id ? "active" : ""}`}
            style={{
              flex: "1 1 160px",
              textAlign: "left",
              padding: "16px",
            }}
            onClick={() => onChange(preset.id)}
          >
            <div className="flex flex-col" style={{ gap: "10px" }}>
              <div
                className={`icon-box ${selected === preset.id ? "icon-box-accent" : "icon-box-muted"}`}
                style={{ width: "38px", height: "38px" }}
              >
                {preset.icon}
              </div>
              <div className="flex flex-col" style={{ gap: "3px" }}>
                <h5
                  style={{
                    margin: 0,
                    fontSize: "13px",
                    fontWeight: 600,
                    color: selected === preset.id
                      ? "var(--color-foreground)"
                      : "var(--color-foreground-subtle)",
                  }}
                >
                  {preset.label}
                </h5>
                <p
                  style={{
                    margin: 0,
                    fontSize: "12px",
                    color: "var(--color-foreground-subtle)",
                    lineHeight: 1.5,
                  }}
                >
                  {preset.description}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

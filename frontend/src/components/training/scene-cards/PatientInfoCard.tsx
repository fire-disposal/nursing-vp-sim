import { ChevronDown, User } from "lucide-react";
import { useState } from "react";
import type { SceneCardProps } from "@/engine/scene-card";

const PERSONALITY_LABELS: Record<string, string> = {
  health_literacy_low: "健康素养低",
  verbosity_terse: "寡言",
  verbosity_verbose: "健谈",
  anxiety_trait_anxious: "易焦虑",
};

const BACKGROUND_SECTIONS: [string, string][] = [
  ["present_illness", "现病史"],
  ["past_history", "既往史"],
  ["medication_history", "用药史"],
  ["allergy_history", "过敏史"],
  ["family_history", "家族史"],
  ["social_history", "个人史"],
];

function CollapsibleSection({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{text}</p>}
    </div>
  );
}

export default function PatientInfoCard(props: SceneCardProps) {
  const cd = (props.recordDetail?.case_data as Record<string, unknown>) ?? {};
  const patient = (cd.patient_info as Record<string, unknown>) || {};
  const name = String(patient.name || "患者");
  const age = String(patient.age ?? "");
  const gender = String(patient.gender || "");
  const chiefComplaint = String(cd.chief_complaint || "无");
  const personality = (cd.personality as Record<string, string>) || {};

  const tags: string[] = [];
  const checked = new Set<string>();
  for (const [key, label] of Object.entries(PERSONALITY_LABELS)) {
    const idx = key.lastIndexOf("_");
    const trait = key.slice(0, idx);
    const expected = key.slice(idx + 1);
    if (String(personality[trait]) === expected) {
      tags.push(label);
      checked.add(trait);
    }
  }
  if (!checked.has("health_literacy") && personality.health_literacy) {
    tags.push("健康素养正常");
  }

  const sections = BACKGROUND_SECTIONS
    .map(([key, title]) => {
      const text = String(cd[key] || "");
      return text ? { key, title, text } : null;
    })
    .filter(Boolean) as { key: string; title: string; text: string }[];

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-3 pb-3 border-b">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="text-primary" size={24} />
        </div>
        <div>
          <p className="font-semibold text-base">{name}</p>
          <p className="text-xs text-muted-foreground">{age ? `${age}岁` : ""} · {gender}</p>
          <p className="text-xs text-muted-foreground">{chiefComplaint}</p>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => <Tag key={t} label={t} />)}
        </div>
      )}

      {sections.map((s) => (
        <CollapsibleSection key={s.key} title={s.title} text={s.text} />
      ))}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">{label}</span>;
}

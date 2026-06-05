import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getPatientAvatar, type PatientInfo } from "@/utils/avatar";

interface PatientPortraitProps {
  patientInfo?: PatientInfo | null;
  collapsed: boolean;
  onToggle: () => void;
}

interface MedicalRecord {
  chiefComplaint: string;
  presentIllness: string;
  pastHistory: string;
  personalHistory: string;
  familyHistory: string;
}

const STORAGE_KEY_PREFIX = "nursing_medical_record_";

function loadRecord(patientId: string): MedicalRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + patientId);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { chiefComplaint: "", presentIllness: "", pastHistory: "", personalHistory: "", familyHistory: "" };
}

function saveRecord(patientId: string, record: MedicalRecord) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + patientId, JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

const SECTIONS: { key: keyof MedicalRecord; label: string; placeholder: string }[] = [
  { key: "chiefComplaint", label: "主诉", placeholder: "患者主要不适及持续时间..." },
  { key: "presentIllness", label: "现病史", placeholder: "起病情况、主要症状特点、伴随症状、诊治经过..." },
  { key: "pastHistory", label: "既往史", placeholder: "既往疾病史、手术史、过敏史、输血史..." },
  { key: "personalHistory", label: "个人史", placeholder: "出生地、职业、生活习惯、婚育史..." },
  { key: "familyHistory", label: "家族史", placeholder: "家族成员健康状况及遗传病史..." },
];

function MedicalSection({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [focused, setFocused] = useState(false);
  const [local, setLocal] = useState(value);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  const handleChange = (v: string) => {
    setLocal(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onChange(v), 800);
  };

  return (
    <div className={cn("rounded-lg border transition-colors", focused ? "border-primary/50 bg-accent/50" : "border-border bg-muted/30")}>
      <div className="flex items-center gap-1.5 border-b border-border/50 px-3 py-2">
        <span className="text-xs font-semibold text-foreground/70">{label}</span>
        {local !== value && <span className="ml-auto text-[0.6rem] text-amber-500 animate-pulse">未保存</span>}
      </div>
      <textarea
        className="w-full resize-none bg-transparent px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 outline-none min-h-[56px]"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onChange(local);
        }}
        placeholder={placeholder}
        rows={3}
      />
    </div>
  );
}

export default function PatientPortrait({ patientInfo, collapsed, onToggle }: PatientPortraitProps) {
  const avatarSrc = getPatientAvatar(patientInfo);
  const patientId = patientInfo?.name || "default";
  const name = patientInfo?.name || "患者";

  const [record, setRecord] = useState<MedicalRecord>(() => loadRecord(patientId));
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 800);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setRecord(loadRecord(patientId));
  }, [patientId]);

  const updateField = (key: keyof MedicalRecord, value: string) => {
    setRecord((prev) => {
      const next = { ...prev, [key]: value };
      saveRecord(patientId, next);
      return next;
    });
  };

  const filledCount = Object.values(record).filter((v) => v.trim().length > 0).length;

  return (
    <>
      <div
        className={cn(
          "w-[300px] shrink-0 bg-card border-r border-border flex flex-row transition-[width] duration-300 overflow-hidden relative",
          "max-[800px]:fixed max-[800px]:top-14 max-[800px]:left-0 max-[800px]:bottom-0 max-[800px]:z-[500] max-[800px]:shadow-[2px_0_20px_rgba(0,0,0,0.15)]",
          collapsed && "w-0 border-r-0 max-[800px]:!-left-[300px] max-[800px]:!w-[300px]",
        )}
      >
        <div className="flex-1 flex flex-col overflow-y-auto min-w-[300px]">
          <div className="flex flex-col items-center gap-2 px-5 pt-6 pb-3">
            <img src={avatarSrc} alt={name} className="w-28 h-28 rounded-full object-cover bg-muted ring-2 ring-border" />
            <div className="text-sm font-bold text-foreground">{name}</div>
            {patientInfo && (
              <div className="text-xs text-muted-foreground -mt-1">
                {[patientInfo.gender, patientInfo.age != null ? `${patientInfo.age}岁` : ""].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>

          <div className="flex-1 px-4 pb-4 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">护理记录</h3>
              <span className="text-[0.6rem] text-muted-foreground">
                {filledCount}/{SECTIONS.length} 项
              </span>
            </div>

            {SECTIONS.map((s) => (
              <MedicalSection key={s.key} label={s.label} value={record[s.key]} onChange={(v) => updateField(s.key, v)} placeholder={s.placeholder} />
            ))}
          </div>
        </div>

        <button
          className="absolute top-3 -right-[34px] w-[30px] h-[30px] border border-l-0 border-border rounded-r-md bg-card cursor-pointer flex items-center justify-center text-muted-foreground hover:text-foreground z-10 transition-[right,color] duration-300"
          onClick={onToggle}
          title={collapsed ? "展开患者信息" : "收起患者信息"}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {collapsed && (
        <button
          className="fixed left-0 top-1/2 z-[498] w-7 h-14 border border-l-0 border-border rounded-r-lg bg-card cursor-pointer flex items-center justify-center text-muted-foreground hover:text-foreground shadow-[2px_0_8px_rgba(0,0,0,0.08)]"
          onClick={onToggle}
          title="展开患者信息"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}

      {isMobile && !collapsed && <div className="fixed inset-0 bg-black/30 z-[499]" onClick={onToggle} />}
    </>
  );
}

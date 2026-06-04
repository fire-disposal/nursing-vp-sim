import { PanelLeftClose, PanelLeftOpen, User } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getPatientAvatar, type PatientInfo } from "../utils/avatar";

interface PatientPortraitProps {
  patientInfo?: PatientInfo | null;
  collapsed: boolean;
  onToggle: () => void;
}

export default function PatientPortrait({ patientInfo, collapsed, onToggle }: PatientPortraitProps) {
  const avatarSrc = getPatientAvatar(patientInfo);
  const name = patientInfo?.name || "患者";
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 800);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <>
      <div
        className={cn(
          "w-[280px] shrink-0 bg-card border-r border-border flex flex-row transition-[width] duration-300 overflow-hidden relative",
          "max-[800px]:fixed max-[800px]:top-14 max-[800px]:left-0 max-[800px]:bottom-0 max-[800px]:z-[500] max-[800px]:shadow-[2px_0_20px_rgba(0,0,0,0.15)]",
          collapsed && "w-0 border-r-0 max-[800px]:!-left-[280px] max-[800px]:!w-[280px]",
        )}
      >
        <div className="flex-1 flex flex-col overflow-y-auto p-6 gap-6 min-w-[280px]">
          <div className="flex flex-col items-center gap-2.5">
            <img src={avatarSrc} alt={name} className="w-40 h-40 rounded-full object-cover bg-gray-100 border-[3px] border-blue-100" />
            <div className="text-base font-bold text-foreground">{name}</div>
            {patientInfo && (
              <div className="text-xs text-muted-foreground">
                {patientInfo.gender || ""} · {patientInfo.age != null ? `${patientInfo.age}岁` : ""}
              </div>
            )}
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-[10px] p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-600">
              <User size={14} />
              <span>病历卡</span>
            </div>
            <div className="text-xs text-gray-400 text-center py-6">病历记录区域预留</div>
          </div>
        </div>

        <button
          className="absolute top-3 -right-[34px] w-[30px] h-[30px] border border-l-0 border-border rounded-r-md bg-card cursor-pointer flex items-center justify-center text-gray-400 z-10 transition-[right] duration-300"
          onClick={onToggle}
          title={collapsed ? "展开患者信息" : "收起患者信息"}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {isMobile && collapsed && (
        <button
          className="fixed left-0 top-1/2 z-[498] w-7 h-14 border border-l-0 border-border rounded-r-lg bg-card cursor-pointer flex items-center justify-center text-gray-400 shadow-[2px_0_8px_rgba(0,0,0,0.08)]"
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

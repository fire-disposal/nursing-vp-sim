import { PanelLeftClose, PanelLeftOpen, User } from "lucide-react";
import { getPatientAvatar } from "../utils/avatar";

export default function PatientPortrait({ patientInfo, collapsed, onToggle }) {
  const avatarSrc = getPatientAvatar(patientInfo);
  const name = patientInfo?.name || "患者";

  return (
    <>
      <div className={`portrait-panel${collapsed ? " collapsed" : ""}`}>
        <div className="portrait-inner">
          <div className="portrait-figure">
            <img src={avatarSrc} alt={name} className="portrait-img" />
            <div className="portrait-name">{name}</div>
            {patientInfo && (
              <div className="portrait-meta">
                {patientInfo.gender || ""} · {patientInfo.age != null ? `${patientInfo.age}岁` : ""}
              </div>
            )}
          </div>

          <div className="portrait-record-card">
            <div className="portrait-record-title">
              <User size={14} />
              <span>病历卡</span>
            </div>
            <div className="portrait-record-placeholder">病历记录区域预留</div>
          </div>
        </div>

        <button className="portrait-toggle" onClick={onToggle} title={collapsed ? "展开患者信息" : "收起患者信息"}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {!collapsed && <div className="portrait-overlay" onClick={onToggle} />}
    </>
  );
}

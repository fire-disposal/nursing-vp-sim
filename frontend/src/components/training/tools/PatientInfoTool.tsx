import type { TrainingToolProps } from "@/engine/TrainingTool";
import PatientFacePremium from "@/components/training/face/PatientFacePremium";

export default function PatientInfoTool(props: TrainingToolProps) {
  const detail = props.recordDetail as Record<string, unknown> | null;
  const patient = (detail?.patient_info as Record<string, unknown> | undefined) ?? {};
  const name = String(detail?.patient_name ?? patient.name ?? "患者");
  // 隐藏病例时后端匿名 age=0 / gender=""，0 会被字符串当真值，必须数值化判断
  const ageNum = Number(detail?.patient_age ?? patient.age ?? 0);
  const gender = String(detail?.patient_gender ?? patient.gender ?? "");
  const chiefComplaint = String(detail?.chief_complaint ?? "无");

  return (
    <div className="p-3">
      <div className="flex items-center gap-3">
        <PatientFacePremium size={52} className="shrink-0" />
        <div>
          <p className="font-semibold text-base">{name}</p>
          <p className="text-xs text-muted-foreground">
            {ageNum > 0 ? `${ageNum}岁` : ""}{ageNum > 0 && gender ? " · " : ""}{gender}
          </p>
          <p className="text-xs text-muted-foreground">{chiefComplaint}</p>
        </div>
      </div>
    </div>
  );
}

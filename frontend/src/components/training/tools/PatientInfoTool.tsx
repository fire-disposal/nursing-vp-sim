import { User } from "lucide-react";
import type { TrainingToolProps } from "@/engine/TrainingTool";

export default function PatientInfoTool(props: TrainingToolProps) {
  const detail = props.recordDetail as Record<string, unknown> | null;
  const patient = (detail?.patient_info as Record<string, unknown> | undefined) ?? {};
  const name = String(detail?.patient_name ?? patient.name ?? "患者");
  const age = String(detail?.patient_age ?? patient.age ?? "");
  const gender = String(detail?.patient_gender ?? patient.gender ?? "");
  const chiefComplaint = String(detail?.chief_complaint ?? "无");

  return (
    <div className="p-3">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="text-primary" size={24} />
        </div>
        <div>
          <p className="font-semibold text-base">{name}</p>
          <p className="text-xs text-muted-foreground">
            {age ? `${age}岁` : ""}{age && gender ? " · " : ""}{gender}
          </p>
          <p className="text-xs text-muted-foreground">{chiefComplaint}</p>
        </div>
      </div>
    </div>
  );
}

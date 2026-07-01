import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { queryKeys } from "@/api/query-keys";
import { getRecordDetail } from "@/api/training";
import type { SceneCardProps } from "@/engine/scene-card";

export default function PatientInfoCard({ recordId }: SceneCardProps) {
  const { data: record } = useQuery({
    queryKey: queryKeys.training.record(recordId),
    queryFn: () => getRecordDetail(Number(recordId)).then((r) => r.data),
  });

  const cd = ((record as Record<string, unknown>)?.case_data as Record<string, unknown>) || {};
  const patient = (cd.patient_info as Record<string, unknown>) || {};
  const personality = (cd.personality as Record<string, string>) || {};
  const name = String(patient.name || "患者");
  const age = String(patient.age ?? "");
  const gender = String(patient.gender || "");
  const chiefComplaint = String(cd.chief_complaint || "无");

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-3 pb-3 border-b">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="text-primary" size={24} />
        </div>
        <div>
          <p className="font-semibold text-base">{name}</p>
          <p className="text-xs text-muted-foreground">{age ? `${age}岁` : ""} · {gender}</p>
          <p className="text-xs text-muted-foreground">{chiefComplaint}</p>
        </div>
      </div>

      {personality.health_literacy ? (
        <div className="flex flex-wrap gap-1">
          <Tag label={personality.health_literacy === "low" ? "健康素养低" : "正常"} />
          {personality.verbosity === "terse" && <Tag label="寡言" />}
          {personality.verbosity === "verbose" && <Tag label="健谈" />}
          {personality.anxiety_trait === "anxious" && <Tag label="易焦虑" />}
        </div>
      ) : null}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">{label}</span>;
}

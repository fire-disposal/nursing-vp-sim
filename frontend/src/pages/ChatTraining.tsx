import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";
import { emotionPlugin } from "@/plugins/emotion";
import { initiativePlugin } from "@/plugins/initiative";
import { inquiryPlugin } from "@/plugins/inquiry";
import { nursingRecordPlugin } from "@/plugins/nursing-record";
import { patientInfoPlugin } from "@/plugins/patient-info";
import { physicalExamPlugin } from "@/plugins/physical-exam";
import { portraitPlugin } from "@/plugins/portrait";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();

  const panelPlugins = useMemo(
    () => [inquiryPlugin, patientInfoPlugin, physicalExamPlugin, nursingRecordPlugin, emotionPlugin, initiativePlugin, portraitPlugin],
    [],
  );

  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;

  return <TrainingEngine recordId={recordId} panelPlugins={panelPlugins} />;
}

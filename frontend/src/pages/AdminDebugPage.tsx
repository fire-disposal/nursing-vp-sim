import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";
import { chatDisplayPlugin } from "@/plugins/chat-display";
import { devToolsPlugin } from "@/plugins/dev-tools";
import { inquiryPlugin } from "@/plugins/inquiry";
import { scoringDisplayPlugin } from "@/plugins/scoring-display";
import { timerPlugin } from "@/plugins/timer";

export default function AdminDebugPage() {
  const { recordId } = useParams<{ recordId: string }>();

  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;

  return (
    <TrainingEngine
      recordId={recordId}
      scenarioConfig={{
        features: {
          physical_exam: true,
          patient_initiative: false,
          emotion: false,
        },
      }}
      plugins={[chatDisplayPlugin, timerPlugin, inquiryPlugin, scoringDisplayPlugin, devToolsPlugin]}
    />
  );
}

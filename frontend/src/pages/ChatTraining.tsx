import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";
import { chatDisplayPlugin } from "@/plugins/chat-display";
import { chatInputPlugin } from "@/plugins/chat-input";
import { inquiryPlugin } from "@/plugins/inquiry";
import { nursingRecordPlugin } from "@/plugins/nursing-record";
import { patientInitiativePlugin } from "@/plugins/patient-initiative";
import { physicalExamPlugin } from "@/plugins/physical-exam";
import { questionnairePlugin } from "@/plugins/questionnaire";
import { scoringDisplayPlugin } from "@/plugins/scoring-display";
import { timerPlugin } from "@/plugins/timer";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();

  const plugins = useMemo(
    () => [
      chatDisplayPlugin,
      chatInputPlugin,
      timerPlugin,
      inquiryPlugin,
      physicalExamPlugin,
      nursingRecordPlugin,
      questionnairePlugin,
      patientInitiativePlugin,
      scoringDisplayPlugin,
    ],
    [],
  );

  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;

  return (
    <TrainingEngine
      recordId={recordId}
      scenarioConfig={{
        features: {
          physical_exam: true,
          patient_initiative: true,
          emotion: true,
        },
      }}
      plugins={plugins}
    />
  );
}

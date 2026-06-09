import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";
import { chatDisplayPlugin } from "@/plugins/chat-display";
import { chatInputPlugin } from "@/plugins/chat-input";
import { patientInitiativePlugin } from "@/plugins/patient-initiative";
import { questionnairePlugin } from "@/plugins/questionnaire";
import { scoringDisplayPlugin } from "@/plugins/scoring-display";
import { sidebarHostPlugin } from "@/plugins/sidebar-host";
import { trainingHeaderPlugin } from "@/plugins/training-header";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();

  const plugins = useMemo(
    () => [trainingHeaderPlugin, chatDisplayPlugin, sidebarHostPlugin, chatInputPlugin, questionnairePlugin, patientInitiativePlugin, scoringDisplayPlugin],
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

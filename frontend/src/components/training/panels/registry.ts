import emotionDef from "@/components/training/panels/emotion/index";
import initiativeDef from "@/components/training/panels/initiative/index";
import inquiryDef from "@/components/training/panels/inquiry/index";
import nursingRecordDef from "@/components/training/panels/nursing-record/index";
import patientInfoDef from "@/components/training/panels/patient-info/index";
import physicalExamDef from "@/components/training/panels/physical-exam/index";
import questionnaireDef from "@/components/training/panels/questionnaire/index";
import scoringDisplayDef from "@/components/training/panels/scoring-display/index";
import type { FrontendPluginDef } from "@/engine/types";

export const BUILTIN_PLUGIN_DEFS: FrontendPluginDef[] = [
	patientInfoDef,
	inquiryDef,
	physicalExamDef,
	nursingRecordDef,
	emotionDef,
	initiativeDef,
	scoringDisplayDef,
	questionnaireDef,
];

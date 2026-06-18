import type { FrontendPluginDef } from "@/engine/types";
import emotionDef from "./emotion/index";
import initiativeDef from "./initiative/index";
import inquiryDef from "./inquiry/index";
import nursingRecordDef from "./nursing-record/index";
import patientInfoDef from "./patient-info/index";
import physicalExamDef from "./physical-exam/index";
import questionnaireDef from "./questionnaire/index";
import scoringDisplayDef from "./scoring-display/index";

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

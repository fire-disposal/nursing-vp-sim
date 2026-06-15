import { definePlugin } from "@/engine/types";
import { QuestionnaireOverlay } from "./QuestionnaireOverlay";

export default definePlugin({
	id: "questionnaire",
	meta: { name: "问卷评估", description: "训练后评估问卷" },
	overlayComponent: QuestionnaireOverlay,
});

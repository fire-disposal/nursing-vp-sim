import { User } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { PatientInfoTab } from "./PatientInfoTab";

export default definePlugin({
	id: "patient-info",
	meta: { name: "患者情况", description: "患者基本信息和病历" },
	tab: { icon: User, label: "患者情况", priority: 0 },
	component: PatientInfoTab,
});

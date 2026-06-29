import { ClipboardList, FileText, MessageCircle, Stethoscope, User } from "lucide-react";
import { lazy, Suspense } from "react";
import LoadingState from "@/components/ui/loading-state";
import type { TabDef } from "../components/TabStack";
import TabStack from "../components/TabStack";
import { ExamPanel, InquiryPanel, PatientInfoPanel } from "./history-taking/panels";

const TrainingEngine = lazy(() =>
	import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

export default function HistoryTakingScene({
	recordId,
}: {
	recordId: string;
}) {
	const tabs: TabDef[] = [
		{
			id: "patient-info",
			icon: <User />,
			label: "患者",
			panel: <PatientInfoPanel recordId={recordId} />,
		},
		{
			id: "inquiry",
			icon: <ClipboardList />,
			label: "问诊",
			panel: <InquiryPanel recordId={recordId} />,
		},
		{
			id: "physical-exam",
			icon: <Stethoscope />,
			label: "查体",
			panel: <ExamPanel recordId={recordId} />,
		},
		{
			id: "nursing-record",
			icon: <FileText />,
			label: "记录",
			panel: (
				<div className="flex items-center justify-center h-40 text-sm text-muted-foreground bg-muted/30 rounded-lg">
					护理记录（待集成）
				</div>
			),
		},
		{
			id: "initiative",
			icon: <MessageCircle />,
			label: "主动",
			panel: (
				<div className="flex items-center justify-center h-40 text-sm text-muted-foreground bg-muted/30 rounded-lg">
					患者主动（待集成）
				</div>
			),
		},
	];

	return (
		<div className="flex h-screen">
			<div className="flex-1 min-w-0">
				<Suspense fallback={<LoadingState className="h-screen" />}>
					<TrainingEngine recordId={recordId} />
				</Suspense>
			</div>
			<TabStack tabs={tabs} side="right" />
		</div>
	);
}

import { ClipboardList, FileText, MessageCircle, Stethoscope, StickyNote, User } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { NursingRecordPanel } from "@/components/training/panels/nursing-record/NursingRecordPanel";
import LoadingState from "@/components/ui/loading-state";
import type { PanelContext } from "@/engine/types";
import NotePanel from "../components/NotePanel";
import type { TabDef } from "../components/TabStack";
import TabStack from "../components/TabStack";
import ExamPanel from "./history-taking/panels/ExamPanel";
import InquiryPanel from "./history-taking/panels/InquiryPanel";
import PatientInfoPanel from "./history-taking/panels/PatientInfoPanel";

function NursingRecordPanelWrapper({ recordId }: { recordId: string }) {
	const ctx = useMemo(() => ({ recordId }) as PanelContext, [recordId]);
	return <NursingRecordPanel ctx={ctx} features={{}} isCollapsed={false} />;
}

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
			panel: <NursingRecordPanelWrapper recordId={recordId} />,
		},
		{
			id: "notes",
			icon: <StickyNote />,
			label: "笔记",
			panel: <NotePanel recordId={recordId} />,
		},
		{
			id: "initiative",
			icon: <MessageCircle />,
			label: "主动",
			panel: (
				<div className="space-y-3">
					<p className="text-xs text-muted-foreground">患者主动追问状态</p>
					<div className="p-4 bg-muted/30 rounded-lg text-center">
						<MessageCircle size={24} className="mx-auto mb-2 text-muted-foreground/50" />
						<p className="text-sm text-muted-foreground">患者在等待时会主动发言</p>
						<p className="text-xs text-muted-foreground/60 mt-1">由患者情绪和等待时间触发</p>
					</div>
				</div>
			),
		},
	];

	useEffect(() => {
		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault();
		};
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, []);

	return (
		<div
			className="flex h-screen"
			style={{
				paddingTop: "env(safe-area-inset-top)",
				paddingBottom: "env(safe-area-inset-bottom)",
			}}
		>
			<div className="flex-1 min-w-0">
				<Suspense fallback={<LoadingState className="h-screen" />}>
					<TrainingEngine recordId={recordId} />
				</Suspense>
			</div>
			<TabStack tabs={tabs} side="right" />
		</div>
	);
}

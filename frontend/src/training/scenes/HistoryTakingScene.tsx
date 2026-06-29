import { Suspense, lazy } from "react";
import { ClipboardList, ListChecks, MessageCircle, Stethoscope, User } from "lucide-react";
import LoadingState from "@/components/ui/loading-state";
import TabStack from "../components/TabStack";
import type { TabDef } from "../components/TabStack";

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
			panel: <div className="text-sm text-muted-foreground">患者信息面板</div>,
		},
		{
			id: "inquiry",
			icon: <ListChecks />,
			label: "问诊",
			badge: 3,
			panel: <div className="text-sm text-muted-foreground">问诊清单面板</div>,
		},
		{
			id: "physical-exam",
			icon: <Stethoscope />,
			label: "查体",
			panel: <div className="text-sm text-muted-foreground">查体操作面板</div>,
		},
		{
			id: "nursing-record",
			icon: <ClipboardList />,
			label: "记录",
			panel: <div className="text-sm text-muted-foreground">护理记录面板</div>,
		},
		{
			id: "initiative",
			icon: <MessageCircle />,
			label: "主动",
			panel: <div className="text-sm text-muted-foreground">患者主动追问</div>,
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

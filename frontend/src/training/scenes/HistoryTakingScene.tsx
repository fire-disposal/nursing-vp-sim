import { ClipboardList, ListChecks, MessageCircle, Stethoscope, User } from "lucide-react";
import { lazy, Suspense } from "react";
import LoadingState from "@/components/ui/loading-state";
import type { TabDef } from "../components/TabStack";
import TabStack from "../components/TabStack";

const TrainingEngine = lazy(() =>
	import("@/engine").then((m) => ({ default: m.TrainingEngine })),
);

function PanelPlaceholder({ name, description }: { name: string; description: string }) {
	return (
		<div className="flex flex-col items-center justify-center h-40 text-sm text-muted-foreground bg-muted/30 rounded-lg gap-2">
			<span className="text-base">{name}</span>
			<span className="text-xs text-muted-foreground/60">{description}</span>
		</div>
	);
}

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
			panel: <PanelPlaceholder name="患者信息" description="年龄、性别、主诉、既往史等" />,
		},
		{
			id: "inquiry",
			icon: <ListChecks />,
			label: "问诊",
			badge: 3,
			panel: <PanelPlaceholder name="问诊清单" description="待采集的问诊项目列表" />,
		},
		{
			id: "physical-exam",
			icon: <Stethoscope />,
			label: "查体",
			panel: <PanelPlaceholder name="查体操作" description="生命体征测量与体格检查" />,
		},
		{
			id: "nursing-record",
			icon: <ClipboardList />,
			label: "记录",
			panel: <PanelPlaceholder name="护理记录" description="护理评估与记录表单" />,
		},
		{
			id: "initiative",
			icon: <MessageCircle />,
			label: "主动",
			panel: <PanelPlaceholder name="患者主动反应" description="患者主动提问与情绪变化" />,
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

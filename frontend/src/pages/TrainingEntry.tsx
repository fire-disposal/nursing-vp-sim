import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import LoadingState from "@/components/ui/loading-state";
import { getRecordDetail } from "../api/training";
import { TRAINING_SCENES } from "../training/scenes/scene-registry";

export default function TrainingEntry() {
	const { recordId } = useParams<{ recordId: string }>();

	const { data: record, isLoading, error, refetch } = useQuery({
		queryKey: queryKeys.training.record(recordId),
		queryFn: () => getRecordDetail(Number(recordId!)).then((r) => r.data),
		enabled: !!recordId,
	});

	if (!recordId) return <div>缺少训练记录 ID</div>;
	if (isLoading) return <LoadingState />;
	if (error) {
		return (
			<div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
				<div className="text-base font-medium">加载训练记录失败</div>
				<div className="max-w-sm text-xs text-muted-foreground/70 break-words">
					{error instanceof Error ? error.message : String(error)}
				</div>
				<button
					onClick={() => refetch()}
					className="mt-1 rounded-lg border border-border bg-card px-4 py-1.5 text-sm transition-colors hover:bg-muted"
				>
					重试
				</button>
			</div>
		);
	}
	if (!record) return <div>记录不存在</div>;

	const type = record.training_type || "history_taking";
	const SceneComponent = TRAINING_SCENES[type];
	if (!SceneComponent) return <div>未知训练类型: {type}</div>;

	const pendingQ = (record as { pending_questionnaires?: number }).pending_questionnaires ?? 0;

	return (
		<>
			{pendingQ > 0 && (
				<div className="bg-info/10 text-info-foreground text-xs px-4 py-2 text-center border-b border-border">
					本练习包含 {pendingQ} 份问卷，请在训练前后于「我的问卷」中完成
				</div>
			)}
			<SceneComponent recordId={recordId} />
		</>
	);
}

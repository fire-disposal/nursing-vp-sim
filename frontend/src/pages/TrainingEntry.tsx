import { useParams } from "react-router-dom";
import LoadingState from "@/components/ui/loading-state";
import { useApiQuery } from "@/hooks/useApiQuery";
import { getRecordDetail } from "../api/training";
import { TRAINING_SCENES } from "../training/scenes/registry";

export default function TrainingEntry() {
	const { recordId } = useParams<{ recordId: string }>();

	const { data: record, isLoading, error } = useApiQuery({
		queryKey: ["training-record", recordId],
		queryFn: () => getRecordDetail(Number(recordId!)),
		enabled: !!recordId,
	});

	if (!recordId) return <div>缺少训练记录 ID</div>;
	if (isLoading) return <LoadingState />;
	if (error) return <div>加载训练记录失败</div>;
	if (!record) return <div>记录不存在</div>;

	const type = record.training_type || "history_taking";
	const SceneComponent = TRAINING_SCENES[type];
	if (!SceneComponent) return <div>未知训练类型: {type}</div>;

	return <SceneComponent recordId={recordId} />;
}

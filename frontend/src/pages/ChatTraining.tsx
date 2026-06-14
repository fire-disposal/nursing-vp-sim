import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";

export default function ChatTraining() {
	const { recordId } = useParams<{ recordId: string }>();

	if (!recordId)
		return (
			<div className="flex h-screen items-center justify-center">
				缺少训练记录 ID
			</div>
		);

	return <TrainingEngine recordId={recordId} />;
}

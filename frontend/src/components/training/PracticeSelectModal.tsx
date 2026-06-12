import { useQuery } from "@tanstack/react-query";
import { Clock, Play, Sparkles } from "lucide-react";
import { api } from "@/api/axios-instance";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import LoadingState from "@/components/ui/LoadingState";
import Modal from "@/components/ui/Modal";

interface PracticeBrief {
	id: number;
	name: string;
	mode: string;
	features: Record<string, boolean>;
	behavior: Record<string, unknown>;
}

const MODE_LABELS: Record<string, string> = {
	training: "训练",
	assessment: "考核",
	free_play: "自由探索",
};

const FEATURE_LABELS: Record<string, string> = {
	physical_exam: "护理查体",
	emotion: "情绪状态机",
	patient_initiative: "患者追问",
	portrait: "患者立绘",
	questionnare: "问卷评估",
	exam_emotion_bridge: "查体-情绪联动",
	allow_pause: "允许暂停",
};

interface Props {
	open: boolean;
	caseId: number;
	caseName: string;
	onClose: () => void;
	onSelect: (practiceId: number | null) => void;
}

export default function PracticeSelectModal({
	open,
	caseId,
	caseName,
	onClose,
	onSelect,
}: Props) {
	const { data: practices, isLoading } = useQuery({
		queryKey: ["case-practices", caseId],
		queryFn: () =>
			api
				.get(`/cases/${caseId}/practices`)
				.then((r) => r.data as PracticeBrief[]),
		enabled: open,
		staleTime: 2 * 60_000,
	});

	const activeFeatures = (f: Record<string, boolean>) =>
		Object.entries(f)
			.filter(([, v]) => v)
			.map(([k]) => FEATURE_LABELS[k] || k);

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={`选择练习模式 — ${caseName}`}
			maxWidth={480}
		>
			{isLoading ? (
				<LoadingState />
			) : (
				<div className="flex flex-col gap-2 pb-2">
					{practices && practices.length > 0 ? (
						practices.map((p) => {
							const features = activeFeatures(p.features);
							const timeLimit = (p.behavior as any)?.time_limit_minutes ?? 20;
							return (
								<button
									key={p.id}
									onClick={() => onSelect(p.id)}
									className="flex flex-col gap-1.5 w-full rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 cursor-pointer"
								>
									<div className="flex items-center justify-between">
										<span className="font-medium text-sm">{p.name}</span>
										<Badge
											variant={
												p.mode === "assessment"
													? "destructive"
													: p.mode === "free_play"
														? "secondary"
														: "default"
											}
										>
											{MODE_LABELS[p.mode] || p.mode}
										</Badge>
									</div>
									<div className="flex items-center gap-3 text-xs text-muted-foreground">
										<span className="flex items-center gap-1">
											<Clock size={12} /> {timeLimit} 分钟
										</span>
										{features.length > 0 && (
											<span className="flex items-center gap-1">
												<Sparkles size={12} /> {features.join("、")}
											</span>
										)}
									</div>
								</button>
							);
						})
					) : (
						<p className="text-sm text-muted-foreground text-center py-4">
							该病例暂无练习模板
						</p>
					)}

					<button
						onClick={() => onSelect(null)}
						className="flex items-center justify-center gap-2 w-full rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary hover:bg-primary/5 cursor-pointer mt-1"
					>
						<Play size={14} />
						直接开始（默认模式）
					</button>
				</div>
			)}
		</Modal>
	);
}

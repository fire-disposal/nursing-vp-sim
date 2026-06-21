import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ClipboardList,
	Lightbulb,
	Star,
	User,
	X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCases, startTraining } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import TrainingConfigModal from "@/components/training/TrainingConfigModal";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";

type CaseBrief = components["schemas"]["CaseBrief"];

const DIFFICULTY_LABELS: Record<number, string> = {
	1: "初级",
	2: "中级",
	3: "高级",
};
const DIFFICULTY_COLORS: Record<number, string> = {
	1: "success",
	2: "warning",
	3: "danger",
};
const LIMIT = 50;

interface PatientSummary {
	gender?: string;
	age?: number;
	chief_complaint?: string;
}

function getPatientSummary(ps: CaseBrief["patient_summary"]): PatientSummary {
	if (ps && typeof ps === "object") return ps as PatientSummary;
	return {};
}

export default function CaseSelect() {
	const [difficultyFilter, setDifficultyFilter] = useState(0);
	const [offset, setOffset] = useState(0);
	const [selectedCase, setSelectedCase] = useState<{
		id: number;
		name: string;
		difficulty: number;
		description?: string | null;
		patient_summary?: CaseBrief["patient_summary"];
	} | null>(null);
	const [hintDismissed, setHintDismissed] = useState(
		() => localStorage.getItem("case_hint_dismissed") === "1",
	);
	const navigate = useNavigate();
	const toast = useToast();

	const { data: casesData, isLoading } = useQuery({
		queryKey: ["cases", offset],
		queryFn: () => getCases({ offset, limit: LIMIT }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const startMutation = useMutation({
		mutationFn: ({ caseId, features, timeLimit }: { caseId: number; features: Record<string, boolean>; timeLimit: number }) =>
			startTraining(caseId, null, features, timeLimit),
		onSuccess: (res) => navigate(`/training/${res.data.record_id}`),
		onError: () => toast.error("开始训练失败，请重试"),
	});

	const cases = casesData?.items ?? [];
	const total = casesData?.total ?? 0;
	const filteredCases =
		difficultyFilter === 0
			? cases
			: cases.filter((c) => (c.difficulty || 1) === difficultyFilter);

	const getDifficultyStars = (d?: number | null) => {
		const level = d && DIFFICULTY_LABELS[d] ? d : 1;
		return Array.from({ length: 3 }, (_, i) => (
			<Star
				key={i}
				size={12}
				fill={i < level ? "#f59e0b" : "none"}
				color={i < level ? "#f59e0b" : "#d1d5db"}
			/>
		));
	};

	return (
		<>
			<PageHeader
				title="病例库"
				subtitle="选择一位虚拟患者开始病史采集训练。系统将模拟真实患者与你对话，训练结束后自动评分。"
				icon={ClipboardList}
				backTo="/home"
			/>

			<div className="space-y-6">
				{!hintDismissed && (
					<div className="relative rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-4 sm:p-5">
						<div className="flex gap-3 items-start">
							<Lightbulb size={20} className="text-amber-500 shrink-0 mt-0.5" />
							<p className="text-sm text-amber-800">
								<span className="font-semibold">提示：</span>
								每次对话结束后，系统将根据你的问诊完整度自动评分。建议针对患者的主诉展开系统性提问。
							</p>
						</div>
						<button
							onClick={() => {
								localStorage.setItem("case_hint_dismissed", "1");
								setHintDismissed(true);
							}}
							className="absolute top-2 right-2 size-8 flex items-center justify-center rounded-lg hover:bg-amber-200/50"
							aria-label="关闭提示"
						>
							<X size={14} />
						</button>
					</div>
				)}

				<div className="flex gap-2 flex-wrap">
					<button
						type="button"
						className={cn(
							"inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors",
							difficultyFilter === 0
								? "bg-primary text-primary-foreground shadow-sm"
								: "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
						)}
						onClick={() => {
							setDifficultyFilter(0);
							setOffset(0);
						}}
					>
						全部
					</button>
					{[1, 2, 3].map((d) => (
						<button
							type="button"
							key={d}
							className={cn(
								"inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors",
								difficultyFilter === d
									? "bg-primary text-primary-foreground shadow-sm"
									: "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
							onClick={() => {
								setDifficultyFilter(d);
								setOffset(0);
							}}
						>
							{DIFFICULTY_LABELS[d]}
						</button>
					))}
				</div>

				{isLoading ? (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{Array.from({ length: 6 }).map((_, i) => (
							<LoadingSkeleton key={i} variant="card" />
						))}
					</div>
				) : filteredCases.length === 0 ? (
					<div className="rounded-xl border bg-card">
						<EmptyState icon={AlertTriangle} title="暂无病例" />
					</div>
				) : (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{filteredCases.map((c) => {
							const summary = getPatientSummary(c.patient_summary);
							const isStarting =
								startMutation.isPending && selectedCase?.id === c.id;
							const diffLabel = DIFFICULTY_LABELS[c.difficulty || 1];
							return (
								<div
									key={c.id}
									className="group flex flex-col gap-3 rounded-xl border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md"
								>
									<div className="flex items-start justify-between gap-2">
										<h3 className="text-base font-semibold leading-snug">
											{c.name}
										</h3>
										<span className="flex gap-0.5 shrink-0 mt-0.5">
											{getDifficultyStars(c.difficulty)}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<Badge
											variant={
												DIFFICULTY_COLORS[c.difficulty || 1] as
													| "success"
													| "warning"
													| "danger"
													| "default"
											}
										>
											{diffLabel}
										</Badge>
									</div>
									<p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
										{c.description}
									</p>
									{typeof summary.gender === "string" && (
										<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
											<span className="inline-flex items-center gap-1">
												<User size={14} />
											{(() => {
												const g =
													summary.gender === "男"
														? "male"
														: summary.gender === "女"
															? "female"
															: summary.gender;
												return g === "male"
													? "男性"
													: g === "female"
														? "女性"
														: g;
											})()}
											</span>
											{typeof summary.age === "number" && (
												<span>{summary.age}岁</span>
											)}
											{typeof summary.chief_complaint === "string" && (
												<span className="truncate max-w-[180px]">
													主诉：{summary.chief_complaint}
												</span>
											)}
										</div>
									)}
									<Button
										className="mt-auto w-full"
										onClick={() => setSelectedCase({
											id: c.id,
											name: c.name,
											difficulty: c.difficulty || 1,
											description: c.description,
											patient_summary: c.patient_summary,
										})}
										disabled={startMutation.isPending}
									>
										{isStarting ? "启动中..." : "开始训练"}
									</Button>
								</div>
							);
						})}
					</div>
				)}

				<div className="rounded-xl border bg-card px-4 py-3">
					<Pagination
						total={total}
						offset={offset}
						limit={LIMIT}
						onChange={setOffset}
					/>
				</div>
			</div>

			{selectedCase && (
				<TrainingConfigModal
					open={!!selectedCase}
					caseInfo={selectedCase}
					onClose={() => setSelectedCase(null)}
					onStart={(features, timeLimit) => {
						startMutation.mutate({ caseId: selectedCase.id, features, timeLimit });
						setSelectedCase(null);
					}}
					loading={startMutation.isPending}
				/>
			)}
		</>
	);
}

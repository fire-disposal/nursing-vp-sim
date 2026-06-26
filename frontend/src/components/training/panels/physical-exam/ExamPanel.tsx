import { Activity, Check, Copy, Heart, Loader2, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { performExam } from "@/api/training";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/utils/cn";

interface ExamOp {
	id: string;
	label: string;
	unit: string;
}

interface ExamGroup {
	id: string;
	label: string;
	icon: string;
	ops: ExamOp[];
}

interface ExamResultItem {
	type: string;
	label: string;
	value: string;
	unit: string;
}

const ICON_MAP: Record<string, typeof Heart> = {
	Heart,
	Stethoscope,
	Activity,
};

function copyText(text: string) {
	navigator.clipboard.writeText(text);
}

function useExamConfig(examAnchors: Record<string, unknown> | undefined) {
	return useMemo(() => {
		if (!examAnchors) return null;
		if (Array.isArray((examAnchors as any).groups)) {
			return examAnchors as { groups: ExamGroup[] };
		}
		const groups = parseLegacyAnchors(examAnchors);
		return groups ? { groups } : null;
	}, [examAnchors]);
}

function parseLegacyAnchors(anchors: Record<string, unknown>): ExamGroup[] | null {
	const groups: ExamGroup[] = [];
	const vs = anchors.vital_signs as Record<string, string> | undefined;
	if (vs) {
		const KEY_MAP: Record<string, string> = {
			temperature: "temp",
			heart_rate: "hr",
			blood_pressure: "bp",
			respiratory_rate: "rr",
			spo2: "spo2",
		};
		const OPS: Record<string, ExamOp> = {
			temp: { id: "temp", label: "体温", unit: "°C" },
			hr: { id: "hr", label: "心率", unit: "次/分" },
			bp: { id: "bp", label: "血压", unit: "mmHg" },
			rr: { id: "rr", label: "呼吸频率", unit: "次/分" },
			spo2: { id: "spo2", label: "血氧饱和度", unit: "%" },
		};
		const ops = Object.keys(KEY_MAP)
			.filter((k) => vs[k])
			.map((k) => OPS[KEY_MAP[k]]);
		if (ops.length > 0) {
			groups.push({ id: "vitals", label: "生命体征", icon: "Heart", ops });
		}
	}
	const inspectOps: ExamOp[] = [];
	if (anchors.skin) {
		inspectOps.push({ id: "skin", label: "皮肤", unit: "" });
	}
	if (anchors.pain_score !== undefined) {
		inspectOps.push({ id: "pain", label: "疼痛评分", unit: "/10" });
	}
	if (inspectOps.length > 0) {
		groups.push({
			id: "inspection",
			label: "体格检查",
			icon: "Stethoscope",
			ops: inspectOps,
		});
	}
	return groups.length > 0 ? groups : null;
}

export function ExamPanel({ ctx }: PanelTabProps) {
	const examConfig = useExamConfig(ctx.patient?.examAnchors);

	const [results, setResults] = useState<Record<string, ExamResultItem>>({});
	const [history, setHistory] = useState<ExamResultItem[]>([]);
	const [loading, setLoading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	useEffect(() => {
		if (!copiedId) return;
		const id = setTimeout(() => setCopiedId(null), 1500);
		return () => clearTimeout(id);
	}, [copiedId]);

	const handleExam = useCallback(
		async (opId: string) => {
			if (ctx.loading || loading) return;
			setLoading(opId);
			setError(null);
			try {
				const res = await performExam(ctx.recordId, opId);
				const data = res.data as {
					type: string;
					data: ExamResultItem;
					all_results: ExamResultItem[];
				};
				setResults((prev) => ({ ...prev, [opId]: data.data }));
				setHistory(data.all_results || []);
			} catch (e: unknown) {
				const err = e as any;
				const detail =
					err?.response?.data?.detail ||
					err?.message ||
					"操作失败";
				setError(detail);
			} finally {
				setLoading(null);
			}
		},
		[ctx.recordId, ctx.loading, loading],
	);

	if (!examConfig) {
		return (
			<p className="text-xs text-muted-foreground">该病例未配置查体数据</p>
		);
	}

	return (
		<div className="space-y-4">
			{/* ── 操作按钮区 ── */}
			{examConfig.groups.map((group) => {
				const GroupIcon = ICON_MAP[group.icon] ?? Activity;
				return (
					<div key={group.id}>
						<h4 className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
							<GroupIcon size={12} />
							{group.label}
						</h4>
						<div className="grid grid-cols-2 gap-1">
							{group.ops.map((op) => {
								const done = results[op.id] !== undefined;
								const isActive = loading === op.id;
								return (
									<button
										type="button"
										key={op.id}
										onClick={() => handleExam(op.id)}
										disabled={!!loading || ctx.loading}
										className={cn(
											"rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-50 text-left flex items-center gap-1.5",
											done
												? "border-transparent bg-success text-success-foreground"
												: "border-border bg-card hover:bg-muted",
										)}
									>
										{isActive ? (
											<Loader2 size={12} className="animate-spin shrink-0" />
										) : done ? (
											<Check size={12} className="text-success-foreground shrink-0" />
										) : (
											<Stethoscope size={12} className="text-muted-foreground shrink-0" />
										)}
										{op.label}
									</button>
								);
							})}
						</div>
					</div>
				);
			})}

			{/* ── 错误提示 ── */}
			{error && (
				<div className="rounded-lg border border-transparent bg-danger p-2 text-[0.65rem] text-danger-foreground">
					{error}
				</div>
			)}

			{/* ── 查体结果展示区 ── */}
			{history.length > 0 && (
				<div className="space-y-1.5">
					<h4 className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
						<Activity size={12} />
						查体结果
					</h4>
					<div className="space-y-0.5">
						{history.map((item, i) => (
							<div
								key={i}
								className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-xs group"
							>
								<span className="font-medium shrink-0">{item.label}</span>
								<span className="tabular-nums text-muted-foreground ml-auto">
									{item.value}
									{item.unit && <span className="ml-0.5">{item.unit}</span>}
								</span>
								{copiedId === `r-${i}` ? (
									<span className="text-[10px] text-success-foreground shrink-0 w-10 text-right">
										已复制
									</span>
								) : (
									<button
										type="button"
										onClick={() => {
											copyText(`${item.label}: ${item.value}${item.unit}`);
											setCopiedId(`r-${i}`);
										}}
										className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted cursor-pointer"
										title="复制"
									>
										<Copy size={12} className="text-muted-foreground" />
									</button>
								)}
							</div>
						))}
					</div>
					<button
						type="button"
						onClick={() => {
							const text = history
								.map((item) => `${item.label}: ${item.value}${item.unit}`)
								.join("\n");
							copyText(text);
							setCopiedId("all");
						}}
						className="w-full rounded-lg border border-dashed border-border py-1.5 text-[0.65rem] text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
					>
						{copiedId === "all" ? "已复制全部" : "复制全部体征"}
					</button>
				</div>
			)}
		</div>
	);
}

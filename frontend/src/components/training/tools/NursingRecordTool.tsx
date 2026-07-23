import { AlertCircle, FileText, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import { cn } from "@/utils/cn";

interface SheetData {
	subjective?: string;
	objective?: string;
	assessment?: string;
	plan?: string;
	evaluation?: string;
}

const FIELDS = [
	["subjective", "主观资料 (S)", "患者主诉、症状感受、病史...", "h-14 sm:h-20"],
	["objective", "客观资料 (O)", "生命体征、体格检查结果、实验室数据...", "h-14 sm:h-20"],
	["assessment", "评估 (A)", "护理诊断、风险评估、临床判断...", "h-14 sm:h-20"],
	["plan", "计划 (P)", "护理措施、预期目标、健康教育...", "h-14 sm:h-20"],
	["evaluation", "评价 (E)", "措施效果、病情变化、后续计划...", "h-14 sm:h-20"],
] as const;

const LOAD_TIMEOUT_MS = 8000;

export default function NursingRecordTool({ recordId, bus }: TrainingToolProps) {
	const rid = Number(recordId);
	const [sheet, setSheet] = useState<SheetData>({});
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const dirtyRef = useRef(false);
	const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

	const requestLoad = useCallback(() => {
		setLoading(true);
		setLoadError(null);
		bus.emit("tool:invoke", { tool: "nursing_record", action: "load", params: {}, recordId: rid });
		if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
		loadTimeoutRef.current = setTimeout(() => {
			setLoading(false);
			setLoadError("加载超时：实时连接可能已中断，请检查网络后重试");
		}, LOAD_TIMEOUT_MS);
	}, [bus, rid]);

	useEffect(() => {
		return subscribeWSConnection((connected) => {
			if (connected && (loadError || loading)) {
				requestLoad();
			}
		});
	}, [loadError, loading, requestLoad]);

	useEffect(() => {
		requestLoad();
		return () => {
			if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
		};
	}, [requestLoad]);

	useEffect(() => {
		const onResult = (payload: { tool: string; action: string; ok: boolean; data: Record<string, unknown>; error?: string }) => {
			if (payload.tool !== "nursing_record") return;
			if (payload.action === "load") {
				if (loadTimeoutRef.current) {
					clearTimeout(loadTimeoutRef.current);
					loadTimeoutRef.current = null;
				}
				if (payload.ok) {
					const sd = (payload.data.sheet_data as SheetData) || {};
					setSheet((prev) => {
						if (dirtyRef.current) return prev;
						if (Object.keys(prev).length > 0) return prev;
						return sd;
					});
					setLoading(false);
				} else {
					setLoading(false);
					setLoadError(payload.error || "加载护理记录失败");
				}
			}
			if (payload.action === "save") {
				if (payload.ok) {
					setSaveStatus("saved");
					setLastSavedAt(
						new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
					);
				} else {
					setSaveStatus("error");
				}
			}
		};
		bus.on("tool:result", onResult);
		return () => { bus.off("tool:result", onResult); };
	}, [bus]);

	const doSave = useCallback((sd: SheetData) => {
		setSaveStatus("saving");
		bus.emit("tool:invoke", {
			tool: "nursing_record",
			action: "save",
			params: { sheet_data: sd, status: "draft" },
			recordId: rid,
		});
	}, [bus, rid]);

	const update = (key: string, value: string) => {
		dirtyRef.current = true;
		setSheet((prev) => ({ ...prev, [key]: value }));
	};

	useEffect(() => {
		if (!dirtyRef.current) return;
		if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
		autoSaveTimerRef.current = setTimeout(() => {
			doSave(sheet);
		}, 3000);
		return () => {
			if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
		};
	}, [sheet, doSave]);

	useEffect(() => {
		if (!bus) return;
		const handler = () => {
			if (dirtyRef.current) {
				if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
				doSave(sheet);
			}
		};
		return bus.on("training:beforeEnd", handler);
	}, [bus, sheet, doSave]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-32 text-muted-foreground">
				<Loader2 size={18} className="animate-spin mr-2" />
				<span className="text-xs">加载评估记录...</span>
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 h-32 text-muted-foreground p-3">
				<AlertCircle size={18} className="text-danger" />
				<span className="text-xs text-center">{loadError}</span>
				<button
					type="button"
					onClick={requestLoad}
					className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
				>
					重试
				</button>
			</div>
		);
	}

	return (
		<form className="space-y-3 p-3" onSubmit={(e) => { e.preventDefault(); doSave(sheet); }}>
			{FIELDS.map(([key, label, placeholder, height]) => (
				<div key={key}>
					<label className="text-[11px] font-medium text-muted-foreground mb-1 block">
						{label}
					</label>
					<textarea
						value={sheet[key] || ""}
						onChange={(e) => update(key, e.target.value)}
						placeholder={placeholder}
						className={cn(
							"w-full rounded-lg border border-border bg-background p-2 text-xs leading-relaxed resize-y",
							height,
						)}
					/>
				</div>
			))}

			<div className="flex items-center justify-between pt-1">
				<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
					<FileText size={12} />
					<span>
						{saveStatus === "saving"
							? "保存中..."
							: saveStatus === "saved"
								? `已自动保存 ${lastSavedAt || ""}`
								: saveStatus === "error"
									? "保存失败"
									: "护理评估记录"}
					</span>
				</div>
				<button
					type="submit"
					className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
				>
					<Save size={12} />
					保存
				</button>
			</div>
		</form>
	);
}

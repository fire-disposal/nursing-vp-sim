import { Code2, Eye, FormInput, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { safeParse, z } from "zod";
import { generateCase, getCaseDetail } from "@/api";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { inputClass } from "@/utils/styles";
import { type CaseJsonValue, getDefaultCaseJson, useCaseEditor } from "./CaseEditorState";
import { FormView } from "./FormView";
import JsonView from "./JsonView";
import { useCreateCase, useUpdateCase } from "./useCaseMutations";

const caseFormSchema = z.object({
	name: z.string().min(1, "病例名称不能为空"),
	time_limit: z.number().int().min(1).max(180),
	difficulty: z.number().int().min(1).max(3),
	training_type: z.enum(["history_taking"]),
});

/** 可逐字段 AI 生成的临床字段（field 模式，以当前病例为上下文）。 */
const AI_CLINICAL_FIELDS: { key: string; label: string }[] = [
	{ key: "chief_complaint", label: "主诉" },
	{ key: "opening_line", label: "开场白" },
	{ key: "present_illness", label: "现病史" },
	{ key: "past_history", label: "既往史" },
	{ key: "medication_history", label: "用药史" },
	{ key: "allergy_history", label: "过敏史" },
	{ key: "family_history", label: "家族史" },
	{ key: "social_history", label: "生活史" },
	{ key: "communication_style", label: "沟通风格" },
	{ key: "personality", label: "人格" },
	{ key: "patient_info", label: "患者信息" },
];

const AI_PEDAGOGY_FIELDS: { key: string; label: string }[] = [
	{ key: "hidden_info", label: "隐藏信息" },
	{ key: "required_inquiries", label: "必询要点" },
	{ key: "deep_background", label: "深层背景" },
	{ key: "exam_anchors", label: "查体锚点" },
	{ key: "example_dialogues", label: "示例对话" },
];

const ALL_FIELD_LABELS: Record<string, string> = Object.fromEntries(
	[...AI_CLINICAL_FIELDS, ...AI_PEDAGOGY_FIELDS].map((f) => [f.key, f.label]),
);

/** 草稿自动保存：按病例 id 隔离（新建用 "new"）。 */
function draftKey(id: number | null): string {
	return `case-draft:${id ?? "new"}`;
}

interface CaseManageItem {
	id: number;
	name: string;
	training_type: string;
}

interface Props {
	open: boolean;
	editingCase: CaseManageItem | null;
	startWithAiPanel?: boolean;
	availableCases: CaseManageItem[];
	onClose: () => void;
	onSaved: () => void;
}

export default function CaseFormModal({ open, editingCase, startWithAiPanel, availableCases, onClose, onSaved }: Props) {
	const { state, dispatch } = useCaseEditor(getDefaultCaseJson());
	const [caseMsg, setCaseMsg] = useState("");
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [aiMode, setAiMode] = useState<"quick" | "reference">("quick");
	const [aiDescription, setAiDescription] = useState("");
	const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState<number[]>([]);
	const [aiReferenceText, setAiReferenceText] = useState("");
	const [aiGenerating, setAiGenerating] = useState(false);
	const [aiError, setAiError] = useState("");
	const [aiWorking, setAiWorking] = useState(""); // 当前生成动作文案
	const [showPreview, setShowPreview] = useState(false);
	const [showDraftRestore, setShowDraftRestore] = useState(false);
	const toast = useToast();
	const { confirm } = useConfirm();

	const createMutation = useCreateCase();
	const updateMutation = useUpdateCase();

	const trainingType = String(state.json.training_type || "history_taking");
	const draft = draftKey(editingCase?.id ?? null);

	useEffect(() => {
		if (!open) return;
		const load = editingCase
			? getCaseDetail(editingCase.id).then(({ data }) => (data.case_data || {}) as Record<string, CaseJsonValue>)
			: Promise.resolve(getDefaultCaseJson());
		load
			.then((cd) => {
				dispatch({ type: "LOAD_CASE", json: cd });
				// 草稿恢复提示：本地草稿存在且与已加载内容不同
				const saved = localStorage.getItem(draft);
				if (saved && saved !== JSON.stringify(cd)) setShowDraftRestore(true);
			})
			.catch(() => toast.error("加载病例数据失败"));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, editingCase, dispatch, toast.error]);

	// ── 草稿自动保存（800ms 防抖） ──
	useEffect(() => {
		if (!open) return;
		const t = setTimeout(() => {
			if (state.isDirty) localStorage.setItem(draft, JSON.stringify(state.json));
		}, 800);
		return () => clearTimeout(t);
	}, [open, state.json, state.isDirty, draft]);

	// 打开时重置 AI 面板状态
	useEffect(() => {
		if (!open) return;
		setCaseMsg("");
		setShowAiPanel(!!startWithAiPanel);
		setAiDescription("");
		setAiReferenceCaseIds([]);
		setAiReferenceText("");
		setAiError("");
		setAiGenerating(false);
		setAiWorking("");
		setShowPreview(false);
		setShowDraftRestore(false);
	}, [open, startWithAiPanel]);

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setCaseMsg("");
		const data = state.json;
		const result = safeParse(caseFormSchema, {
			name: data.name,
			time_limit: Number(data.time_limit ?? 20),
			difficulty: Number(data.difficulty ?? 1),
			training_type: data.training_type ?? "history_taking",
		});
		if (!result.success) {
			setCaseMsg(result.error.issues.map((i) => i.message).join("；"));
			return;
		}
		try {
			if (editingCase) {
				await updateMutation.mutateAsync({
					id: editingCase.id,
					data: { case_data: data as Record<string, unknown> },
				});
			} else {
				await createMutation.mutateAsync({
					case_data: data as Record<string, unknown>,
					is_open: Boolean(data.is_open),
				});
			}
			localStorage.removeItem(draft);
			dispatch({ type: "MARK_CLEAN" });
			onSaved();
			onClose();
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setCaseMsg(e.response?.data?.detail || "保存失败");
		}
	};

	/** AI 操作前快照（可撤销），然后填充。 */
	const fillJson = (json: Record<string, CaseJsonValue>) => {
		dispatch({ type: "PUSH_SNAPSHOT" });
		dispatch({ type: "SET_JSON", json });
	};

	const fillField = (field: string, value: unknown) => {
		dispatch({ type: "PUSH_SNAPSHOT" });
		let v: unknown = value;
		if (field === "hidden_info" || field === "required_inquiries") {
			if (Array.isArray(v)) v = v.filter(Boolean);
			else if (typeof v === "string") v = (v as string).split("\n").filter(Boolean);
			else v = [];
		}
		dispatch({ type: "SET_FIELD", path: field, value: v as CaseJsonValue });
	};

	const buildPayload = (extra: Record<string, unknown>) => {
		const payload: Record<string, unknown> = {
			mode: aiMode,
			training_type: trainingType,
			description: aiDescription || state.json.chief_complaint || state.json.description || "护理病史采集训练病例",
			reference_case_ids: aiMode === "reference" ? aiReferenceCaseIds : undefined,
			reference_text: aiMode === "reference" && aiReferenceText ? aiReferenceText : undefined,
			...extra,
		};
		return payload;
	};

	const generateStage = async (stage: "core" | "derivative", label: string) => {
		setAiError("");
		if (!aiDescription.trim() && stage === "core") {
			setAiError("请输入病例描述");
			return;
		}
		setAiGenerating(true);
		setAiWorking(label);
		try {
			const { data } = await generateCase(
				buildPayload({
					stage,
					current_case_data: stage === "derivative" ? state.json : undefined,
				}) as Parameters<typeof generateCase>[0],
			);
			if (data.case_data) fillJson(data.case_data as Record<string, CaseJsonValue>);
			toast.success(stage === "core" ? "临床骨架已生成，可继续生成教学细节" : "教学细节已生成");
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(e.response?.data?.detail || "AI 生成失败");
		} finally {
			setAiGenerating(false);
			setAiWorking("");
		}
	};

	const generateField = async (field: string) => {
		setAiError("");
		setAiGenerating(true);
		setAiWorking(`生成「${ALL_FIELD_LABELS[field] ?? field}」`);
		try {
			const { data } = await generateCase(
				buildPayload({
					field,
					current_case_data: state.json,
				}) as Parameters<typeof generateCase>[0],
			);
			fillField(field, data.field_value);
			toast.success(`已生成「${ALL_FIELD_LABELS[field] ?? field}」建议`);
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(`生成「${ALL_FIELD_LABELS[field] ?? field}」失败: ${e.response?.data?.detail || "AI 生成失败"}`);
		} finally {
			setAiGenerating(false);
			setAiWorking("");
		}
	};

	const handleUndo = () => {
		if (state.undoStack.length === 0) return;
		dispatch({ type: "UNDO" });
		toast.success("已撤销上一次 AI 填充");
	};

	const handleRestoreDraft = () => {
		const saved = localStorage.getItem(draft);
		if (!saved) return;
		try {
			const parsed = JSON.parse(saved) as Record<string, CaseJsonValue>;
			fillJson(parsed);
			setShowDraftRestore(false);
			toast.success("已恢复草稿");
		} catch {
			localStorage.removeItem(draft);
			setShowDraftRestore(false);
		}
	};

	const handleClose = async () => {
		if (state.isDirty && JSON.stringify(state.json) !== state.initialJson) {
			const ok = await confirm({ title: "关闭病例编辑", message: "内容未保存，确定关闭？" });
			if (!ok) return;
		}
		onClose();
	};

	const preview = useMemo(() => {
		const pi = (state.json.patient_info ?? {}) as Record<string, CaseJsonValue>;
		const inquiries = (state.json.required_inquiries as unknown[]) ?? [];
		const hidden = (state.json.hidden_info as unknown[]) ?? [];
		return {
			patient: `${String(pi.name ?? "")} ${pi.age ?? ""}岁 ${String(pi.gender ?? "")}`.trim(),
			chief: String(state.json.chief_complaint ?? ""),
			opening: String(state.json.opening_line ?? ""),
			inquiries: inquiries.length,
			hidden: hidden.length,
		};
	}, [state.json]);

	const aiBusy = aiGenerating;

	return (
		<Dialog open={open} onOpenChange={(o) => { if (!o) void handleClose(); }}>
			<DialogContent
				title={editingCase ? `编辑病例: ${editingCase.name}` : "添加新病例"}
				maxWidth={state.mode === "json" ? 960 : 900}
				className={cn("max-h-[85vh] overflow-y-auto", state.mode === "json" && "!max-w-[960px]")}
			>
				{caseMsg && (
					<div className={cn("px-3.5 py-2.5 rounded-lg text-sm mb-4", caseMsg.includes("成功") ? "bg-success text-success-foreground" : "bg-destructive/10 text-destructive")}>
						{caseMsg}
					</div>
				)}

				{showDraftRestore && (
					<div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg text-sm mb-4 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
						<span>检测到未保存的草稿</span>
						<div className="flex gap-2 shrink-0">
							<Button type="button" size="sm" variant="outline" onClick={handleRestoreDraft}>恢复草稿</Button>
							<Button type="button" size="sm" variant="ghost" onClick={() => { localStorage.removeItem(draft); setShowDraftRestore(false); }}>丢弃</Button>
						</div>
					</div>
				)}

				{/* ── Toolbar ── */}
				<div className="flex items-center gap-2 mb-4">
					<button type="button" onClick={() => setShowAiPanel(!showAiPanel)}
						className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors",
							showAiPanel ? "bg-purple-50 text-purple-700 border-purple-300" : "bg-transparent text-purple-600 border-purple-200 hover:bg-purple-50")}>
						<Wand2 size={13} /> AI
					</button>

					{state.undoStack.length > 0 && (
						<button type="button" onClick={handleUndo} title="撤销上一次 AI 填充"
							className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:bg-muted transition-colors">
							<RotateCcw size={13} /> 撤销
						</button>
					)}

					<button type="button" onClick={() => setShowPreview(!showPreview)} title="病例预览"
						className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors",
							showPreview ? "bg-primary/10 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted")}>
						<Eye size={13} /> 预览
					</button>

					<div className="flex items-center rounded-md border border-border overflow-hidden ml-auto">
						<button
							type="button"
							onClick={() => dispatch({ type: "SWITCH_MODE", mode: "form" })}
							className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors", state.mode === "form" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}
						>
							<FormInput size={13} /> 表单
						</button>
						<button
							type="button"
							onClick={() => dispatch({ type: "SWITCH_MODE", mode: "json" })}
							className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors", state.mode === "json" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}
						>
							<Code2 size={13} /> JSON
						</button>
					</div>
				</div>

				{/* ── AI 面板：两步向导 + 逐字段生成 ── */}
				{showAiPanel && (
					<div className="mb-4 p-4 rounded-lg bg-purple-50/50 border border-purple-100 dark:bg-purple-950/20 dark:border-purple-900">
						<div className="flex items-center gap-2 mb-3 flex-wrap">
							<span className="text-xs font-semibold text-purple-700 dark:text-purple-300">生成向导</span>
							<span className={cn("text-[10px] px-2 py-0.5 rounded-full border", state.json.name || state.json.chief_complaint ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-white text-muted-foreground border-border")}>1 临床骨架</span>
							<span className="text-muted-foreground/40">→</span>
							<span className={cn("text-[10px] px-2 py-0.5 rounded-full border", (state.json.required_inquiries as unknown[])?.length || state.json.exam_anchors ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-white text-muted-foreground border-border")}>2 教学细节</span>
						</div>

						<div className="flex gap-2 mb-3">
							<button type="button" onClick={() => setAiMode("quick")} className={cn("px-3 py-1 text-xs rounded", aiMode === "quick" ? "bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-100" : "bg-white dark:bg-card")}>快速生成</button>
							<button type="button" onClick={() => setAiMode("reference")} className={cn("px-3 py-1 text-xs rounded", aiMode === "reference" ? "bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-100" : "bg-white dark:bg-card")}>参考模板</button>
						</div>
						<textarea value={aiDescription} onChange={(e) => setAiDescription(e.target.value)} placeholder="描述你想生成的病例场景（年龄、主诉、病情特点…）" className={`${inputClass} h-20 resize-y mb-2`} />
						{aiMode === "reference" && (
							<div className="mb-2">
								<label className="text-xs text-muted-foreground">参考病例</label>
								<select multiple value={aiReferenceCaseIds.map(String)} onChange={(e) => setAiReferenceCaseIds(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
									className={`${inputClass} h-24`}>
									{availableCases.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.training_type})</option>)}
								</select>
								<textarea value={aiReferenceText} onChange={(e) => setAiReferenceText(e.target.value)} placeholder="或直接粘贴参考文本..." className={`${inputClass} h-16 resize-y mt-1`} />
							</div>
						)}
						{aiError && <p className="text-xs text-destructive mb-2">{aiError}</p>}

						{/* 两步按钮 */}
						<div className="flex gap-2 flex-wrap">
							<Button size="sm" onClick={() => generateStage("core", "生成临床骨架")} disabled={aiBusy} className="gap-1">
								<Sparkles size={14} /> {aiBusy && aiWorking === "生成临床骨架" ? "生成中…" : "生成临床骨架"}
							</Button>
							<Button size="sm" variant="outline" onClick={() => generateStage("derivative", "生成教学细节")} disabled={aiBusy} className="gap-1">
								<Sparkles size={14} /> {aiBusy && aiWorking === "生成教学细节" ? "生成中…" : "生成教学细节"}
							</Button>
						</div>

						{/* 逐字段生成（分组） */}
						<div className="mt-3 pt-3 border-t border-purple-200/60 dark:border-purple-900">
							<p className="text-[10px] text-muted-foreground mb-1.5">逐字段完善（以当前编辑内容为上下文，可反复生成）</p>
							<div className="flex flex-col gap-2">
								<div className="flex items-start gap-1.5 flex-wrap">
									<span className="text-[10px] text-purple-600 dark:text-purple-400 shrink-0 mt-0.5 w-14">临床字段</span>
									{AI_CLINICAL_FIELDS.map((f) => (
										<button key={f.key} type="button" onClick={() => generateField(f.key)} disabled={aiBusy}
											className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 dark:bg-purple-900/60 dark:text-purple-300 dark:hover:bg-purple-800">
											{f.label}
										</button>
									))}
								</div>
								<div className="flex items-start gap-1.5 flex-wrap">
									<span className="text-[10px] text-purple-600 dark:text-purple-400 shrink-0 mt-0.5 w-14">教学字段</span>
									{AI_PEDAGOGY_FIELDS.map((f) => (
										<button key={f.key} type="button" onClick={() => generateField(f.key)} disabled={aiBusy}
											className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 dark:bg-purple-900/60 dark:text-purple-300 dark:hover:bg-purple-800">
											{f.label}
										</button>
									))}
								</div>
							</div>
						</div>
					</div>
				)}

				{/* ── 病例预览（只读学生视角） ── */}
				{showPreview && (
					<div className="mb-4 p-4 rounded-lg border border-border bg-card">
						<p className="text-xs font-semibold mb-2">病例预览</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
							<div><span className="text-muted-foreground">名称：</span>{String(state.json.name ?? "") || "—"}</div>
							<div><span className="text-muted-foreground">患者：</span>{preview.patient || "—"}</div>
							<div className="sm:col-span-2"><span className="text-muted-foreground">主诉：</span>{preview.chief || "—"}</div>
							<div className="sm:col-span-2"><span className="text-muted-foreground">开场白：</span>{preview.opening || "—"}</div>
							<div><span className="text-muted-foreground">必询要点：</span>{preview.inquiries} 条</div>
							<div><span className="text-muted-foreground">隐藏信息：</span>{preview.hidden} 条</div>
						</div>
					</div>
				)}

				{/* ── Editor area ── */}
				<form onSubmit={handleSave} className="space-y-4">
					{state.mode === "json" ? (
						<JsonView json={state.json} dispatch={dispatch} />
					) : (
						<FormView state={state} dispatch={dispatch} />
					)}

					<div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-background py-2 border-t border-border mt-4">
						<Button type="button" variant="outline" size="sm" onClick={handleClose}>取消</Button>
						<Button type="submit" size="sm" disabled={createMutation.isPending || updateMutation.isPending}>
							{editingCase ? (updateMutation.isPending ? "保存中…" : "保存") : (createMutation.isPending ? "创建中…" : "创建")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

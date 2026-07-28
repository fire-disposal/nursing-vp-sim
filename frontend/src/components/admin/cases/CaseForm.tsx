import { Code2, FormInput, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { generateCase, getCaseDetail } from "@/api";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";
import { inputClass } from "@/utils/styles";
import { safeParse } from "zod";
import { z } from "zod";
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

const AI_FIELD_LABELS: Record<string, string> = {
	hidden_info: "隐藏信息",
	required_inquiries: "必问问诊项",
	example_dialogues: "示例对话",
};

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
	const toast = useToast();
	const { confirm } = useConfirm();

	const createMutation = useCreateCase();
	const updateMutation = useUpdateCase();

	const trainingType = String(state.json.training_type || "history_taking");

	useEffect(() => {
		if (!open) return;
		if (editingCase) {
			getCaseDetail(editingCase.id)
				.then(({ data }) => {
					const cd = (data.case_data || {}) as Record<string, CaseJsonValue>;
					dispatch({ type: "LOAD_CASE", json: cd });
				})
				.catch(() => toast.error("加载病例数据失败"));
		} else {
			dispatch({ type: "LOAD_CASE", json: getDefaultCaseJson() });
		}
		setCaseMsg("");
		setShowAiPanel(!!startWithAiPanel);
		setAiDescription("");
		setAiReferenceCaseIds([]);
		setAiReferenceText("");
		setAiError("");
		setAiGenerating(false);
	}, [open, editingCase, startWithAiPanel, dispatch, toast.error]);

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
			dispatch({ type: "MARK_CLEAN" });
			onSaved();
			onClose();
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setCaseMsg(e.response?.data?.detail || "保存失败");
		}
	};

	const handleAiGenerate = async (field: string | null) => {
		setAiError("");
		if (!field && !aiDescription.trim()) {
			setAiError("请输入病例描述");
			return;
		}
		setAiGenerating(true);
		try {
			const payload: Record<string, unknown> = {
				mode: aiMode,
				training_type: trainingType,
				description: aiDescription || state.json.chief_complaint || state.json.description || "护理病史采集训练病例",
				reference_case_ids: aiMode === "reference" ? aiReferenceCaseIds : undefined,
				reference_text: aiMode === "reference" && aiReferenceText ? aiReferenceText : undefined,
				field: field || null,
			};
			if (field) {
				payload.current_case_data = state.json;
			}
			const { data } = await generateCase(payload as Parameters<typeof generateCase>[0]);
			if (field) {
				let value = data.field_value;
				if (field === "hidden_info" || field === "required_inquiries") {
					if (Array.isArray(value)) value = value.filter(Boolean);
					else if (typeof value === "string") value = (value as string).split("\n").filter(Boolean);
					else value = [];
				}
				dispatch({ type: "SET_FIELD", path: field, value: value as CaseJsonValue });
				toast.success(`已生成「${AI_FIELD_LABELS[field] ?? field}」建议`);
			} else {
				dispatch({ type: "SET_JSON", json: (data.case_data as Record<string, CaseJsonValue>) || {} });
				toast.success("病例生成成功，请检查并保存");
			}
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(
				field
					? `生成「${AI_FIELD_LABELS[field] ?? field}」失败: ${e.response?.data?.detail || "AI 生成失败"}`
					: e.response?.data?.detail || "AI 生成失败",
			);
		} finally {
			setAiGenerating(false);
		}
	};

	const handleClose = async () => {
		if (state.isDirty && JSON.stringify(state.json) !== state.initialJson) {
			const ok = await confirm({ title: "关闭病例编辑", message: "内容未保存，确定关闭？" });
			if (!ok) return;
		}
		onClose();
	};

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

				{/* ── Toolbar ── */}
				<div className="flex items-center gap-2 mb-4">
					<button type="button" onClick={() => setShowAiPanel(!showAiPanel)}
						className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors",
							showAiPanel ? "bg-purple-50 text-purple-700 border-purple-300" : "bg-transparent text-purple-600 border-purple-200 hover:bg-purple-50")}>
						<Wand2 size={13} /> AI
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

				{/* ── AI Panel ── */}
				{showAiPanel && (
					<div className="mb-4 p-4 rounded-lg bg-purple-50/50 border border-purple-100">
						<div className="flex gap-2 mb-3">
							<button type="button" onClick={() => setAiMode("quick")} className={cn("px-3 py-1 text-xs rounded", aiMode === "quick" ? "bg-purple-200 text-purple-800" : "bg-white")}>快速生成</button>
							<button type="button" onClick={() => setAiMode("reference")} className={cn("px-3 py-1 text-xs rounded", aiMode === "reference" ? "bg-purple-200 text-purple-800" : "bg-white")}>参考模板</button>
						</div>
						<textarea value={aiDescription} onChange={(e) => setAiDescription(e.target.value)} placeholder="描述你想生成的病例场景..." className={`${inputClass} h-20 resize-y mb-2`} />
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
						<Button size="sm" variant="outline" onClick={() => handleAiGenerate(null)} disabled={aiGenerating} className="gap-1">
							<Sparkles size={14} /> {aiGenerating ? "生成中…" : aiMode === "reference" ? "参考生成" : "快速生成"}
						</Button>
						<div className="flex flex-wrap gap-1 mt-2">
							{["hidden_info", "required_inquiries", "example_dialogues"].map((f) => (
								<button key={f} type="button" onClick={() => handleAiGenerate(f)} disabled={aiGenerating}
									className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50">{AI_FIELD_LABELS[f] ?? f}</button>
							))}
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

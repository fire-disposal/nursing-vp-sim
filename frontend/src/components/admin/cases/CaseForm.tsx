import { Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { generateCase, getCaseDetail } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/utils/cn";
import { inputClass } from "@/utils/styles";
import { z, safeParse } from "zod";
import { AiFieldsSection } from "./AiFieldsSection";
import { BackgroundEditor } from "./BackgroundEditor";
import { CapabilitiesSection } from "./CapabilitiesSection";
import type { CaseFormData } from "./caseFormTypes";
import { buildCaseData, getDefaultForm, parseCaseData } from "./caseFormTypes";
import { ClinicalSection } from "./ClinicalSection";
import { DialoguesEditor } from "./DialoguesEditor";
import { ExamAnchorsEditor } from "./ExamAnchorsEditor";
import { PatientSection } from "./PatientSection";
import { PersonalitySection } from "./PersonalitySection";
import { PhasesEditor } from "./PhasesEditor";
import { QuizEditor } from "./QuizEditor";
import { TriageSection } from "./TriageSection";
import { useCreateCase, useUpdateCase } from "./useCaseMutations";

type Schemas = components["schemas"];

interface CaseManageItem {
	id: number;
	name: string;
	training_type: string;
}

const caseFormSchema = z.object({
	name: z.string().min(1, "病例名称不能为空"),
	time_limit: z.number().int("时限必须为整数").min(1, "时限至少1分钟").max(180, "时限不能超过180分钟"),
	difficulty: z.number().int().min(1).max(3),
	training_type: z.enum(["history_taking", "triage"]),
});

const AI_FIELD_LABELS: Record<string, string> = {
	hidden_info: "隐藏信息",
	required_inquiries: "必问问诊项",
	example_dialogues: "示例对话",
	scoring_criteria: "评分标准",
};

interface Props {
	open: boolean;
	editingCase: CaseManageItem | null;
	startWithAiPanel?: boolean;
	availableCases: CaseManageItem[];
	onClose: () => void;
	onSaved: () => void;
}

export default function CaseFormModal({ open, editingCase, startWithAiPanel, availableCases, onClose, onSaved }: Props) {
	const [form, setForm] = useState<CaseFormData>(getDefaultForm());
	const [trainingType, setTrainingType] = useState<string>("history_taking");
	const [isOpen, setIsOpen] = useState(true);
	const [initialData, setInitialData] = useState("");
	const [isDirty, setIsDirty] = useState(false);
	const [caseMsg, setCaseMsg] = useState("");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [aiMode, setAiMode] = useState<"quick" | "reference">("quick");
	const [aiDescription, setAiDescription] = useState("");
	const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState<number[]>([]);
	const [aiReferenceText, setAiReferenceText] = useState("");
	const [aiGenerating, setAiGenerating] = useState(false);
	const [aiError, setAiError] = useState("");
	const toast = useToast();

	const createMutation = useCreateCase();
	const updateMutation = useUpdateCase();

	const markDirty = () => setIsDirty(true);

	useEffect(() => {
		if (!open) return;
		if (editingCase) {
			getCaseDetail(editingCase.id)
				.then(({ data }) => {
					const cd = data.case_data as Record<string, unknown>;
					const parsed = parseCaseData(cd);
					setForm(parsed);
					const tt = (data as Record<string, unknown>).training_type as string;
					setTrainingType(tt || "history_taking");
					setInitialData(JSON.stringify({ ...parsed, _type: tt }));
				})
				.catch(() => toast.error("加载病例数据失败"));
		} else {
			const template = getDefaultForm();
			setForm(template);
			setTrainingType("history_taking");
			setInitialData(JSON.stringify({ ...template, _type: "history_taking" }));
			setIsOpen(true);
		}
		setIsDirty(false);
		setCaseMsg("");
		setShowAdvanced(false);
		setShowAiPanel(!!startWithAiPanel);
		setAiDescription("");
		setAiReferenceCaseIds([]);
		setAiReferenceText("");
		setAiError("");
		setAiGenerating(false);
	}, [open, editingCase, startWithAiPanel, toast.error]);

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		setCaseMsg("");
		const data = buildCaseData(form);
		const result = safeParse(caseFormSchema, {
			name: form.name,
			time_limit: form.time_limit,
			difficulty: form.difficulty,
			training_type: trainingType,
		});
		if (!result.success) {
			setCaseMsg(result.error.issues.map((i) => i.message).join("；"));
			return;
		}
		try {
			if (editingCase) {
				await updateMutation.mutateAsync({ id: editingCase.id, data: { case_data: data } });
			} else {
				await createMutation.mutateAsync({ case_data: data, is_open: isOpen });
			}
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
			const payload: Schemas["CaseGenerateRequest"] = {
				mode: aiMode,
				training_type: trainingType,
				description: aiDescription || form.chief_complaint || form.description || "护理病史采集训练病例",
				reference_case_ids: aiMode === "reference" ? aiReferenceCaseIds : undefined,
				reference_text: aiMode === "reference" && aiReferenceText ? aiReferenceText : undefined,
				field: field || null,
			};
			if (field) {
				payload.current_case_data = buildCaseData(form);
			}
			const { data } = await generateCase(payload);
			if (field) {
				let value = data.field_value;
				if (field === "hidden_info" || field === "required_inquiries") {
					if (Array.isArray(value)) value = value.filter(Boolean);
					else if (typeof value === "string") value = (value as string).split("\n").filter(Boolean);
					else value = [];
				}
				if (field === "hidden_info") {
					setForm((prev) => ({ ...prev, hidden_info: value as string[] }));
				} else if (field === "required_inquiries") {
					setForm((prev) => ({ ...prev, required_inquiries: value as string[] }));
				} else if (field === "example_dialogues") {
					setForm((prev) => ({ ...prev, example_dialogues: (value as Array<{ question: string; answer: string }>) ?? [] }));
				} else if (field === "scoring_criteria") {
					const v = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return {}; } })() : value;
					setForm((prev) => ({ ...prev, scoring_criteria: (typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}) }));
				}
				setIsDirty(true);
				toast.success(`已生成「${AI_FIELD_LABELS[field] ?? field}」建议`);
			} else {
				setForm(parseCaseData((data.case_data as Record<string, unknown>) || {}));
				setIsDirty(true);
				toast.success("病例生成成功，请检查并保存");
			}
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			setAiError(field ? `生成「${AI_FIELD_LABELS[field] ?? field}」失败: ${e.response?.data?.detail || "AI 生成失败"}` : e.response?.data?.detail || "AI 生成失败");
		} finally {
			setAiGenerating(false);
		}
	};

	const isHT = trainingType === "history_taking";

	return (
		<Dialog open={open} onOpenChange={(o) => {
			if (!o) { if (isDirty && JSON.stringify({ ...form, _type: trainingType }) !== initialData && !window.confirm("内容未保存，确定关闭？")) return; onClose(); }
		}}>
			<DialogContent title={editingCase ? `编辑病例: ${editingCase.name}` : "添加新病例"} maxWidth={900} className="max-h-[85vh] overflow-y-auto">
				{caseMsg && (
					<div className={cn("px-3.5 py-2.5 rounded-lg text-sm mb-4", caseMsg.includes("成功") ? "bg-success text-success-foreground" : "bg-destructive/10 text-destructive")}>
						{caseMsg}
					</div>
				)}

				<div className="mb-4">
					<button type="button" onClick={() => { setShowAiPanel(!showAiPanel); setAiError(""); }}
						className={cn("inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-purple-300 transition-colors",
							showAiPanel ? "bg-purple-50 text-purple-700" : "bg-transparent text-purple-600 hover:bg-purple-50")}>
						<Wand2 size={14} /> {showAiPanel ? "收起 AI 面板" : "展开 AI 面板"}
					</button>
					{showAiPanel && (
						<div className="mt-3 p-4 rounded-lg bg-purple-50/50 border border-purple-100">
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
								{["hidden_info", "required_inquiries", "example_dialogues", "scoring_criteria"].map((f) => (
									<button key={f} type="button" onClick={() => handleAiGenerate(f)} disabled={aiGenerating}
										className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50">{AI_FIELD_LABELS[f] ?? f}</button>
								))}
							</div>
						</div>
					)}
				</div>

				<form onSubmit={handleSave} className="space-y-4">
					<fieldset className="border border-border rounded-lg p-4">
						<legend className="text-sm font-semibold text-foreground px-1">基础信息</legend>
						<div className="flex gap-3 flex-wrap">
							<div className="flex-[2] min-w-[200px]">
								<label className="block text-xs font-semibold text-muted-foreground mb-1">病例名称 *</label>
								<input value={form.name} onChange={(e) => { setForm((p) => ({ ...p, name: e.target.value })); markDirty(); }} maxLength={100} className={inputClass} />
							</div>
							<div className="flex-1 min-w-[120px]">
								<label className="block text-xs font-semibold text-muted-foreground mb-1">时限 (分钟)</label>
								<input type="number" min={1} max={180} value={form.time_limit} onChange={(e) => { setForm((p) => ({ ...p, time_limit: Number(e.target.value) })); markDirty(); }} className={inputClass} />
							</div>
							<div className="flex-1 min-w-[120px]">
								<label className="block text-xs font-semibold text-muted-foreground mb-1">难度</label>
								<select value={form.difficulty} onChange={(e) => { setForm((p) => ({ ...p, difficulty: Number(e.target.value) })); markDirty(); }} className={inputClass}>
									<option value={1}>初级</option><option value={2}>中级</option><option value={3}>高级</option>
								</select>
							</div>
							<div className="flex-1 min-w-[120px]">
								<label className="block text-xs font-semibold text-muted-foreground mb-1">训练类型</label>
								<select value={trainingType} onChange={(e) => { setTrainingType(e.target.value); markDirty(); }} className={inputClass}>
									<option value="history_taking">病史采集</option>
									<option value="triage">分诊</option>
								</select>
							</div>
						</div>
						<div className="mt-3">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">病例描述</label>
							<input value={form.description} onChange={(e) => { setForm((p) => ({ ...p, description: e.target.value })); markDirty(); }} placeholder="一句话描述此病例的训练目标" className={inputClass} />
						</div>
						{!editingCase && (
							<label className="flex items-center gap-2 mt-3 text-xs text-muted-foreground cursor-pointer">
								<input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} /> 学生可见
							</label>
						)}
					</fieldset>

					<PatientSection value={form.patient_info} onChange={(v) => { setForm((p) => ({ ...p, patient_info: v })); markDirty(); }} />

					<PersonalitySection
						value={form.personality}
						communicationStyle={form.communication_style}
						onPersonalityChange={(v) => { setForm((p) => ({ ...p, personality: v })); markDirty(); }}
						onCommunicationChange={(v) => { setForm((p) => ({ ...p, communication_style: v })); markDirty(); }}
					/>

					{isHT ? (
						<ClinicalSection
							voiceType={form.voice_type}
							presentIllness={form.present_illness}
							pastHistory={form.past_history}
							medicationHistory={form.medication_history}
							allergyHistory={form.allergy_history}
							familyHistory={form.family_history}
							socialHistory={form.social_history}
							onFieldChange={(key, val) => { setForm((p) => ({ ...p, [key]: val })); markDirty(); }}
						/>
					) : (
						<TriageSection
							chiefComplaint={form.chief_complaint}
							openingLine={form.opening_line}
							arrivalMode={form.arrival_mode}
							redFlags={form.red_flags}
							vitals={form.vitals}
							consciousness={form.consciousness}
							mewsScore={form.mews_score}
							triageCategory={form.triage_category}
							onFieldChange={(key, val) => { setForm((p) => ({ ...p, [key]: val })); markDirty(); }}
						/>
					)}

					<CapabilitiesSection
						value={form.capabilities}
						trainingType={trainingType}
						onChange={(v) => { setForm((p) => ({ ...p, capabilities: v })); markDirty(); }}
					/>

					<button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
						{showAdvanced ? "收起高级配置 ▲" : "展开高级配置 ▼"}
					</button>

					{showAdvanced && (
						<>
							<ExamAnchorsEditor value={form.exam_anchors} onChange={(v) => { setForm((p) => ({ ...p, exam_anchors: v })); markDirty(); }} />
							<QuizEditor value={form.quiz} onChange={(v) => { setForm((p) => ({ ...p, quiz: v })); markDirty(); }} />
							<PhasesEditor value={form.phases} onChange={(v) => { setForm((p) => ({ ...p, phases: v })); markDirty(); }} />
							<DialoguesEditor value={form.example_dialogues} onChange={(v) => { setForm((p) => ({ ...p, example_dialogues: v })); markDirty(); }} />
							<BackgroundEditor value={form.deep_background} onChange={(v) => { setForm((p) => ({ ...p, deep_background: v })); markDirty(); }} />
							<AiFieldsSection
								hiddenInfo={form.hidden_info}
								requiredInquiries={form.required_inquiries}
								onHiddenInfoChange={(v) => { setForm((p) => ({ ...p, hidden_info: v })); markDirty(); }}
								onRequiredInquiriesChange={(v) => { setForm((p) => ({ ...p, required_inquiries: v })); markDirty(); }}
							/>
						</>
					)}

					<div className="flex gap-2 justify-end pt-2">
						<Button type="button" variant="outline" size="sm" onClick={() => {
							if (isDirty && JSON.stringify({ ...form, _type: trainingType }) !== initialData && !window.confirm("内容未保存，确定关闭？")) return;
							onClose();
						}}>取消</Button>
						<Button type="submit" size="sm" disabled={createMutation.isPending || updateMutation.isPending}>
							{editingCase ? (updateMutation.isPending ? "保存中…" : "保存") : (createMutation.isPending ? "创建中…" : "创建")}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

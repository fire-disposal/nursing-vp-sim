import { ChevronDown, ChevronUp, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { generateCase, getCaseDetail } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ALL_CAPABILITIES, TRAINING_CAPABILITIES } from "@/engine/capabilities.gen";
import { cn } from "@/utils/cn";
import type { CaseForm, CaseManageItem, ScoringDimension } from "./types";
import {
	buildCaseData,
	inputClass,
	NEW_CASE_TEMPLATE,
	parseCaseData,
	textareaClass,
} from "./types";
import { useCreateCase, useUpdateCase } from "./useCaseMutations";

type Schemas = components["schemas"];

interface CaseFormProps {
	open: boolean;
	editingCase: CaseManageItem | null;
	startWithAiPanel?: boolean;
	availableCases: CaseManageItem[];
	onClose: () => void;
	onSaved: () => void;
}

export default function CaseFormModal({
	open,
	editingCase,
	startWithAiPanel,
	availableCases,
	onClose,
	onSaved,
}: CaseFormProps) {
	const [caseForm, setCaseForm] = useState<CaseForm>(
		parseCaseData(NEW_CASE_TEMPLATE),
	);
	const [caseMsg, setCaseMsg] = useState("");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [showAiPanel, setShowAiPanel] = useState(false);
	const [aiGenerating, setAiGenerating] = useState(false);
	const [aiMode, setAiMode] = useState<"quick" | "reference">("quick");
	const [aiDescription, setAiDescription] = useState("");
	const [aiReferenceCaseIds, setAiReferenceCaseIds] = useState<number[]>([]);
	const [aiReferenceText, setAiReferenceText] = useState("");
	const [aiError, setAiError] = useState("");
	const toast = useToast();

	const createMutation = useCreateCase();
	const updateMutation = useUpdateCase();

	const updateField = (
		field: string,
		value: string | number | string[] | Record<string, boolean> | Record<string, ScoringDimension>,
	) => setCaseForm((prev) => ({ ...prev, [field]: value }));
	const updateList = (field: string, text: string) =>
		setCaseForm((prev) => ({
			...prev,
			[field]: text.split("\n").filter((s) => s.trim()),
		}));

	useEffect(() => {
		if (!open) return;
		if (editingCase) {
			getCaseDetail(editingCase.id)
				.then(({ data }) => setCaseForm(parseCaseData(data.case_data)))
				.catch(() => toast.error("加载病例数据失败"));
		} else {
			setCaseForm(parseCaseData(NEW_CASE_TEMPLATE));
		}
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
		const data = buildCaseData(caseForm);
		if (!data.name.trim()) {
			setCaseMsg("请输入病例名称");
			return;
		}
		if (data.name.trim().length > 100) {
			setCaseMsg("病例名称不能超过100个字符");
			return;
		}
		try {
			if (editingCase) {
				await updateMutation.mutateAsync({
					id: editingCase.id,
					data: { case_data: data },
				});
			} else {
				await createMutation.mutateAsync({ case_data: data });
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
				training_type: caseForm.training_type || "history_taking",
				description:
					aiDescription ||
					caseForm.chief_complaint ||
					caseForm.description ||
					"护理病史采集训练病例",
				reference_case_ids:
					aiMode === "reference" ? aiReferenceCaseIds : undefined,
				reference_text:
					aiMode === "reference" && aiReferenceText
						? aiReferenceText
						: undefined,
				field: field || null,
			};
			if (field) {
				payload.current_case_data = buildCaseData(caseForm);
			}
			const { data } = await generateCase(payload);
			if (field) {
				let value = data.field_value;
				if (field === "hidden_info" || field === "required_inquiries") {
					if (Array.isArray(value)) {
						value = value.filter(Boolean);
					} else if (typeof value === "string") {
						value = (value as string).split("\n").filter(Boolean);
					} else {
						value = [];
					}
				} else if (field === "scoring_criteria") {
					if (typeof value === "string") {
						try {
							value = JSON.parse(value as string);
						} catch {
							value = {};
						}
					}
					if (
						typeof value !== "object" ||
						value === null ||
						Array.isArray(value)
					) {
						value = {};
					}
				}
				updateField(
					field,
					value as
						| string
						| number
						| string[]
						| Record<string, ScoringDimension>,
				);
				toast.success(`已生成 ${field} 建议`);
			} else {
				setCaseForm(parseCaseData(data.case_data || {}));
				toast.success("病例生成成功，请检查并保存");
			}
		} catch (err: unknown) {
			const e = err as { response?: { data?: { detail?: string } } };
			const detail = e.response?.data?.detail || "AI 生成失败";
			setAiError(field ? `生成「${field}」失败: ${detail}` : detail);
		} finally {
			setAiGenerating(false);
		}
	};


	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={editingCase ? `编辑病例: ${editingCase.name}` : "添加新病例"}
				maxWidth={800}
				className="max-h-[85vh] overflow-y-auto"
			>
			{caseMsg && (
				<div
					className={cn(
						"px-3.5 py-2.5 rounded-lg text-sm mb-4",
						caseMsg.includes("成功") || caseMsg.includes("导入成功")
							? "bg-success text-success-foreground"
							: "bg-destructive/10 text-destructive",
					)}
				>
					{caseMsg}
				</div>
			)}
			<div className="mb-4">
				<button
					type="button"
					onClick={() => {
						setShowAiPanel(!showAiPanel);
						setAiError("");
					}}
					className={cn(
						"inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-purple-300 transition-colors",
						showAiPanel
							? "bg-purple-50 text-purple-700"
							: "bg-transparent text-purple-600 hover:bg-purple-50",
					)}
				>
					<Wand2 size={14} /> {showAiPanel ? "收起 AI 面板" : "展开 AI 面板"}
				</button>
				{showAiPanel && (
					<div className="mt-3 p-4 rounded-lg bg-purple-50/50 border border-purple-100">
						<div className="flex gap-2 mb-3">
							<button
								type="button"
								onClick={() => setAiMode("quick")}
								className={cn(
									"px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors",
									aiMode === "quick"
										? "bg-primary text-primary-foreground border-primary"
										: "bg-card text-muted-foreground border-border hover:bg-muted",
								)}
							>
								快速生成
							</button>
							<button
								type="button"
								onClick={() => setAiMode("reference")}
								className={cn(
									"px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors",
									aiMode === "reference"
										? "bg-primary text-primary-foreground border-primary"
										: "bg-card text-muted-foreground border-border hover:bg-muted",
								)}
							>
								参考资料生成
							</button>
						</div>
						<div className="mb-3">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								病例描述 *
							</label>
							<textarea
								rows={2}
								value={aiDescription}
								onChange={(e) => setAiDescription(e.target.value)}
								placeholder="一句话描述，如：糖尿病足溃疡老年患者，有10年糖尿病史..."
								className={textareaClass}
							/>
						</div>
						{aiMode === "reference" && (
							<>
								<div className="mb-3">
									<label className="block text-xs font-semibold text-muted-foreground mb-1">
										参考现有病例（多选）
									</label>
									<select
										multiple
										value={aiReferenceCaseIds.map(String)}
										onChange={(e) =>
											setAiReferenceCaseIds(
												Array.from(e.target.selectedOptions, (o) =>
													Number(o.value),
												),
											)
										}
										className="w-full min-h-[100px] px-2.5 py-1.5 border border-border rounded-md text-sm bg-card"
									>
										{availableCases.map((c) => (
											<option key={c.id} value={c.id}>
												{c.name}
												{c.chief_complaint ? ` — ${c.chief_complaint}` : ""}
											</option>
										))}
									</select>
								</div>
								<div className="mb-3">
									<label className="block text-xs font-semibold text-muted-foreground mb-1">
										自由参考资料
									</label>
									<textarea
										rows={3}
										value={aiReferenceText}
										onChange={(e) => setAiReferenceText(e.target.value)}
										placeholder="粘贴临床笔记、文献摘要等参考内容..."
										className={textareaClass}
									/>
								</div>
							</>
						)}
						{aiError && (
							<div className="bg-destructive/10 text-destructive px-3.5 py-2.5 rounded-lg text-sm mb-3">
								{aiError}
							</div>
						)}
						<Button
							onClick={() => handleAiGenerate(null)}
							disabled={
								aiGenerating ||
								createMutation.isPending ||
								updateMutation.isPending
							}
						>
							{aiGenerating ? (
								<>⟳ 生成中...</>
							) : (
								<>
									<Sparkles size={14} /> 生成完整病例
								</>
							)}
						</Button>
					</div>
				)}
			</div>
			<form onSubmit={handleSave} className="flex flex-col gap-3">
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						基础信息
					</legend>
					<div className="flex gap-3 flex-wrap">
						<div className="flex-[2] min-w-[200px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								病例名称 *
							</label>
							<input
								value={caseForm.name}
								onChange={(e) => updateField("name", e.target.value)}
								required
								maxLength={100}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								训练时限 (分钟)
							</label>
							<input
								type="number"
								min={1}
								max={180}
								value={caseForm.time_limit}
								onChange={(e) =>
									updateField("time_limit", Number(e.target.value))
								}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								困难程度
							</label>
							<select
								value={caseForm.difficulty}
								onChange={(e) =>
									updateField("difficulty", Number(e.target.value))
								}
								className={inputClass}
							>
								<option value={1}>初级</option>
								<option value={2}>中级</option>
								<option value={3}>高级</option>
							</select>
						</div>
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								训练类型
							</label>
							<select
								value={caseForm.training_type}
								onChange={(e) => updateField("training_type", e.target.value)}
								className={inputClass}
							>
								<option value="history_taking">病史采集</option>
								<option value="triage">分诊</option>
							</select>
						</div>
					</div>
					<div className="mt-3">
						<label className="block text-xs font-semibold text-muted-foreground mb-1">
							病例描述
						</label>
						<input
							value={caseForm.description}
							onChange={(e) => updateField("description", e.target.value)}
							placeholder="一句话描述此病例的训练目标"
							className={inputClass}
						/>
					</div>
				</fieldset>
				{caseForm.training_type === "triage" && (
				<>
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						患者信息
					</legend>
					<div className="flex gap-3 flex-wrap">
						<div className="flex-[2] min-w-[200px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								姓名
							</label>
							<input
								value={caseForm.patient_name}
								onChange={(e) => updateField("patient_name", e.target.value)}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								年龄
							</label>
							<input
								type="number"
								min={0}
								max={120}
								value={caseForm.patient_age}
								onChange={(e) =>
									updateField("patient_age", Number(e.target.value))
								}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								性别
							</label>
							<select
								value={caseForm.patient_gender}
								onChange={(e) => updateField("patient_gender", e.target.value)}
								className={inputClass}
							>
								<option value="">--</option>
								<option value="男">男</option>
								<option value="女">女</option>
							</select>
						</div>
					</div>
				</fieldset>
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						到达与主诉
					</legend>
					<div className="flex flex-col gap-3">
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								到达方式
							</label>
							<select
								value={caseForm.arrival_mode}
								onChange={(e) => updateField("arrival_mode", e.target.value)}
								className={inputClass}
							>
								<option value="walk">步行</option>
								<option value="stretcher">平车</option>
								<option value="ambulance">救护车</option>
							</select>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								主诉
							</label>
							<textarea
								rows={2}
								value={caseForm.chief_complaint}
								onChange={(e) => updateField("chief_complaint", e.target.value)}
								className={textareaClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								警示信号（每行一个）
							</label>
							<textarea
								rows={3}
								value={(caseForm.red_flags || []).join("\n")}
								onChange={(e) => updateList("red_flags", e.target.value)}
								placeholder="胸痛、呼吸困难、意识改变..."
								className={textareaClass}
							/>
						</div>
					</div>
				</fieldset>
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						生命体征
					</legend>
					<div className="flex gap-3 flex-wrap">
						<div className="flex-1 min-w-[100px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								心率 (bpm)
							</label>
							<input
								type="number"
								value={caseForm.hr}
								onChange={(e) => updateField("hr", Number(e.target.value))}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[100px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								收缩压 (mmHg)
							</label>
							<input
								type="number"
								value={caseForm.bp_sys}
								onChange={(e) => updateField("bp_sys", Number(e.target.value))}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[100px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								舒张压 (mmHg)
							</label>
							<input
								type="number"
								value={caseForm.bp_dia}
								onChange={(e) => updateField("bp_dia", Number(e.target.value))}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[100px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								呼吸 (次/分)
							</label>
							<input
								type="number"
								value={caseForm.rr}
								onChange={(e) => updateField("rr", Number(e.target.value))}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[100px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								血氧 (%)
							</label>
							<input
								type="number"
								value={caseForm.spo2}
								onChange={(e) => updateField("spo2", Number(e.target.value))}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[100px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								体温 (°C)
							</label>
							<input
								type="number"
								step={0.1}
								value={caseForm.temp}
								onChange={(e) => updateField("temp", Number(e.target.value))}
								className={inputClass}
							/>
						</div>
					</div>
					<div className="mt-3">
						<label className="block text-xs font-semibold text-muted-foreground mb-1">
							意识状态
						</label>
						<select
							value={caseForm.consciousness}
							onChange={(e) => updateField("consciousness", e.target.value)}
							className={inputClass}
						>
							<option value="alert">清醒</option>
							<option value="verbal">对声音有反应</option>
							<option value="pain">对疼痛有反应</option>
							<option value="unresponsive">无反应</option>
						</select>
					</div>
				</fieldset>
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						MEWS 与分诊
					</legend>
					<div className="flex gap-3 flex-wrap">
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								MEWS 评分 (0-14)
							</label>
							<input
								type="number"
								min={0}
								max={14}
								value={caseForm.mews_score}
								onChange={(e) =>
									updateField("mews_score", Number(e.target.value))
								}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[150px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								分诊级别
							</label>
							<select
								value={caseForm.triage_category}
								onChange={(e) =>
									updateField("triage_category", e.target.value)
								}
								className={inputClass}
							>
								<option value="">未评估</option>
								<option value="red">红色 — 即刻</option>
								<option value="orange">橙色 — 危急</option>
								<option value="yellow">黄色 — 紧急</option>
								<option value="green">绿色 — 普通</option>
								<option value="blue">蓝色 — 非急</option>
							</select>
						</div>
					</div>
				</fieldset>
				</>
				)}
				{caseForm.training_type === "history_taking" && (
				<>
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						患者信息
					</legend>
					<div className="flex gap-3 flex-wrap">
						<div className="flex-[2] min-w-[200px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								姓名
							</label>
							<input
								value={caseForm.patient_name}
								onChange={(e) => updateField("patient_name", e.target.value)}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								年龄
							</label>
							<input
								type="number"
								min={0}
								max={120}
								value={caseForm.patient_age}
								onChange={(e) =>
									updateField("patient_age", Number(e.target.value))
								}
								className={inputClass}
							/>
						</div>
						<div className="flex-1 min-w-[120px]">
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								性别
							</label>
							<select
								value={caseForm.patient_gender}
								onChange={(e) => updateField("patient_gender", e.target.value)}
								className={inputClass}
							>
								<option value="">--</option>
								<option value="男">男</option>
								<option value="女">女</option>
							</select>
						</div>
					</div>
					<div className="mt-3">
						<label className="block text-xs font-semibold text-muted-foreground mb-1">
							语音类型
						</label>
						<select
							value={caseForm.voice_type}
							onChange={(e) => updateField("voice_type", e.target.value)}
							className={inputClass}
						>
							<option value="">自动（默认）</option>
							<option value="zh_female_vv">温柔女声</option>
							<option value="zh_female_tianmei">甜美女声</option>
							<option value="zh_male_qingse">青年男声</option>
							<option value="zh_male_laoshi">老师男声</option>
							<option value="zh_female_child">女童声</option>
							<option value="zh_male_elder">老年男声</option>
							<option value="zh_female_elder">老年女声</option>
						</select>
					</div>
				</fieldset>
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						临床信息
					</legend>
					<div className="flex flex-col gap-3">
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								主诉
							</label>
							<input
								value={caseForm.chief_complaint}
								onChange={(e) => updateField("chief_complaint", e.target.value)}
								className={inputClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								开场白
							</label>
							<textarea
								rows={2}
								value={caseForm.opening_line}
								onChange={(e) => updateField("opening_line", e.target.value)}
								className={textareaClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								现病史
							</label>
							<textarea
								rows={3}
								value={caseForm.present_illness}
								onChange={(e) => updateField("present_illness", e.target.value)}
								className={textareaClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								既往史
							</label>
							<textarea
								rows={2}
								value={caseForm.past_history}
								onChange={(e) => updateField("past_history", e.target.value)}
								className={textareaClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								用药史
							</label>
							<textarea
								rows={2}
								value={caseForm.medication_history}
								onChange={(e) =>
									updateField("medication_history", e.target.value)
								}
								className={textareaClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								过敏史
							</label>
							<input
								value={caseForm.allergy_history}
								onChange={(e) => updateField("allergy_history", e.target.value)}
								className={inputClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								家族史
							</label>
							<textarea
								rows={2}
								value={caseForm.family_history}
								onChange={(e) => updateField("family_history", e.target.value)}
								className={textareaClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								社会史 / 生活习惯
							</label>
							<textarea
								rows={2}
								value={caseForm.social_history}
								onChange={(e) => updateField("social_history", e.target.value)}
								className={textareaClass}
							/>
						</div>
						<div>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">
								沟通风格描述
							</label>
							<textarea
								rows={2}
								value={caseForm.communication_style}
								onChange={(e) =>
									updateField("communication_style", e.target.value)
								}
								className={textareaClass}
							/>
						</div>
					</div>
				</fieldset>
				<fieldset className="border border-border rounded-lg p-4">
					<legend className="text-sm font-semibold text-foreground px-1">
						<button
							type="button"
							onClick={() => setShowAdvanced(!showAdvanced)}
							className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium rounded-lg bg-transparent border-none cursor-pointer hover:bg-muted"
						>
							{showAdvanced ? (
								<ChevronUp size={14} />
							) : (
								<ChevronDown size={14} />
							)}{" "}
							高级字段
						</button>
					</legend>
					{showAdvanced && (
						<div className="flex flex-col gap-3 mt-3">
							<div>
								<label className="text-xs font-semibold text-muted-foreground mb-2 block">
									训练功能特性
								</label>
								<div className="flex flex-wrap gap-2">
									{(TRAINING_CAPABILITIES[caseForm.training_type] ?? []).map((key) => {
										const def = ALL_CAPABILITIES[key];
										if (!def) return null;
										const on = caseForm.capabilities[key] ?? false;
										return (
											<button
												key={key}
												type="button"
												onClick={() => {
													const next = { ...caseForm.capabilities, [key]: !on };
													updateField("capabilities", next);
												}}
												className={cn(
													"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
													on
														? "border-primary/50 bg-primary/5 text-primary"
														: "border-border text-muted-foreground hover:border-primary/20 hover:bg-muted/50",
												)}
											>
												<span className={cn("size-1.5 rounded-full", on ? "bg-primary" : "bg-muted-foreground/30")} />
												{def.label}
											</button>
										);
									})}
								</div>
							</div>
						</div>
					)}
				</fieldset>
				</>
				)}
				<div className="flex gap-3 justify-end mt-4">
					<Button variant="outline" type="button" onClick={onClose}>
						取消
					</Button>
					<Button
						onClick={handleSave}
						disabled={createMutation.isPending || updateMutation.isPending}
					>
						{createMutation.isPending || updateMutation.isPending
							? (editingCase ? "保存中…" : "创建中…")
							: (editingCase ? "保存修改" : "创建病例")}
					</Button>
				</div>
			</form>
			</DialogContent>
		</Dialog>
	);
}

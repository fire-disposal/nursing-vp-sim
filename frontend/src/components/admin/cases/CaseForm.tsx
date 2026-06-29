import { ChevronDown, ChevronUp, Sparkles, Upload, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { generateCase, getCaseDetail } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
		value: string | number | string[] | Record<string, ScoringDimension>,
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

	const handleJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				const json = JSON.parse(ev.target?.result as string);
				setCaseForm(parseCaseData(json));
				setCaseMsg("JSON 导入成功，请检查并保存");
			} catch {
				setCaseMsg("JSON 格式解析失败");
			}
		};
		reader.readAsText(file);
		e.target.value = "";
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={editingCase ? `编辑病例: ${editingCase.name}` : "添加新病例"}
				maxWidth={800}
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
								<label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
									隐藏信息（一行一条）
									<button
										type="button"
										disabled={aiGenerating}
										onClick={() => {
											if (!showAiPanel) setShowAiPanel(true);
											handleAiGenerate("hidden_info");
										}}
										className="bg-transparent border-none cursor-pointer p-0 text-purple-500 flex items-center"
										title="AI 建议"
									>
										<Sparkles size={13} />
									</button>
								</label>
								<textarea
									rows={4}
									value={(caseForm.hidden_info || []).join("\n")}
									onChange={(e) => updateList("hidden_info", e.target.value)}
									className={textareaClass}
								/>
							</div>
							<div>
								<label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
									必须问到的内容（一行一条）
									<button
										type="button"
										disabled={aiGenerating}
										onClick={() => {
											if (!showAiPanel) setShowAiPanel(true);
											handleAiGenerate("required_inquiries");
										}}
										className="bg-transparent border-none cursor-pointer p-0 text-purple-500 flex items-center"
										title="AI 建议"
									>
										<Sparkles size={13} />
									</button>
								</label>
								<textarea
									rows={4}
									value={(caseForm.required_inquiries || []).join("\n")}
									onChange={(e) =>
										updateList("required_inquiries", e.target.value)
									}
									className={textareaClass}
								/>
							</div>
							<div>
								<label className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
									评分标准 (JSON)
									<button
										type="button"
										disabled={aiGenerating}
										onClick={() => {
											if (!showAiPanel) setShowAiPanel(true);
											handleAiGenerate("scoring_criteria");
										}}
										className="bg-transparent border-none cursor-pointer p-0 text-purple-500 flex items-center"
										title="AI 建议"
									>
										<Sparkles size={13} />
									</button>
								</label>
								<textarea
									rows={6}
									className="w-full px-2.5 py-1.5 border border-border rounded-md text-xs font-mono bg-card resize-y focus-ring"
									value={JSON.stringify(caseForm.scoring_criteria, null, 2)}
									onChange={(e) => {
										try {
											updateField(
												"scoring_criteria",
												JSON.parse(e.target.value),
											);
										} catch {
											/* editing in progress */
										}
									}}
								/>
							</div>
						</div>
					)}
				</fieldset>
				<div>
					<label className="inline-flex items-center gap-1 text-sm text-primary cursor-pointer hover:underline">
						<Upload size={14} /> 从 JSON 文件导入
						<input
							type="file"
							accept=".json"
							onChange={handleJsonImport}
							className="hidden"
						/>
					</label>
				</div>
				<div className="flex gap-3 justify-end mt-4">
					<Button variant="outline" type="button" onClick={onClose}>
						取消
					</Button>
					<Button
						type="submit"
						disabled={createMutation.isPending || updateMutation.isPending}
					>
						{editingCase ? "保存修改" : "创建病例"}
					</Button>
				</div>
			</form>
			</DialogContent>
		</Dialog>
	);
}

import { CheckCircle, Hash, Play } from "lucide-react";
import { useCallback, useMemo } from "react";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type {
	PromptForm as PromptFormType,
	PromptTemplateResponse,
	PromptValidateResponse,
	VariableMeta,
} from "./types";
import { inputBase, PURPOSE_LABELS, PURPOSES } from "./types";
import VariableCard from "./VariableCard";

interface PromptFormProps {
	editing: number | "new" | null;
	form: PromptFormType;
	editedPrompt: PromptTemplateResponse | null;
	isBuiltinEditing: boolean;
	showEditorPreview: boolean;
	validation: PromptValidateResponse | null;
	saving: boolean;
	prompts: PromptTemplateResponse[];
	onSave: () => void;
	onActivate: (p: PromptTemplateResponse) => void;
	onValidate: () => void;
	onCancel: () => void;
	onFormChange: (form: PromptFormType) => void;
	onTogglePreview: () => void;
	onUpdateVarDesc: (varName: string, desc: string) => void;
	onUpdateVarDefault: (varName: string, defaultValue: string) => void;
	onUpdateVarSource: (varName: string, source: string) => void;
}

export default function PromptForm({
	editing,
	form,
	editedPrompt,
	isBuiltinEditing,
	showEditorPreview,
	validation,
	saving,
	prompts,
	onSave,
	onActivate,
	onValidate,
	onCancel,
	onFormChange,
	onTogglePreview,
	onUpdateVarDesc,
	onUpdateVarDefault,
	onUpdateVarSource,
}: PromptFormProps) {
	const editorTitle =
		editing === "new"
			? `新建「${PURPOSE_LABELS[form.purpose]}」`
			: editing
				? (() => {
						const t = prompts.find((p) => p.id === editing);
						return t
							? `编辑「${PURPOSE_LABELS[t.purpose]}」v${t.version}`
							: "编辑";
					})()
				: null;

	const extractVars = useCallback(
		(text: string) => [
			...new Set(
				(text.match(/\{#([^}#]+)#\}/g) || []).map((v) => v.slice(2, -2)),
			),
		],
		[],
	);
	const currentVars = useMemo(
		() => extractVars(form.system_prompt + (form.user_prompt || "")),
		[form.system_prompt, form.user_prompt, extractVars],
	);
	const dbVars = (editedPrompt?.variables as unknown as VariableMeta[]) || [];

	const setField = (field: keyof PromptFormType, value: string) =>
		onFormChange({ ...form, [field]: value });

	if (editing == null) return null;

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm p-6 flex flex-col h-full">
			<div className="flex items-center gap-2 mb-3">
				<h4 className="text-base font-semibold flex-1">{editorTitle}</h4>
				{editedPrompt && (
					<span className="text-xs text-muted-foreground/70">
						更新于 {new Date(editedPrompt.updated_at).toLocaleString("zh-CN")}
					</span>
				)}
			</div>

			{editing === "new" && (
				<div className="mb-3">
					<label className="block text-sm font-semibold mb-1">场景</label>
					<select
						value={form.purpose}
						onChange={(e) => setField("purpose", e.target.value)}
						className="w-full py-2 px-3 border border-border rounded-lg text-sm bg-card text-foreground"
					>
						{PURPOSES.map((p) => (
							<option key={p} value={p}>
								{PURPOSE_LABELS[p]}
							</option>
						))}
					</select>
				</div>
			)}
			<div className="grid grid-cols-2 gap-3 mb-3 max-[600px]:grid-cols-1">
				<div>
					<label className="block text-sm font-semibold mb-1">版本名称</label>
					<input
						value={form.name}
						onChange={(e) => setField("name", e.target.value)}
						placeholder="v2-优化版"
						className={inputBase}
						readOnly={isBuiltinEditing}
					/>
				</div>
				<div>
					<label className="block text-sm font-semibold mb-1">备注</label>
					<input
						value={form.remark}
						onChange={(e) => setField("remark", e.target.value)}
						placeholder="修改说明..."
						className={inputBase}
						readOnly={isBuiltinEditing}
					/>
				</div>
			</div>
			<div className="flex-1 flex flex-col mb-3">
				<div className="flex items-center justify-between mb-1">
					<label className="text-sm font-semibold">System Prompt</label>
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground/70">
							{form.system_prompt.length} 字符
						</span>
						<button
							type="button"
							onClick={onTogglePreview}
							className={cn(
								"px-2 py-0.5 border border-blue-300 rounded-sm text-xs font-semibold cursor-pointer dark:border-blue-700",
								showEditorPreview
									? "bg-blue-500 text-white dark:bg-blue-600"
									: "bg-card text-primary",
							)}
						>
							{showEditorPreview ? "编辑" : "预览填充"}
						</button>
					</div>
				</div>
				<textarea
					value={form.system_prompt}
					onChange={(e) => setField("system_prompt", e.target.value)}
					readOnly={showEditorPreview || isBuiltinEditing}
					className={cn(
						"flex-1 min-h-[200px] w-full p-2 rounded-lg text-sm font-mono resize-y",
						showEditorPreview
							? "border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950"
							: isBuiltinEditing
								? "border border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
								: "border border-border bg-card",
						"text-foreground focus-ring",
					)}
				/>
			</div>
			{form.purpose === "scoring" && (
				<div className="mb-3">
					<div className="flex items-center justify-between mb-1">
						<label className="text-sm font-semibold">
							User Prompt Template
						</label>
						<span className="text-xs text-muted-foreground/70">
							{(form.user_prompt || "").length} 字符
						</span>
					</div>
					<textarea
						value={form.user_prompt}
						onChange={(e) => setField("user_prompt", e.target.value)}
						readOnly={showEditorPreview || isBuiltinEditing}
						rows={6}
						className={cn(
							"w-full p-2 rounded-lg text-sm font-mono resize-y",
							showEditorPreview
								? "border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950"
								: isBuiltinEditing
									? "border border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
									: "border border-border bg-card",
							"text-foreground focus-ring",
						)}
					/>
				</div>
			)}
			<div className="mb-3 flex items-start gap-3 flex-wrap">
				<div className="flex-1 min-w-[200px]">
					<div className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1">
						<Hash size={12} /> 模板变量{" "}
						{currentVars.length > 0 && `(${currentVars.length})`}
					</div>
					{currentVars.length > 0 ? (
						<div className="flex flex-col gap-1.5">
							{currentVars.map((vName) => {
								const meta = dbVars.find((d) => d.name === vName) || {
									name: vName,
								};
								return (
									<VariableCard
										key={vName}
										vName={vName}
										meta={meta}
										onUpdateDesc={onUpdateVarDesc}
										onUpdateDefault={onUpdateVarDefault}
										onUpdateSource={onUpdateVarSource}
									/>
								);
							})}
						</div>
					) : (
						<span className="text-xs text-muted-foreground/70">
							无变量（纯静态 prompt）
						</span>
					)}
				</div>
			</div>
			{validation && (
				<div
					className={cn(
						"p-3 rounded-lg mb-3 text-sm",
						validation.valid
							? "bg-success text-success-foreground"
							: "bg-destructive/10 text-destructive",
					)}
				>
					{validation.valid ? "校验通过" : validation.errors.join("; ")}
					{validation.missing_vars?.length > 0 && (
						<div className="mt-1">
							变量未声明: {validation.missing_vars.join(", ")}
						</div>
					)}
				</div>
			)}
			<div className="flex gap-2 flex-wrap">
				<Button variant="outline" size="sm" onClick={onValidate}>
					<Play size={14} /> 校验语法
				</Button>
				{editedPrompt && !editedPrompt.is_active && (
					<Button
						variant="outline"
						className="border-green-400 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300"
						onClick={() => onActivate(editedPrompt)}
					>
						<CheckCircle size={14} /> 保存并激活
					</Button>
				)}
				<Button
					onClick={onSave}
					disabled={saving || showEditorPreview || isBuiltinEditing}
					className={cn(
						"ml-auto",
						saving || showEditorPreview || isBuiltinEditing
							? "cursor-not-allowed opacity-60"
							: "cursor-pointer",
					)}
				>
					{isBuiltinEditing
						? "内置版本（只读）"
						: saving
							? "保存中..."
							: editing === "new"
								? "创建版本"
								: "保存修改"}
				</Button>
				<Button variant="outline" size="sm" onClick={onCancel}>
					取消
				</Button>
			</div>
		</div>
	);
}

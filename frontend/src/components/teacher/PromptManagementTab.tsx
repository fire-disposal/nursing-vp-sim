import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import {
	fetchPrompts,
	fetchSampleVars,
	validatePrompt,
} from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/utils/cn";
import PromptForm from "./prompts/PromptForm";
import PromptList from "./prompts/PromptList";
import type {
	PromptForm as PromptFormType,
	PromptTemplateResponse,
	PromptValidateResponse,
	VariableMeta,
} from "./prompts/types";
import { PURPOSE_LABELS, PURPOSES } from "./prompts/types";
import {
	useActivatePrompt,
	useDeletePrompt,
	useSavePrompt,
} from "./prompts/usePromptMutations";

export default function PromptManagementTab() {
	const toast = useToast();
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const { data: prompts = [] } = useQuery({
		queryKey: queryKeys.prompts.list,
		queryFn: () => fetchPrompts(undefined).then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [editing, setEditing] = useState<number | "new" | null>(null);
	const [form, setForm] = useState<PromptFormType>({
		purpose: "patient_chat",
		name: "",
		system_prompt: "",
		user_prompt: "",
		remark: "",
		activate: true,
	});
	const [validation, setValidation] = useState<PromptValidateResponse | null>(
		null,
	);
	const [showEditorPreview, setShowEditorPreview] = useState(false);
	const [savedForm, setSavedForm] = useState<PromptFormType | null>(null);
	const [sampleVars, setSampleVars] = useState<
		Record<string, Record<string, string>>
	>({});
	const [showActiveModal, setShowActiveModal] = useState(false);
	const [activeModalPurpose, setActiveModalPurpose] = useState("patient_chat");

	const saveMutation = useSavePrompt();
	const activateMutation = useActivatePrompt();
	const deleteMutation = useDeletePrompt();

	const grouped: Record<string, PromptTemplateResponse[]> = {};
	PURPOSES.forEach((p) => {
		grouped[p] = prompts
			.filter((t) => t.purpose === p)
			.sort((a, b) => b.version - a.version);
	});

	const toggle = (p: string) => setExpanded((e) => ({ ...e, [p]: !e[p] }));

	const openNew = (purpose: string) => {
		setEditing("new");
		setForm({
			purpose,
			name: "",
			system_prompt: "",
			user_prompt: purpose === "scoring" ? "" : "",
			remark: "",
			activate: true,
		});
		setValidation(null);
		fetchSampleVars(purpose)
			.then(({ data }) =>
				setSampleVars((s) => ({
					...s,
					[purpose]: (data as { vars: Record<string, string> }).vars,
				})),
			)
			.catch(() => {});
	};

	const openEdit = (p: PromptTemplateResponse) => {
		setEditing(p.id);
		setForm({
			purpose: p.purpose,
			name: p.name || "",
			system_prompt: p.system_prompt,
			user_prompt: p.user_prompt || "",
			remark: p.remark || "",
			activate: false,
		});
		setValidation(null);
		if (!sampleVars[p.purpose]) {
			fetchSampleVars(p.purpose)
				.then(({ data }) =>
					setSampleVars((s) => ({
						...s,
						[p.purpose]: (data as { vars: Record<string, string> }).vars,
					})),
				)
				.catch(() => {});
		}
	};

	const closeEditor = () => {
		if (showEditorPreview && savedForm) setForm({ ...savedForm });
		setShowEditorPreview(false);
		setSavedForm(null);
		setEditing(null);
	};

	useEffect(() => {
		if (editing == null) setValidation(null);
	}, [editing]);

	const handleSave = () => {
		if (editing == null) return;
		saveMutation.mutate(
			{ editingId: editing, form, variables: editedPrompt?.variables },
			{
				onSuccess: () => {
					setEditing(null);
				},
			},
		);
	};

	const handleActivate = async (p: PromptTemplateResponse) => {
		const msg =
			p.id === 0
				? `「${PURPOSE_LABELS[p.purpose]}」将停用所有自定义版本，恢复使用系统内置提示词。`
				: `「${PURPOSE_LABELS[p.purpose]}」切换到 v${p.version} "${p.name || ""}"？`;
		const ok = await confirm({
			title: "切换版本",
			message: msg,
		});
		if (!ok) return;
		activateMutation.mutate(p);
	};

	const handleDelete = async (p: PromptTemplateResponse) => {
		if (p.is_active) {
			toast.error("不能删除当前激活的版本");
			return;
		}
		const ok = await confirm({
			title: "删除",
			message: `删除「${PURPOSE_LABELS[p.purpose]}」v${p.version}?`,
			danger: true,
		});
		if (!ok) return;
		deleteMutation.mutate(p, {
			onSuccess: () => {
				if (editing === p.id) setEditing(null);
			},
		});
	};

	const handleValidate = async () => {
		try {
			const { data } = await validatePrompt({
				system_prompt: form.system_prompt,
				user_prompt: form.user_prompt || null,
				purpose: form.purpose,
			});
			setValidation(data);
		} catch {
			toast.error("校验失败");
		}
	};

	const togglePreview = () => {
		if (!showEditorPreview) {
			setSavedForm({ ...form });
			const vars = sampleVars[form.purpose] || {};
			try {
				const sp = form.system_prompt.replace(
					/\{#([^}#]+)#\}/g,
					(_, key) => vars[key.trim()] ?? `{${key}}`,
				);
				const up = form.user_prompt
					? form.user_prompt.replace(
							/\{#([^}#]+)#\}/g,
							(_, key) => vars[key.trim()] ?? `{${key}}`,
						)
					: form.user_prompt;
				setForm((f) => ({ ...f, system_prompt: sp, user_prompt: up }));
			} catch {
				/* ignore */
			}
		} else if (savedForm) {
			setForm({ ...savedForm });
			setSavedForm(null);
		}
		setShowEditorPreview((v) => !v);
	};

	const editedPrompt =
		editing != null && editing !== "new"
			? (prompts.find((p) => p.id === editing) ?? null)
			: null;
	const isBuiltinEditing = editing === 0;

	const updateVarMeta = (
		field: "desc" | "default_value" | "source",
		varName: string,
		value: string,
	) => {
		if (!editedPrompt) return;
		queryClient.setQueryData<PromptTemplateResponse[]>(
			queryKeys.prompts.list,
			(prev) =>
				(prev ?? []).map((p) => {
					if (p.id !== editedPrompt.id) return p;
					const updatedVars = (
						(p.variables || []) as unknown as VariableMeta[]
					).map((v) => (v.name === varName ? { ...v, [field]: value } : v));
					if (!updatedVars.find((v) => v.name === varName)) {
						updatedVars.push({ name: varName, [field]: value } as VariableMeta);
					}
					return {
						...p,
						variables: updatedVars as unknown as { [key: string]: unknown }[],
					};
				}),
		);
	};

	const getEffectivePrompt = (
		purpose: string,
	): PromptTemplateResponse | undefined => {
		const versions = grouped[purpose] || [];
		return versions.find((v) => v.is_active);
	};

	return (
		<div>
			<div className="mb-4 flex gap-2">
				<Button
					variant="outline"
					className="border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
					onClick={() => setShowActiveModal(true)}
				>
					<Eye size={13} /> 查看生效版本
				</Button>
			</div>

			<div className="grid grid-cols-[340px_1fr] gap-4 items-start min-h-[calc(100vh-180px)] max-[900px]:grid-cols-1">
				<PromptList
					grouped={grouped}
					expanded={expanded}
					editing={editing}
					prompts={prompts}
					formPurpose={form.purpose}
					onToggle={toggle}
					onOpenNew={openNew}
					onOpenEdit={openEdit}
					onActivate={handleActivate}
					onDelete={handleDelete}
				/>

				<PromptForm
					editing={editing}
					form={form}
					editedPrompt={editedPrompt}
					isBuiltinEditing={isBuiltinEditing}
					showEditorPreview={showEditorPreview}
					validation={validation}
					saving={saveMutation.isPending}
					prompts={prompts}
					onSave={handleSave}
					onActivate={handleActivate}
					onValidate={handleValidate}
					onCancel={closeEditor}
					onFormChange={setForm}
					onTogglePreview={togglePreview}
					onUpdateVarDesc={(vName, desc) => updateVarMeta("desc", vName, desc)}
					onUpdateVarDefault={(vName, defaultValue) =>
						updateVarMeta("default_value", vName, defaultValue)
					}
					onUpdateVarSource={(vName, source) =>
						updateVarMeta("source", vName, source)
					}
				/>
			</div>

			<Dialog
				open={showActiveModal}
				onOpenChange={(o) => !o && setShowActiveModal(false)}
			>
				<DialogContent title="生效版本一览" maxWidth={900}>
				<div className="flex gap-2 mb-4 border-b border-border pb-3 overflow-x-auto">
					{PURPOSES.filter((p) => p !== "*").map((p) => {
						const eff = getEffectivePrompt(p);
						return (
							<button
								key={p}
								onClick={() => setActiveModalPurpose(p)}
								className={cn(
									"px-3 py-1.5 rounded-lg border-none text-sm font-medium cursor-pointer whitespace-nowrap transition-colors",
									activeModalPurpose === p
										? "bg-primary text-primary-foreground"
										: "bg-muted text-muted-foreground hover:bg-muted/80",
								)}
							>
								{PURPOSE_LABELS[p]}
								{eff?.is_builtin ? " · 内置" : eff ? ` · v${eff.version}` : ""}
							</button>
						);
					})}
				</div>

				{(() => {
					const eff = getEffectivePrompt(activeModalPurpose);
					if (!eff)
						return (
							<div className="p-8 text-center text-muted-foreground/60">
								该场景暂无生效版本
							</div>
						);
					return (
						<div>
							<div className="flex items-center gap-2 mb-3">
								<span
									className={cn(
										"text-xs px-1.5 py-0.5 rounded-full font-semibold",
										eff.is_builtin
											? "bg-warning text-warning-foreground"
											: "bg-success text-success-foreground",
									)}
								>
									{eff.is_builtin ? "系统内置" : `DB v${eff.version}`}
								</span>
								{!eff.is_builtin && (
									<span className="text-sm font-medium">{eff.name}</span>
								)}
								{eff.is_builtin && (
									<span className="text-xs text-muted-foreground">
										代码内硬编码，不在数据库中。无自定义版本时自动生效。
									</span>
								)}
							</div>
							<div className="mb-3">
								<div className="text-xs font-semibold text-muted-foreground mb-1">
									System Prompt ({eff.system_prompt.length} 字符)
								</div>
								<pre className="m-0 p-3 bg-muted border border-border rounded-lg text-sm font-mono whitespace-pre-wrap text-foreground max-h-[350px] overflow-auto leading-relaxed select-all">
									{eff.system_prompt}
								</pre>
							</div>
							{eff.user_prompt && (
								<div>
									<div className="text-xs font-semibold text-muted-foreground mb-1">
										User Prompt Template ({eff.user_prompt.length} 字符)
									</div>
									<pre className="m-0 p-3 bg-muted border border-border rounded-lg text-sm font-mono whitespace-pre-wrap text-foreground max-h-[250px] overflow-auto leading-relaxed select-all">
										{eff.user_prompt}
									</pre>
								</div>
							)}
						</div>
					);
				})()}
				</DialogContent>
			</Dialog>
		</div>
	);
}

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { createConfig, fetchSecrets, updateConfig } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { type LlmConfigValues, llmConfigSchema } from "@/schemas/llm-config";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

interface ConfigModalProps {
	open: boolean;
	configData: LLMConfigResponse | null;
	prefilled?: { secret_id?: number; purpose?: string } | null;
	onClose: () => void;
	onSaved: () => void;
}

const PURPOSE_QUICK = [
	{
		purpose: "scoring",
		label: "评分",
		desc: "DeepSeek Pro — 高精度评分",
		icon: "📊",
	},
	{
		purpose: "patient_chat",
		label: "患者对话",
		desc: "DeepSeek Flash — 快速响应",
		icon: "💬",
	},
	{
		purpose: "qa",
		label: "问答",
		desc: "DeepSeek Flash — 通用问答",
		icon: "❓",
	},
	{
		purpose: "case_generation",
		label: "病例生成",
		desc: "DeepSeek Flash — 生成病例",
		icon: "📋",
	},
	{
		purpose: "*",
		label: "通配兜底",
		desc: "DeepSeek Flash — 其他用途后备",
		icon: "🔄",
	},
];

const ALL_PURPOSES = [
	{ value: "*", label: "通配 (全部)" },
	{ value: "qa", label: "问答 (QA)" },
	{ value: "patient_chat", label: "患者对话" },
	{ value: "scoring", label: "评分" },
	{ value: "case_generation", label: "病例生成" },
];

const inputClass =
	"w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus-ring";

export default function ConfigModal({
	open,
	configData,
	prefilled,
	onClose,
	onSaved,
}: ConfigModalProps) {
	const [secrets, setSecrets] = useState<ApiSecretResponse[]>([]);
	const [saving, setSaving] = useState(false);
	const { success, error, apiError } = useToast();
	const isEdit = configData != null;

	const form = useForm<LlmConfigValues>({
		resolver: zodResolver(llmConfigSchema),
		defaultValues: { secretId: "", label: "", purpose: "qa" },
	});

	const watchedSecretId = form.watch("secretId");
	const selectedSecret = secrets.find(
		(s) => String(s.id) === watchedSecretId,
	);
	const initializedRef = useRef(false);

	const autoKey = secrets.length === 1 ? String(secrets[0].id) : "";

	useEffect(() => {
		if (open) {
			const doInit = (secretsList: typeof secrets) => {
				const ak = secretsList.length === 1 ? String(secretsList[0].id) : "";
				if (configData) {
					form.reset({
						secretId: String(configData.secret_id || ""),
						label: configData.label || "",
						purpose: configData.purpose || "qa",
					});
				} else if (prefilled) {
					form.reset({
						secretId: String(prefilled.secret_id || ak || ""),
						label: "",
						purpose: prefilled.purpose || "qa",
					});
				} else {
					form.reset({ secretId: ak, label: "", purpose: "qa" });
				}
			};
			fetchSecrets()
				.then(({ data }) => {
					setSecrets(data);
					if (!initializedRef.current) {
						doInit(data);
						initializedRef.current = true;
					}
				})
				.catch(() => {});
		} else {
			initializedRef.current = false;
		}
	}, [open, configData, prefilled, form]);

	const handleQuickCreate = async (purposeVal: string) => {
		const sid = form.getValues("secretId") || autoKey;
		if (!sid) {
			error("请先添加 API 密钥");
			return;
		}
		setSaving(true);
		try {
			await createConfig({
				secret_id: Number(sid),
				label: `${selectedSecret?.label || "key"}-${purposeVal}`,
				purpose: purposeVal,
			});
			success("已创建");
			onSaved();
			onClose();
		} catch (e: unknown) {
			apiError(e, "创建失败");
		} finally {
			setSaving(false);
		}
	};

	const onSubmit = async (values: LlmConfigValues) => {
		const payload = {
			secret_id: Number(values.secretId),
			label: values.label || `${selectedSecret?.label || ""}-${values.purpose}`,
			purpose: values.purpose,
		};
		try {
			if (isEdit) {
				await updateConfig(configData.id, payload);
				success("已更新");
			} else {
				await createConfig(payload);
				success("已创建");
			}
			onSaved();
			onClose();
		} catch (e: unknown) {
			apiError(e, "保存失败");
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				title={isEdit ? "编辑绑定" : "添加用途绑定"}
				maxWidth={560}
			>
			<Form {...form}>
				<FormField
					control={form.control}
					name="secretId"
					render={({ field }) => (
						<FormItem className="mb-3">
							<FormLabel className="font-semibold text-sm">选择密钥</FormLabel>
							<FormControl>
								<select {...field} className={inputClass}>
									<option value="">选择密钥...</option>
									{secrets.map((s) => (
										<option key={s.id} value={s.id}>
											{s.label} (sk-...{s.key_suffix})
										</option>
									))}
								</select>
							</FormControl>
							{selectedSecret && (
								<div className="text-[0.72rem] text-muted-foreground/70 mt-0.5">
									{selectedSecret.base_url || "https://api.deepseek.com"}
								</div>
							)}
							<FormMessage />
						</FormItem>
					)}
				/>

				{!isEdit ? (
					<div>
						<div className="mb-2 text-sm font-semibold text-muted-foreground">
							快速创建 — 点击卡片一键配置
						</div>
						<div className="grid grid-cols-2 gap-2 mb-3">
							{PURPOSE_QUICK.map((p) => (
								<button
									key={p.purpose}
									onClick={() => handleQuickCreate(p.purpose)}
									disabled={saving || !(watchedSecretId || autoKey)}
									className="p-3 rounded-md border border-border bg-card cursor-pointer text-left flex flex-col gap-0.5 hover:bg-muted disabled:opacity-50"
								>
									<span className="text-lg">{p.icon}</span>
									<span className="font-semibold text-sm">{p.label}</span>
									<span className="text-[0.7rem] text-muted-foreground/70">
										{p.desc}
									</span>
								</button>
							))}
						</div>
					</div>
				) : (
					<form
						onSubmit={form.handleSubmit(onSubmit)}
						className="flex flex-col gap-3"
					>
						<FormField
							control={form.control}
							name="label"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="font-semibold text-sm">
										配置标签
									</FormLabel>
									<FormControl>
										<input
											{...field}
											placeholder="如: QA用Pro"
											className={inputClass}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="purpose"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="font-semibold text-sm">用途</FormLabel>
									<FormControl>
										<select {...field} className={inputClass}>
											{ALL_PURPOSES.map((p) => (
												<option key={p.value} value={p.value}>
													{p.label}
												</option>
											))}
										</select>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={onClose}>
								取消
							</Button>
							<Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
								{form.formState.isSubmitting ? "保存中..." : "保存"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</Form>
			</DialogContent>
		</Dialog>
	);
}

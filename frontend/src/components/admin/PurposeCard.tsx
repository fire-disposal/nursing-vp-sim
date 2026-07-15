import { useState } from "react";
import { createConfig, toggleConfig, updateConfig } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import type { LlmPurpose } from "@/config/llm-purposes";
import { cn } from "@/utils/cn";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

interface PurposeCardProps {
	purpose: LlmPurpose;
	config: LLMConfigResponse | null;
	secrets: ApiSecretResponse[];
	profile: {
		model: string;
		temperature: number;
		max_tokens: number;
		semaphore: number;
	};
	onChanged: () => void;
}

const MODELS = [
	"deepseek-v4-flash",
	"deepseek-v4-pro",
	"deepseek-chat",
	"deepseek-reasoner",
];

export default function PurposeCard({
	purpose,
	config,
	secrets,
	profile,
	onChanged,
}: PurposeCardProps) {
	const toast = useToast();
	const [saving, setSaving] = useState(false);
	const isEnabled = config?.status === "active";
	const currentModel = config?.model_override || profile.model;

	const handleModelChange = async (model: string) => {
		if (!config) return;
		setSaving(true);
		try {
			await updateConfig(config.id, { model_override: model });
			toast.success("模型已更新");
			onChanged();
		} catch (e: unknown) {
			toast.apiError(e, "更新失败");
		} finally {
			setSaving(false);
		}
	};

	const handleSecretChange = async (secretId: number) => {
		if (!secretId) return;
		setSaving(true);
		try {
			await createConfig({
				secret_id: secretId,
				purpose: purpose.value,
				label: "",
				model_override: config?.model_override ?? undefined,
			});
			toast.success("密钥已切换");
			onChanged();
		} catch (e: unknown) {
			toast.apiError(e, "切换失败");
		} finally {
			setSaving(false);
		}
	};

	const handleToggle = async () => {
		if (!config) return;
		try {
			await toggleConfig(config.id);
			onChanged();
		} catch (e: unknown) {
			toast.apiError(e, "操作失败");
		}
	};

	return (
		<div
			className={cn(
				"border border-border rounded-lg p-4 space-y-3",
				!isEnabled && "opacity-60",
			)}
		>
			<div className="flex items-center justify-between">
				<div>
					<h4 className="font-semibold text-sm">{purpose.label}</h4>
					<p className="text-xs text-muted-foreground">{purpose.desc}</p>
				</div>
				{config && (
					<button
						onClick={handleToggle}
						className={cn(
							"text-xs font-medium px-2 py-0.5 rounded border cursor-pointer",
							isEnabled
								? "border-green-500/50 text-green-600 bg-green-50"
								: "border-red-400/50 text-red-500 bg-red-50",
						)}
					>
						{isEnabled ? "已启用" : "已停用"}
					</button>
				)}
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<label className="text-xs text-muted-foreground w-10 shrink-0">
						模型
					</label>
					<select
						value={currentModel}
						onChange={(e) => handleModelChange(e.target.value)}
						disabled={saving || !config}
						className="flex-1 py-1 px-2 border border-border rounded-md text-sm bg-card disabled:opacity-50"
					>
						{MODELS.map((m) => (
							<option key={m} value={m}>
								{m}
								{m === profile.model && !config?.model_override
									? " (默认)"
									: ""}
							</option>
						))}
						{!MODELS.includes(currentModel) && (
							<option value={currentModel}>{currentModel}</option>
						)}
					</select>
				</div>

				<div className="flex items-center gap-2">
					<label className="text-xs text-muted-foreground w-10 shrink-0">
						密钥
					</label>
					{secrets.length > 0 ? (
						<select
							value={config?.secret_id ?? ""}
							onChange={(e) =>
								handleSecretChange(Number(e.target.value))
							}
							disabled={saving}
							className="flex-1 py-1 px-2 border border-border rounded-md text-sm bg-card disabled:opacity-50 min-w-0"
						>
							{!config && (
								<option value="">选择密钥...</option>
							)}
							{secrets.map((s) => (
								<option key={s.id} value={s.id}>
									{s.label} (sk-...{s.key_suffix})
								</option>
							))}
						</select>
					) : (
						<span className="text-sm text-muted-foreground">
							未指派
						</span>
					)}
				</div>
			</div>

			<div className="flex gap-2 flex-wrap">
				<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
					{profile.max_tokens} tokens
				</span>
				<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
					temp {profile.temperature}
				</span>
				<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
					{profile.semaphore} 并发
				</span>
			</div>
		</div>
	);
}

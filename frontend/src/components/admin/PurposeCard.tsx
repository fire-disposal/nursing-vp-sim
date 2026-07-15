import { useState } from "react";
import { updateConfig, toggleConfig } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { cn } from "@/utils/cn";
import type { LlmPurpose } from "@/config/llm-purposes";

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
					<span className="text-sm">
						{config
							? `${config.secret_label} (sk-...${config.secret_suffix})`
							: "未指派"}
					</span>
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

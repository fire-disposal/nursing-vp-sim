import type { components } from "@/api/api-types.gen";
import { LLM_PURPOSES } from "@/config/llm-purposes";
import PurposeCard from "./PurposeCard";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

const PROFILES: Record<string, { model: string; temperature: number; max_tokens: number; semaphore: number }> = {
	patient_chat: { model: "deepseek-v4-flash", temperature: 0.3, max_tokens: 512, semaphore: 50 },
	qa: { model: "deepseek-v4-flash", temperature: 0.7, max_tokens: 1024, semaphore: 50 },
	scoring: { model: "deepseek-v4-pro", temperature: 0, max_tokens: 4096, semaphore: 10 },
	scoring_feedback: { model: "deepseek-v4-pro", temperature: 0.3, max_tokens: 2048, semaphore: 10 },
	case_generation: { model: "deepseek-v4-flash", temperature: 0.3, max_tokens: 4096, semaphore: 3 },
};

interface PurposeCardGridProps {
	configs: LLMConfigResponse[];
	secrets: ApiSecretResponse[];
	onChanged: () => void;
}

export default function PurposeCardGrid({
	configs,
	secrets,
	onChanged,
}: PurposeCardGridProps) {
	const configByPurpose: Record<string, LLMConfigResponse | undefined> = {};
	for (const c of configs) {
		if (!configByPurpose[c.purpose] || c.status === "active") {
			configByPurpose[c.purpose] = c;
		}
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{LLM_PURPOSES.map((p) => {
				const cfg = configByPurpose[p.value] || null;
				const profile = PROFILES[p.value] || {
					model: "deepseek-v4-flash",
					temperature: 0.7,
					max_tokens: 512,
					semaphore: 50,
				};
				return (
					<PurposeCard
						key={p.value}
						purpose={p}
						config={cfg}
						secrets={secrets}
						profile={profile}
						onChanged={onChanged}
					/>
				);
			})}
		</div>
	);
}

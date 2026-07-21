import { ALL_CAPABILITIES, TRAINING_CAPABILITIES } from "@/engine/capabilities.gen";
import { inputClass } from "@/utils/styles";

interface Props {
	value: Record<string, boolean>;
	trainingType: string;
	onChange: (v: Record<string, boolean>) => void;
	disabled?: boolean;
}

export function CapabilitiesSection({ value, trainingType, onChange, disabled }: Props) {
	const caps = trainingType ? (TRAINING_CAPABILITIES[trainingType] ?? []) : [];

	if (caps.length === 0) return null;

	const toggle = (key: string) => {
		onChange({ ...value, [key]: !value[key] });
	};

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">能力开关</legend>
			<p className="text-xs text-muted-foreground mb-3">控制训练中启用的扩展功能</p>
			<div className="space-y-2">
				{caps.map((key) => {
					const def = ALL_CAPABILITIES[key];
					const enabled = !!value[key];
					return (
						<label key={key} className="flex items-start gap-3 py-2 px-3 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer">
							<input
								type="checkbox"
								checked={enabled}
								onChange={() => toggle(key)}
								disabled={disabled}
								className="mt-0.5 shrink-0"
							/>
							<div className="flex-1 min-w-0">
								<div className="text-sm font-medium">{def?.label ?? key}</div>
								<div className="text-xs text-muted-foreground">{def?.description ?? ""}</div>
							</div>
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}

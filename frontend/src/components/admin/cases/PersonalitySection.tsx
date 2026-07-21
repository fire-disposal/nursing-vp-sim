import type { PersonalityConfig } from "./caseFormTypes";
import { inputClass } from "@/utils/styles";

const SELECT_CLASS = `${inputClass} h-9`;

interface Props {
	value: PersonalityConfig;
	communicationStyle: string;
	onPersonalityChange: (v: PersonalityConfig) => void;
	onCommunicationChange: (v: string) => void;
	disabled?: boolean;
}

export function PersonalitySection({ value, communicationStyle, onPersonalityChange, onCommunicationChange, disabled }: Props) {
	const set = (k: keyof PersonalityConfig, v: string) => onPersonalityChange({ ...value, [k]: v });

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">人格配置</legend>
			<p className="text-xs text-muted-foreground mb-3">影响患者的情绪反应基线、对话风格和信任建立速度</p>
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">健康素养</label>
					<select value={value.health_literacy} onChange={(e) => set("health_literacy", e.target.value)} className={SELECT_CLASS} disabled={disabled}>
						<option value="low">低 — 不太会描述病情</option>
						<option value="medium">中 — 能基本描述症状</option>
						<option value="normal">正常 — 能正常描述症状</option>
						<option value="high">高 — 能精准描述病情感受</option>
					</select>
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">话量</label>
					<select value={value.verbosity} onChange={(e) => set("verbosity", e.target.value)} className={SELECT_CLASS} disabled={disabled}>
						<option value="terse">寡言少语</option>
						<option value="normal">正常交流</option>
						<option value="verbose">话多健谈</option>
					</select>
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">焦虑倾向</label>
					<select value={value.anxiety_trait} onChange={(e) => set("anxiety_trait", e.target.value)} className={SELECT_CLASS} disabled={disabled}>
						<option value="calm">心态平和</option>
						<option value="normal">适度担心</option>
						<option value="anxious">容易焦虑</option>
					</select>
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">耐心</label>
					<select value={value.patience} onChange={(e) => set("patience", e.target.value)} className={SELECT_CLASS} disabled={disabled}>
						<option value="low">耐心不足</option>
						<option value="normal">有耐心配合</option>
						<option value="high">非常耐心</option>
					</select>
				</div>
			</div>
			<div className="mt-3">
				<label className="block text-xs font-semibold text-muted-foreground mb-1">沟通风格描述</label>
				<textarea
					value={communicationStyle}
					onChange={(e) => onCommunicationChange(e.target.value)}
					placeholder="用口语化、真实患者的口吻交流。"
					className={`${inputClass} h-20 resize-y`}
					disabled={disabled}
				/>
			</div>
		</fieldset>
	);
}

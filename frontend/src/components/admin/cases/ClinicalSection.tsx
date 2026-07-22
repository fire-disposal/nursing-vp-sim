import { inputClass } from "@/utils/styles";

interface Props {
	voiceType: string;
	presentIllness: string;
	pastHistory: string;
	medicationHistory: string;
	allergyHistory: string;
	familyHistory: string;
	socialHistory: string;
	onFieldChange: (key: string, value: string) => void;
	disabled?: boolean;
}

const VOICE_OPTIONS = [
	{ value: "", label: "默认" },
	{ value: "zh_female_qingxin", label: "女声-清新" },
	{ value: "zh_female_wenrou", label: "女声-温柔" },
	{ value: "zh_male_qingse", label: "男声-青涩" },
	{ value: "zh_male_wennuan", label: "男声-温暖" },
];

const TEXTAREA = `${inputClass} h-20 resize-y`;
const FIELDS: [string, string][] = [
	["present_illness", "现病史"],
	["past_history", "既往史"],
	["medication_history", "用药史"],
	["allergy_history", "过敏史"],
	["family_history", "家族史"],
	["social_history", "个人史"],
];

export function ClinicalSection({ voiceType, presentIllness, pastHistory, medicationHistory, allergyHistory, familyHistory, socialHistory, onFieldChange, disabled }: Props) {
	const values: Record<string, string> = { present_illness: presentIllness, past_history: pastHistory, medication_history: medicationHistory, allergy_history: allergyHistory, family_history: familyHistory, social_history: socialHistory };

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">临床背景</legend>
			<div className="mb-3">
				<label className="block text-xs font-semibold text-muted-foreground mb-1">语音类型</label>
				<select value={voiceType} onChange={(e) => onFieldChange("voice_type", e.target.value)} className={inputClass} disabled={disabled}>
					{VOICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
				</select>
			</div>
			{FIELDS.map(([key, label]) => (
				<div key={key} className="mb-3">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">{label}{key === "present_illness" && <span className="text-destructive ml-0.5">*</span>}</label>
					<textarea value={values[key] ?? ""} onChange={(e) => onFieldChange(key, e.target.value)} placeholder={`请输入${label}`} className={TEXTAREA} disabled={disabled} />
				</div>
			))}
		</fieldset>
	);
}

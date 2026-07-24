import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { stringField } from "./CaseEditorState";
import { inputClass } from "@/utils/styles";

const SELECT_CLASS = `${inputClass} h-9`;

const PERSONALITY_OPTIONS = {
	health_literacy: [
		["low", "低 — 不太会描述病情"],
		["medium", "中 — 能基本描述症状"],
		["normal", "正常 — 能正常描述症状"],
		["high", "高 — 能精准描述病情感受"],
	],
	verbosity: [
		["terse", "寡言少语"],
		["normal", "正常交流"],
		["verbose", "话多健谈"],
	],
	anxiety_trait: [
		["calm", "心态平和"],
		["normal", "适度担心"],
		["anxious", "容易焦虑"],
	],
	patience: [
		["low", "耐心不足"],
		["normal", "有耐心"],
		["high", "话多反复"],
	],
	mood: [
		["neutral", "平常心态"],
		["low", "情绪低落"],
		["irritable", "烦躁易怒"],
		["fearful", "恐惧不安"],
	],
	compliance: [
		["resistant", "不信任/抵触"],
		["normal", "正常配合"],
		["dependent", "过分依赖"],
	],
} as const;

type PersonalityField = keyof typeof PERSONALITY_OPTIONS;
const FIELDS: { key: PersonalityField; label: string }[] = [
	{ key: "health_literacy", label: "健康素养" },
	{ key: "verbosity", label: "话量" },
	{ key: "anxiety_trait", label: "焦虑倾向" },
	{ key: "patience", label: "耐心" },
	{ key: "mood", label: "情绪基调" },
	{ key: "compliance", label: "依从性" },
];

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function PersonalitySection({ state, dispatch, disabled }: Props) {
	const communicationStyle = stringField(state, "communication_style");

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">人格配置</legend>
			<p className="text-xs text-muted-foreground mb-3">影响患者的情绪反应基线、对话风格和信任建立速度</p>
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
				{FIELDS.map(({ key, label }) => {
					const value = stringField(state, `personality.${key}`, "normal");
					const opts = PERSONALITY_OPTIONS[key];
					return (
						<div key={key}>
							<label className="block text-xs font-semibold text-muted-foreground mb-1">{label}</label>
							<select
								value={value}
								onChange={(e) => set(`personality.${key}`, e.target.value)}
								className={SELECT_CLASS}
								disabled={disabled}
							>
								{opts.map(([val, txt]) => (
									<option key={val} value={val}>{txt}</option>
								))}
							</select>
						</div>
					);
				})}
			</div>
			<div className="mt-3">
				<label className="block text-xs font-semibold text-muted-foreground mb-1">沟通风格描述</label>
				<textarea
					value={communicationStyle}
					onChange={(e) => set("communication_style", e.target.value)}
					placeholder="用口语化、真实患者的口吻交流。"
					className={`${inputClass} h-20 resize-y`}
					disabled={disabled}
				/>
			</div>
		</fieldset>
	);
}
